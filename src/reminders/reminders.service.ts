import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ReminderRule,
  ReminderTargetType,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { isUniqueViolation } from '../common/prisma-errors';
import { EmailProvider } from '../integrations/email.provider';
import { PushProvider } from '../integrations/push.provider';
import { SmsProvider } from '../integrations/sms.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReminderRuleDto } from './dto/create-reminder-rule.dto';
import { UpdateReminderRuleDto } from './dto/update-reminder-rule.dto';
import { redisConnection } from './redis';

/** reminder-scan 的触发窗口：触发时刻起 5 分钟内视为"落入触发窗口"（= 扫描间隔） */
const TRIGGER_WINDOW_MS = 5 * 60 * 1000;

/** 'reminder-send' 队列上单个发送任务的数据 */
export interface ReminderSendJobData {
  logId: string;
  ruleId: string;
  recipientId: string;
  channel: string;
  title: string;
  body: string;
}

/** 扫描用的课次（含算触发时刻所需的关联） */
type OccurrenceForScan = Prisma.SessionOccurrenceGetPayload<{
  include: {
    classSession: {
      include: {
        campus: true;
        course: { select: { title: true; timeRange: true } };
      };
    };
  };
}>;

/** 扫描用的活动（含校区） */
type EventForScan = Prisma.EventGetPayload<{ include: { campus: true } }>;

/**
 * 提醒模块核心服务（设计文档 §4.8 / §五）：
 * - 管理员 CRUD 提醒规则、查询发送日志；
 * - reminder-scan：按 §五 R7 时区基准计算触发时刻，落入触发窗口即解析收件人、
 *   经 ReminderLog 唯一约束去重后入 'reminder-send' 队列，并写一条 Notification；
 * - 处理 'reminder-send' 队列的实际发送（stub providers）。
 */
@Injectable()
export class RemindersService {
  private sendQueue: Queue<ReminderSendJobData> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly sms: SmsProvider,
    private readonly email: EmailProvider,
    private readonly push: PushProvider,
  ) {}

  // ------------------------------------------------------------ 规则 CRUD

  /** GET /admin/reminder-rules */
  listRules(): Promise<ReminderRule[]> {
    return this.prisma.reminderRule.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /** POST /admin/reminder-rules */
  createRule(dto: CreateReminderRuleDto): Promise<ReminderRule> {
    return this.prisma.reminderRule.create({
      data: {
        targetType: dto.targetType,
        offsetHoursBefore: dto.offsetHoursBefore,
        channels: dto.channels,
        templateKey: dto.templateKey,
        isActive: dto.isActive ?? true,
      },
    });
  }

  /** PATCH /admin/reminder-rules/:id */
  async updateRule(
    id: string,
    dto: UpdateReminderRuleDto,
  ): Promise<ReminderRule> {
    const existing = await this.prisma.reminderRule.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('提醒规则不存在');
    return this.prisma.reminderRule.update({ where: { id }, data: dto });
  }

  async deleteRule(id: string) {
    const existing = await this.prisma.reminderRule.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('提醒规则不存在');
    await this.prisma.reminderRule.delete({ where: { id } });
    return { success: true };
  }

  /** GET /admin/reminder-logs?target_id= */
  listLogs(targetId?: string) {
    return this.prisma.reminderLog.findMany({
      where: targetId ? { targetId } : undefined,
      include: {
        rule: { select: { id: true, targetType: true, templateKey: true } },
        recipient: { select: { id: true, name: true, email: true } },
      },
      orderBy: { sentAt: 'desc' },
      take: 200,
    });
  }

  // ------------------------------------------------------------ reminder-scan

  /**
   * 每 5 分钟运行：扫描未来时间窗口内 status=SCHEDULED 的 SessionOccurrence / Event，
   * 对每条启用的规则按目标时区计算触发时刻；落入触发窗口则解析收件人并触发提醒。
   */
  async scanReminders(): Promise<{ triggered: number }> {
    const now = new Date();
    const rules = await this.prisma.reminderRule.findMany({
      where: { isActive: true },
    });
    if (rules.length === 0) return { triggered: 0 };

    const maxOffset = Math.max(...rules.map((r) => r.offsetHoursBefore));
    const horizon = new Date(now.getTime() + (maxOffset + 1) * 3600_000);
    let triggered = 0;

    const occRules = rules.filter(
      (r) => r.targetType === ReminderTargetType.SESSION_OCCURRENCE,
    );
    if (occRules.length > 0) {
      const occurrences = await this.fetchUpcomingOccurrences(now, horizon);
      for (const occ of occurrences) {
        const tz = occ.classSession.campus.timezone;
        // localStart：目标时区下的本地开始时间（§五 R7）
        const localStart = occurrenceLocalStart(occ, tz);
        if (!localStart) continue;
        const startUtc = localStart.toUTC().toJSDate();
        if (startUtc < now || startUtc > horizon) continue;
        const content = occurrenceContent(occ, localStart, tz);
        for (const rule of occRules) {
          if (!this.inTriggerWindow(localStart, rule.offsetHoursBefore, now))
            continue;
          const recipients = await this.resolveOccurrenceRecipients(
            occ.id,
            occ.classSessionId,
          );
          triggered += await this.fireRule(
            rule,
            occ.id,
            'SESSION_OCCURRENCE',
            recipients,
            content,
          );
        }
      }
    }

    const eventRules = rules.filter(
      (r) => r.targetType === ReminderTargetType.EVENT,
    );
    if (eventRules.length > 0) {
      const events = await this.prisma.event.findMany({
        where: {
          status: 'SCHEDULED',
          startTime: { gte: now, lte: horizon },
        },
        include: { campus: true },
      });
      for (const event of events) {
        const tz =
          event.campus?.timezone ?? event.timezone ?? 'America/New_York';
        // 本地开始时间：startTime(UTC) → 目标时区本地时间（§五 R7）
        const localStart = DateTime.fromJSDate(event.startTime, {
          zone: 'utc',
        }).setZone(tz);
        if (!localStart.isValid) continue;
        const content = eventContent(event, localStart, tz);
        for (const rule of eventRules) {
          if (!this.inTriggerWindow(localStart, rule.offsetHoursBefore, now))
            continue;
          const recipients = await this.resolveEventRecipients(event.id);
          triggered += await this.fireRule(
            rule,
            event.id,
            'EVENT',
            recipients,
            content,
          );
        }
      }
    }

    return { triggered };
  }

  // ------------------------------------------------------------ 实际发送

  /** 'reminder-send' 队列的处理器：按 channel 调用 stub provider，成功置 SENT */
  async sendReminder(job: ReminderSendJobData): Promise<void> {
    const log = await this.prisma.reminderLog.findUnique({
      where: { id: job.logId },
      include: { recipient: true },
    });
    if (!log) return; // 日志行被删则直接丢弃
    const { recipient } = log;

    switch (job.channel) {
      case 'sms': {
        if (!recipient.phone) {
          throw new Error(`收件人 ${recipient.id} 没有手机号，无法发送短信`);
        }
        await this.sms.sendSms(recipient.phone, job.body);
        break;
      }
      case 'email': {
        await this.email.sendEmail(recipient.email, job.title, job.body);
        break;
      }
      case 'push':
      case 'app_push': {
        await this.push.sendPush(recipient.id, job.title, job.body);
        break;
      }
      default:
        throw new Error(`不支持的提醒渠道: ${job.channel}`);
    }

    await this.prisma.reminderLog.update({
      where: { id: log.id },
      data: { status: 'SENT' },
    });
  }

  /** 所有重试耗尽后由 ReminderSendWorker 调用，置 FAILED */
  async markLogFailed(logId: string): Promise<void> {
    await this.prisma.reminderLog.update({
      where: { id: logId },
      data: { status: 'FAILED' },
    });
  }

  // ------------------------------------------------------------ 私有辅助

  /** 'reminder-send' 队列（懒加载单例） */
  private getSendQueue(): Queue<ReminderSendJobData> {
    if (!this.sendQueue) {
      this.sendQueue = new Queue<ReminderSendJobData>('reminder-send', {
        connection: redisConnection(),
      });
    }
    return this.sendQueue;
  }

  /**
   * §五 R7 时区基准：触发时刻 = 目标时区本地开始时间减去 offsetHoursBefore，
   * 再转回 UTC。触发窗口为 [触发时刻, 触发时刻 + 5 分钟）。
   * 一律用 luxon + IANA 时区，禁止固定 UTC 偏移。
   */
  private inTriggerWindow(
    localStart: DateTime,
    offsetHoursBefore: number,
    now: Date,
  ): boolean {
    const triggerUtc = localStart
      .minus({ hours: offsetHoursBefore })
      .toUTC()
      .toJSDate();
    const delta = now.getTime() - triggerUtc.getTime();
    return delta >= 0 && delta <= TRIGGER_WINDOW_MS;
  }

  /**
   * 触发一条规则：先建 ReminderLog 行去重（命中 @@unique([ruleId,targetId,recipientId])
   * 的 P2002 直接跳过），再按 channels 逐个入 'reminder-send' 队列
   * （attempts 3 + 指数退避），并经 NotificationsService 写一条 Notification。
   */
  private async fireRule(
    rule: ReminderRule,
    targetId: string,
    targetType: ReminderTargetType,
    recipientIds: string[],
    content: { title: string; body: string },
  ): Promise<number> {
    let count = 0;
    for (const recipientId of recipientIds) {
      let log;
      try {
        log = await this.prisma.reminderLog.create({
          data: {
            ruleId: rule.id,
            targetId,
            recipientId,
            channel: rule.channels.join(','),
            status: 'SENT', // 先占位=已触发；全部渠道最终失败时由 worker 置 FAILED
          },
        });
      } catch (e) {
        if (isUniqueViolation(e)) continue; // 该规则对该目标已提醒过此人
        throw e;
      }

      const queue = this.getSendQueue();
      for (const channel of rule.channels) {
        await queue.add(
          'send',
          {
            logId: log.id,
            ruleId: rule.id,
            recipientId,
            channel,
            title: content.title,
            body: content.body,
          },
          { attempts: 3, backoff: { type: 'exponential', delay: 60000 } },
        );
      }

      await this.notifications.notify({
        userId: recipientId,
        type:
          targetType === ReminderTargetType.SESSION_OCCURRENCE
            ? 'CLASS_REMINDER'
            : 'EVENT_REMINDER',
        title: content.title,
        body: content.body,
        sourceType:
          targetType === ReminderTargetType.SESSION_OCCURRENCE
            ? 'SESSION_OCCURRENCE'
            : 'EVENT',
        sourceId: targetId,
        channels: rule.channels,
      });
      count++;
    }
    return count;
  }

  /** 取扫描窗口内的 SCHEDULED 课次（date 先粗筛，精确起止在内存里按时区算） */
  private async fetchUpcomingOccurrences(
    now: Date,
    horizon: Date,
  ): Promise<OccurrenceForScan[]> {
    const pad = 24 * 3600_000;
    return this.prisma.sessionOccurrence.findMany({
      where: {
        status: 'SCHEDULED',
        date: {
          gte: new Date(now.getTime() - pad),
          lte: new Date(horizon.getTime() + pad),
        },
      },
      include: {
        classSession: {
          include: {
            campus: true,
            course: { select: { title: true, timeRange: true } },
          },
        },
      },
    });
  }

  /**
   * 收件人解析（§五）：所属 ClassSession 下 CONFIRMED 报名的学生，
   * 加上 makeupOccurrenceId 指向本节且 status=BOOKED 的补课学生，
   * 排除 missedOccurrenceId 为本节的请假学生；
   * 再经 ParentStudentLink 取 isPrimaryContact 的家长（无则全部监护人）。
   */
  private async resolveOccurrenceRecipients(
    occurrenceId: string,
    classSessionId: string,
  ): Promise<string[]> {
    const [confirmed, makeup, missed] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { classSessionId, status: 'CONFIRMED' },
        select: { studentId: true },
      }),
      this.prisma.makeupBooking.findMany({
        where: { makeupOccurrenceId: occurrenceId, status: 'BOOKED' },
        select: { enrollment: { select: { studentId: true } } },
      }),
      this.prisma.makeupBooking.findMany({
        where: {
          missedOccurrenceId: occurrenceId,
          status: { not: 'CANCELLED' },
        },
        select: { enrollment: { select: { studentId: true } } },
      }),
    ]);

    const excluded = new Set(missed.map((m) => m.enrollment.studentId));
    const studentIds = new Set<string>();
    for (const e of confirmed) {
      if (!excluded.has(e.studentId)) studentIds.add(e.studentId);
    }
    for (const m of makeup) {
      const sid = m.enrollment.studentId;
      if (!excluded.has(sid)) studentIds.add(sid);
    }

    return this.resolveParentRecipients([...studentIds]);
  }

  /** 收件人解析（§五）：EventRegistration status=REGISTERED 对应的家长 */
  private async resolveEventRecipients(eventId: string): Promise<string[]> {
    const regs = await this.prisma.eventRegistration.findMany({
      where: { eventId, status: 'REGISTERED' },
      select: { parentId: true },
    });
    const parentIds = new Set(regs.map((r) => r.parentId));
    // 只要活跃账号
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...parentIds] }, isActive: true },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** 学生 → 家长：优先 isPrimaryContact，无主要联系人则取全部监护人；只返回活跃账号 */
  private async resolveParentRecipients(
    studentIds: string[],
  ): Promise<string[]> {
    const parentIds = new Set<string>();
    for (const studentId of studentIds) {
      const links = await this.prisma.parentStudentLink.findMany({
        where: { studentId },
        include: { parent: { select: { id: true, isActive: true } } },
      });
      const active = links.filter((l) => l.parent.isActive);
      const primary = active.filter((l) => l.isPrimaryContact);
      const chosen = primary.length > 0 ? primary : active;
      for (const l of chosen) parentIds.add(l.parent.id);
    }
    return [...parentIds];
  }
}

// ------------------------------------------------------------ 时区/文案辅助

/** "17:00-18:00" → "17:00"；取不到返回 null */
function parseRangeStart(timeRange: string | null | undefined): string | null {
  if (!timeRange) return null;
  const m = timeRange.match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : null;
}

/**
 * 课次开始时间（目标时区本地时间）：date（@db.Date，UTC 午夜）+ timeRange 起始钟点
 * （本节 timeRange 为空时取 Course.timeRange），按目标时区解读为本地时间
 * （§五 R7；禁止固定偏移）。无可用时间信息时返回 null（跳过该课次）。
 */
function occurrenceLocalStart(
  occ: OccurrenceForScan,
  tz: string,
): DateTime | null {
  const timeRange = occ.timeRange ?? occ.classSession.course.timeRange;
  const start = parseRangeStart(timeRange);
  if (!start) return null;
  const dateStr = DateTime.fromJSDate(occ.date, { zone: 'utc' }).toFormat(
    'yyyy-MM-dd',
  );
  const local = DateTime.fromFormat(`${dateStr} ${start}`, 'yyyy-MM-dd HH:mm', {
    zone: tz,
  });
  if (!local.isValid) return null;
  return local;
}

function occurrenceContent(
  occ: OccurrenceForScan,
  localStart: DateTime,
  tz: string,
): { title: string; body: string } {
  const title = `上课提醒：${occ.classSession.course.title}`;
  const body =
    `【${occ.classSession.course.title}】第 ${occ.sessionNumber} 节将于 ` +
    `${localStart.toFormat('yyyy-MM-dd HH:mm')}（${tz}）在 ${occ.classSession.campus.name} 开始，请准时参加。`;
  return { title, body };
}

function eventContent(
  event: EventForScan,
  localStart: DateTime,
  tz: string,
): { title: string; body: string } {
  const title = `活动提醒：${event.title}`;
  const body =
    `【${event.title}】将于 ${localStart.toFormat('yyyy-MM-dd HH:mm')}（${tz}）开始` +
    (event.location ? `，地点：${event.location}` : '') +
    '。';
  return { title, body };
}
