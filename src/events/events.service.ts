import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EventRegistrationItemType,
  NotificationSourceType,
  NotificationType,
  Relationship,
} from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AdminRegisterEventDto,
  CreateEventDto,
  CreateNoticeDto,
  IssueFeeDto,
  MergeGroupDto,
  PayEventRegistrationDto,
  RegisterEventDto,
} from './dto/events.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly billingService: BillingService,
  ) {}

  // ---------------------------------------------------------------- 活动（§6.5/6.7）

  /** 发布活动/比赛（ADMIN） */
  async createEvent(adminId: string, dto: CreateEventDto) {
    const start = new Date(dto.start_time);
    const end = new Date(dto.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('活动开始/结束时间格式非法');
    }
    if (end <= start) {
      throw new BadRequestException('结束时间必须晚于开始时间');
    }
    if (dto.campus_id) {
      const campus = await this.prisma.campus.findUnique({
        where: { id: dto.campus_id },
      });
      if (!campus) throw new NotFoundException(`校区不存在：${dto.campus_id}`);
    }
    if (dto.requires_ticket) {
      const hasTiers = dto.ticket_tiers && dto.ticket_tiers.length > 0;
      if (!hasTiers && (dto.ticket_price_cents ?? 0) <= 0) {
        throw new BadRequestException('需要购票的活动必须设置票单价或至少一个票种');
      }
    }
    return this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        campusId: dto.campus_id ?? null,
        timezone: dto.timezone ?? null,
        location: dto.location ?? null,
        startTime: start,
        endTime: end,
        requiresRegistration: dto.requires_registration ?? true,
        capacity: dto.capacity ?? null,
        category: dto.category ?? 'EVENT',
        requiresTicket: dto.requires_ticket ?? false,
        ticketPriceCents: dto.ticket_price_cents ?? null,
        maxTicketsPerRegistration: dto.max_tickets_per_registration ?? null,
        participationFeeCents: dto.participation_fee_cents ?? null,
        feeMode: dto.fee_mode ?? null,
        groupSize: dto.group_size ?? null,
        ...(dto.ticket_tiers && dto.ticket_tiers.length > 0
          ? { ticketTiers: dto.ticket_tiers as unknown as object }
          : {}),
      },
    });
  }

  /**
   * SPLIT 均摊重算：同 eventId + 同 groupKey 为一组，总费用均摊（向上取整），
   * 只统计 REGISTERED/WAITLISTED（取消的不计入）。
   */
  private async recalcSplitGroup(eventId: string, groupKey: string, totalFeeCents: number) {
    const members = await this.prisma.eventRegistration.findMany({
      where: {
        eventId,
        groupKey,
        status: { in: ['REGISTERED', 'WAITLISTED'] },
      },
      select: { id: true },
    });
    const perPerson = Math.ceil(totalFeeCents / Math.max(1, members.length));
    if (members.length > 0) {
      await this.prisma.eventRegistration.updateMany({
        where: { id: { in: members.map((m) => m.id) } },
        data: { participationFeeCents: perPerson },
      });
    }
    return { memberCount: members.length, perPerson };
  }

  /**
   * 票种解析：根据 tierName 在 event.ticketTiers 里找票种，校验有效期与起购数。
   * 返回 { tierName, priceCents }。tierName 为空时用默认票价（兼容旧逻辑）。
   */
  private resolveTicketTier(
    event: { ticketTiers: unknown; ticketPriceCents: number | null },
    tierName: string | undefined,
    quantity: number,
  ): { tierName: string | null; priceCents: number } {
    if (!tierName) {
      return { tierName: null, priceCents: event.ticketPriceCents ?? 0 };
    }
    const tiers = (event.ticketTiers as Array<{
      name: string;
      price_cents: number;
      min_quantity?: number;
      valid_until?: string;
    }> | null) ?? [];
    const tier = tiers.find((t) => t.name === tierName);
    if (!tier) {
      throw new BadRequestException(`票种不存在：${tierName}`);
    }
    if (tier.valid_until && new Date(tier.valid_until).getTime() < Date.now()) {
      throw new BadRequestException(`票种「${tierName}」已过优惠期`);
    }
    if (tier.min_quantity != null && quantity < tier.min_quantity) {
      throw new BadRequestException(`票种「${tierName}」最少购买 ${tier.min_quantity} 张`);
    }
    return { tierName: tier.name, priceCents: tier.price_cents };
  }

  /** 记录票种购票累计（EventRegistration.ticketTierBreakdown） */
  private async recordTierPurchase(
    registrationId: string,
    tierName: string | null,
    quantity: number,
    totalCents: number,
  ) {
    const key = tierName ?? '标准票';
    const reg = await this.prisma.eventRegistration.findUnique({
      where: { id: registrationId },
      select: { ticketTierBreakdown: true },
    });
    const breakdown = (
      (reg?.ticketTierBreakdown as Record<string, { quantity: number; totalCents: number }> | null) ?? {}
    );
    const cur = breakdown[key] ?? { quantity: 0, totalCents: 0 };
    breakdown[key] = {
      quantity: cur.quantity + quantity,
      totalCents: cur.totalCents + totalCents,
    };
    await this.prisma.eventRegistration.update({
      where: { id: registrationId },
      data: { ticketTierBreakdown: breakdown },
    });
  }

  /** 活动列表（公开）：仅可报名（SCHEDULED + requiresRegistration）的未来活动 */
  async publicListEvents(category?: string) {
    const rows = await this.prisma.event.findMany({
      where: {
        status: 'SCHEDULED',
        requiresRegistration: true,
        startTime: { gte: new Date() },
        ...(category === 'EVENT' || category === 'COMPETITION' ? { category } : {}),
      },
      select: {
        id: true,
        title: true,
        category: true,
        startTime: true,
        endTime: true,
        location: true,
        requiresTicket: true,
        ticketPriceCents: true,
        capacity: true,
        participationFeeCents: true,
        feeMode: true,
        groupSize: true,
        campus: { select: { id: true, name: true } },
        _count: { select: { registrations: true } },
      },
      orderBy: { startTime: 'asc' },
    });
    return rows;
  }

  /** 活动详情（公开） */
  async getEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { campus: { select: { id: true, name: true, timezone: true } } },
    });
    if (!event) throw new NotFoundException(`活动不存在：${eventId}`);
    return event;
  }

  /** 我的活动报名（家长 / 成人学员） */
  async myEventRegistrations(userId: string) {
    const links = await this.prisma.parentStudentLink.findMany({
      where: { parentId: userId },
      select: { studentId: true },
    });
    const studentIds = links.map((l) => l.studentId);
    return this.prisma.eventRegistration.findMany({
      where: {
        OR: [{ parentId: userId }, { studentId: { in: studentIds } }],
        status: { not: 'CANCELLED' },
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            category: true,
            startTime: true,
            endTime: true,
            location: true,
          },
        },
        student: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 报名活动/比赛（§6.6/6.7）。
   * ticket_total_cents = 单价 × 数量写入报名；requires_ticket 时生成
   * TICKET 订单 + EventRegistrationOrder（门票款与参赛费拆单，§6.6）。
   */
  async register(user: RequestUser, eventId: string, dto: RegisterEventDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException(`活动不存在：${eventId}`);
    if (!event.requiresRegistration) {
      throw new BadRequestException('该活动无需报名');
    }
    if (event.status !== 'SCHEDULED') {
      throw new ConflictException('该活动当前不可报名');
    }

    const studentId = await this.resolveRegistrationStudent(user, dto.student_id);

    let ticketQuantity: number | null = null;
    let ticketTotalCents: number | null = null;
    let ticketTierName: string | null = null;
    if (event.requiresTicket) {
      const qty = dto.ticket_quantity ?? 1;
      if (
        event.maxTicketsPerRegistration &&
        qty > event.maxTicketsPerRegistration
      ) {
        throw new BadRequestException(
          `单次报名最多购票 ${event.maxTicketsPerRegistration} 张`,
        );
      }
      const tier = this.resolveTicketTier(event, dto.tier_name, qty);
      ticketTierName = tier.tierName;
      ticketQuantity = qty;
      ticketTotalCents = tier.priceCents * qty;
    }

    // 同一用户同一活动重复报名 → 幂等返回已有记录
    const dup = await this.prisma.eventRegistration.findFirst({
      where: {
        eventId,
        parentId: user.id,
        studentId,
        status: { in: ['REGISTERED', 'WAITLISTED'] },
      },
    });
    if (dup) return dup;

    const registration = await this.prisma.eventRegistration.create({
      data: {
        eventId,
        studentId,
        parentId: user.id,
        status: 'REGISTERED',
        ticketQuantity,
        ticketTotalCents,
      },
    });

    if (event.requiresTicket && (ticketTotalCents ?? 0) > 0) {
      await this.createTicketOrder(user.id, registration.id, ticketTotalCents!, ticketTierName);
      await this.recordTierPurchase(registration.id, ticketTierName, ticketQuantity!, ticketTotalCents!);
    }

    // SPLIT 组队：家长自助报名可发起/加入组队
    if (event.feeMode === 'SPLIT' && event.participationFeeCents != null && event.participationFeeCents > 0) {
      const action = dto.group_action;
      if (action === 'create') {
        if (!dto.group_name?.trim()) {
          throw new BadRequestException('发起组队请填写组名');
        }
        const groupKey = randomUUID();
        await this.prisma.eventRegistration.update({
          where: { id: registration.id },
          data: { groupKey, groupName: dto.group_name.trim() },
        });
        await this.recalcSplitGroup(eventId, groupKey, event.participationFeeCents);
      } else if (action === 'join') {
        if (!dto.group_key) {
          throw new BadRequestException('加入组队请选择要加入的组');
        }
        await this.joinSplitGroup(eventId, registration.id, dto.group_key);
      } else {
        // 未指定组队动作：单独一组（按人全额）
        const groupKey = randomUUID();
        await this.prisma.eventRegistration.update({
          where: { id: registration.id },
          data: {
            groupKey,
            participationFeeCents: event.participationFeeCents,
          },
        });
      }
    } else if (event.participationFeeCents != null && event.participationFeeCents > 0) {
      // PER_PERSON：每人交全额
      await this.prisma.eventRegistration.update({
        where: { id: registration.id },
        data: { participationFeeCents: event.participationFeeCents },
      });
    }
    return registration;
  }

  /**
   * 加入 SPLIT 组：校验组存在、同活动、人数未满（groupSize），加入后重算全组费用。
   */
  private async joinSplitGroup(eventId: string, registrationId: string, groupKey: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { groupSize: true, participationFeeCents: true },
    });
    if (!event) throw new NotFoundException(`活动不存在：${eventId}`);
    const existing = await this.prisma.eventRegistration.findMany({
      where: {
        eventId,
        groupKey,
        status: { in: ['REGISTERED', 'WAITLISTED'] },
      },
      select: { id: true, groupName: true },
    });
    if (existing.length === 0) {
      throw new BadRequestException('该组不存在或已解散');
    }
    if (event.groupSize != null && existing.length >= event.groupSize) {
      throw new BadRequestException(`该组已满（${event.groupSize} 人）`);
    }
    const groupName = existing[0].groupName;
    await this.prisma.eventRegistration.update({
      where: { id: registrationId },
      data: { groupKey, groupName },
    });
    await this.recalcSplitGroup(eventId, groupKey, event.participationFeeCents ?? 0);
  }

  /**
   * 管理员代报名活动/比赛（ADMIN）：POST /admin/events/:id/register。
   * 家长电话报名、现场报名等场景；票务逻辑与 register 一致。
   */
  async adminRegister(adminId: string, eventId: string, dto: AdminRegisterEventDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException(`活动不存在：${eventId}`);
    if (!event.requiresRegistration) {
      throw new BadRequestException('该活动无需报名');
    }
    if (event.status !== 'SCHEDULED') {
      throw new ConflictException('该活动当前不可报名');
    }

    const student = await this.prisma.student.findUnique({
      where: { id: dto.student_id },
      include: { parentLinks: true },
    });
    if (!student) throw new NotFoundException(`学员不存在：${dto.student_id}`);
    // 优先：成人学员自己（SELF）> 首选联系人 > 第一个；无家长关联时用管理员ID兜底（允许代报名）
    const link =
      student.parentLinks.find((l) => l.relationship === Relationship.SELF) ??
      student.parentLinks.find((l) => l.isPrimaryContact) ??
      student.parentLinks[0];
    const parentId = link?.parentId ?? adminId;

    // 容量检查
    if (event.capacity != null) {
      const count = await this.prisma.eventRegistration.count({
        where: { eventId, status: 'REGISTERED' },
      });
      if (count >= event.capacity) {
        throw new BadRequestException('名额已满');
      }
    }

    // 票务逻辑照抄 register（含多票种）
    let ticketQuantity: number | null = null;
    let ticketTotalCents: number | null = null;
    let ticketTierName: string | null = null;
    if (event.requiresTicket) {
      const qty = dto.ticket_quantity ?? 1;
      if (
        event.maxTicketsPerRegistration &&
        qty > event.maxTicketsPerRegistration
      ) {
        throw new BadRequestException(
          `单次报名最多购票 ${event.maxTicketsPerRegistration} 张`,
        );
      }
      const tier = this.resolveTicketTier(event, dto.tier_name, qty);
      ticketTierName = tier.tierName;
      ticketQuantity = qty;
      ticketTotalCents = tier.priceCents * qty;
    }

    // 同一活动同学员重复报名 → 幂等返回已有记录
    const dup = await this.prisma.eventRegistration.findFirst({
      where: {
        eventId,
        studentId: student.id,
        status: { in: ['REGISTERED', 'WAITLISTED'] },
      },
    });
    if (dup) return dup;

    const registration = await this.prisma.eventRegistration.create({
      data: {
        eventId,
        studentId: student.id,
        parentId,
        status: 'REGISTERED',
        ticketQuantity,
        ticketTotalCents,
      },
    });

    if (event.requiresTicket && (ticketTotalCents ?? 0) > 0) {
      await this.createTicketOrder(parentId, registration.id, ticketTotalCents!, ticketTierName);
      await this.recordTierPurchase(registration.id, ticketTierName, ticketQuantity!, ticketTotalCents!);
    }

    // 比赛报名费自动计算（feeStatus 保持 NOT_SET，缴费走 issue-fee/pay 流程）
    if (event.participationFeeCents != null && event.participationFeeCents > 0) {
      if (event.feeMode === 'SPLIT') {
        // SPLIT：同 eventId + 同 groupKey 为一组，总费用均摊；新成员加入后重算全组
        if (dto.group_key) {
          // 加入现有组（校验人数上限）
          await this.joinSplitGroup(eventId, registration.id, dto.group_key);
          if (dto.group_name?.trim()) {
            // 允许代报名时顺手改组名
            const reg = await this.prisma.eventRegistration.findUnique({
              where: { id: registration.id },
              select: { groupKey: true },
            });
            if (reg?.groupKey) {
              await this.prisma.eventRegistration.updateMany({
                where: { eventId, groupKey: reg.groupKey },
                data: { groupName: dto.group_name.trim() },
              });
            }
          }
        } else {
          const groupKey = randomUUID();
          await this.prisma.eventRegistration.update({
            where: { id: registration.id },
            data: { groupKey, groupName: dto.group_name?.trim() || null },
          });
          await this.recalcSplitGroup(eventId, groupKey, event.participationFeeCents);
        }
      } else {
        // PER_PERSON（默认）：每人交全额
        await this.prisma.eventRegistration.update({
          where: { id: registration.id },
          data: { participationFeeCents: event.participationFeeCents },
        });
      }
    }

    // 通知家长（失败不影响报名）
    try {
      await this.notifications.notify({
        userId: parentId,
        type: NotificationType.NOTICE,
        title: `管理员已帮您的孩子报名「${event.title}」`,
        body: `学员${student.name}已成功报名${event.category === 'COMPETITION' ? '比赛' : '活动'}「${event.title}」，请留意后续通知。`,
        sourceType: NotificationSourceType.EVENT,
        sourceId: event.id,
      });
    } catch {
      /* ignore */
    }

    return registration;
  }

  /**
   * 管理员合并分组（ADMIN）：POST /admin/event-registrations/merge-group。
   * 把多个报名合并为同一组（SPLIT 均摊），重算每人费用。
   */
  async mergeGroup(dto: MergeGroupDto) {
    if (!dto.registration_ids || dto.registration_ids.length < 2) {
      throw new BadRequestException('请至少选择 2 条报名记录进行分组');
    }
    const regs = await this.prisma.eventRegistration.findMany({
      where: { id: { in: dto.registration_ids } },
      include: { event: true },
    });
    if (regs.length !== dto.registration_ids.length) {
      throw new NotFoundException('部分报名记录不存在');
    }
    const eventIds = new Set(regs.map((r) => r.eventId));
    if (eventIds.size !== 1) {
      throw new BadRequestException('只能合并同一活动的报名');
    }
    const event = regs[0].event;
    if (event.feeMode !== 'SPLIT') {
      throw new BadRequestException('仅按组均摊（SPLIT）模式的比赛支持分组');
    }
    if (event.groupSize != null && regs.length > event.groupSize) {
      throw new BadRequestException(`该组人数上限为 ${event.groupSize} 人`);
    }

    // 组名：不传则自动命名"第X组"
    let groupName = dto.group_name?.trim();
    if (!groupName) {
      const groupCount = await this.prisma.eventRegistration.groupBy({
        by: ['groupKey'],
        where: { eventId: event.id, groupKey: { not: null } },
      });
      groupName = `第${groupCount.length + 1}组`;
    }

    const groupKey = randomUUID();
    await this.prisma.eventRegistration.updateMany({
      where: { id: { in: dto.registration_ids } },
      data: { groupKey, groupName },
    });
    const { memberCount, perPerson } = await this.recalcSplitGroup(
      event.id,
      groupKey,
      event.participationFeeCents ?? 0,
    );
    return {
      groupKey,
      groupName,
      memberCount,
      perPersonCents: perPerson,
      registrationIds: dto.registration_ids,
    };
  }

  /**
   * 活动分组列表：GET /events/:id/groups。
   * 返回该活动所有组（组名/人数/成员），供家长加入组队时选择。
   */
  async listGroups(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, groupSize: true, feeMode: true },
    });
    if (!event) throw new NotFoundException(`活动不存在：${eventId}`);
    const regs = await this.prisma.eventRegistration.findMany({
      where: {
        eventId,
        groupKey: { not: null },
        status: { in: ['REGISTERED', 'WAITLISTED'] },
      },
      include: {
        student: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const map = new Map<
      string,
      {
        groupKey: string;
        groupName: string | null;
        members: Array<{
          registrationId: string;
          studentName: string;
          parentName: string;
        }>;
      }
    >();
    for (const r of regs) {
      const key = r.groupKey!;
      if (!map.has(key)) {
        map.set(key, { groupKey: key, groupName: r.groupName, members: [] });
      }
      map.get(key)!.members.push({
        registrationId: r.id,
        studentName: r.student?.name ?? '—',
        parentName: r.parent?.name ?? '—',
      });
    }
    return [...map.values()].map((g) => ({
      ...g,
      memberCount: g.members.length,
      isFull: event.groupSize != null && g.members.length >= event.groupSize,
    }));
  }

  /**
   * 加购门票（POST /event-registrations/:id/add-tickets）。
   * 报名后多次加购：每笔独立 TICKET 订单；累加 registration.ticketQuantity/ticketTotalCents。
   */
  async addTickets(user: RequestUser, registrationId: string, quantity: number, tierName?: string) {
    const reg = await this.assertRegistrationAccessible(user, registrationId);
    const event = await this.prisma.event.findUnique({
      where: { id: reg.eventId },
    });
    if (!event) throw new NotFoundException(`活动不存在：${reg.eventId}`);
    if (!event.requiresTicket) {
      throw new BadRequestException('该活动无需购票');
    }
    if (event.status !== 'SCHEDULED') {
      throw new ConflictException('该活动当前不可购票');
    }
    if (event.maxTicketsPerRegistration && quantity > event.maxTicketsPerRegistration) {
      throw new BadRequestException(`单次加购最多 ${event.maxTicketsPerRegistration} 张`);
    }
    const tier = this.resolveTicketTier(event, tierName, quantity);
    const totalCents = quantity * tier.priceCents;
    const order = await this.createTicketOrder(reg.parentId, reg.id, totalCents, tier.tierName);
    await this.prisma.eventRegistration.update({
      where: { id: reg.id },
      data: {
        ticketQuantity: { increment: quantity },
        ticketTotalCents: { increment: totalCents },
      },
    });
    await this.recordTierPurchase(reg.id, tier.tierName, quantity, totalCents);
    return order;
  }

  /**
   * 购票看板（GET /admin/events/:id/tickets，ADMIN）。
   * 汇总 + 按学员明细（购票张数/金额/已付/待付/订单列表）。
   */
  async ticketDashboard(eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`活动不存在：${eventId}`);

    const regs = await this.prisma.eventRegistration.findMany({
      where: { eventId, ticketQuantity: { gt: 0 } },
      include: {
        student: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true, phone: true } },
        registrationOrders: {
          where: { itemType: 'TICKET' },
          include: { order: true },
        },
      },
      orderBy: { ticketQuantity: 'desc' },
    });

    const rows = regs.map((r) => {
      const orders = r.registrationOrders.map((ro) => ({
        id: ro.order.id,
        amountCents: ro.order.amountCents,
        status: ro.order.status,
        createdAt: ro.order.createdAt,
      }));
      const paidCents = orders
        .filter((o) => o.status === 'PAID')
        .reduce((s, o) => s + o.amountCents, 0);
      const totalCents = r.ticketTotalCents ?? 0;
      return {
        registrationId: r.id,
        student: r.student,
        parent: r.parent,
        quantity: r.ticketQuantity ?? 0,
        totalCents,
        paidCents,
        unpaidCents: totalCents - paidCents,
        orders,
      };
    });

    const summary = {
      totalQuantity: rows.reduce((s, r) => s + r.quantity, 0),
      buyerCount: rows.length,
      totalCents: rows.reduce((s, r) => s + r.totalCents, 0),
      paidCents: rows.reduce((s, r) => s + r.paidCents, 0),
    };

    // 按票种汇总（优先用 ticketTierBreakdown；老数据无 breakdown 的归入"标准票"）
    const byTierMap = new Map<string, { quantity: number; totalCents: number }>();
    for (const r of regs) {
      const bd = (r.ticketTierBreakdown as Record<string, { quantity: number; totalCents: number }> | null) ?? null;
      if (bd && Object.keys(bd).length > 0) {
        for (const [name, v] of Object.entries(bd)) {
          const cur = byTierMap.get(name) ?? { quantity: 0, totalCents: 0 };
          cur.quantity += v.quantity ?? 0;
          cur.totalCents += v.totalCents ?? 0;
          byTierMap.set(name, cur);
        }
      } else if ((r.ticketQuantity ?? 0) > 0) {
        const cur = byTierMap.get('标准票') ?? { quantity: 0, totalCents: 0 };
        cur.quantity += r.ticketQuantity ?? 0;
        cur.totalCents += r.ticketTotalCents ?? 0;
        byTierMap.set('标准票', cur);
      }
    }
    const byTier = [...byTierMap.entries()].map(([tierName, v]) => ({
      tierName,
      quantity: v.quantity,
      totalCents: v.totalCents,
    }));
    return { summary: { ...summary, byTier }, rows };
  }

  /** 取消活动报名（学员端归属 / ADMIN） */
  async cancelRegistration(user: RequestUser, registrationId: string) {
    const reg = await this.assertRegistrationAccessible(user, registrationId);
    if (reg.status === 'CANCELLED') return reg;
    const updated = await this.prisma.eventRegistration.update({
      where: { id: registrationId },
      data: { status: 'CANCELLED' },
    });
    // SPLIT 组有人退出：重算该组剩余成员费用
    if (reg.groupKey) {
      const event = await this.prisma.event.findUnique({
        where: { id: reg.eventId },
        select: { feeMode: true, participationFeeCents: true },
      });
      if (
        event?.feeMode === 'SPLIT' &&
        event.participationFeeCents != null &&
        event.participationFeeCents > 0
      ) {
        await this.recalcSplitGroup(reg.eventId, reg.groupKey, event.participationFeeCents);
      }
    }
    return updated;
  }

  /**
   * 发放参赛/参与费用（ADMIN）：报名上写 participation_fee_cents，
   * feeStatus → ISSUED，并生成 PARTICIPATION_FEE 订单
   * + EventRegistrationOrder（§6.6/6.7）。
   */
  async issueFee(adminId: string, registrationId: string, dto: IssueFeeDto) {
    const reg = await this.prisma.eventRegistration.findUnique({
      where: { id: registrationId },
    });
    if (!reg) throw new NotFoundException(`活动报名不存在：${registrationId}`);
    if (reg.status === 'CANCELLED') {
      throw new ConflictException('已取消的报名不能发放费用');
    }

    const updated = await this.prisma.eventRegistration.update({
      where: { id: registrationId },
      data: {
        participationFeeCents: dto.participation_fee_cents,
        feeStatus: 'ISSUED',
      },
    });
    await this.createParticipationFeeOrder(
      reg.parentId,
      registrationId,
      dto.participation_fee_cents,
    );
    return updated;
  }

  /**
   * 学员缴费（§6.7）：{ item_type }。
   * 按 item_type 定位 TICKET / PARTICIPATION_FEE 订单后走 billing 流程
   *（此处为该订单发起 Stripe Checkout；线下渠道可用自助提交付款接口）。
   */
  async payRegistration(
    user: RequestUser,
    registrationId: string,
    dto: PayEventRegistrationDto,
  ) {
    const reg = await this.assertRegistrationAccessible(user, registrationId);
    const link = await this.prisma.eventRegistrationOrder.findFirst({
      where: {
        eventRegistrationId: reg.id,
        itemType: dto.item_type as EventRegistrationItemType,
      },
      include: { order: true },
    });
    if (!link) {
      throw new NotFoundException(
        `该报名没有待缴的 ${dto.item_type === 'TICKET' ? '门票款' : '参赛费'} 订单`,
      );
    }
    if (['CANCELLED', 'FAILED'].includes(link.order.status)) {
      throw new ConflictException('订单已关闭，无法缴费');
    }
    return this.billingService.createCheckoutSession(user, link.orderId);
  }

  // ---------------------------------------------------------------- 通知（§4.7/6.28）

  /**
   * 发布通知（ADMIN）：写 Notice，按 scope 展开成多条 Notification
   *（type=NOTICE, sourceType=NOTICE），写入后打 sentAt。
   */
  async createNotice(adminId: string, dto: CreateNoticeDto) {
    const notice = await this.prisma.notice.create({
      data: {
        title: dto.title,
        content: dto.content,
        scopeType: dto.scope_type,
        scopeId: dto.scope_id ?? null,
        channels: dto.channels ?? ['app_push'],
        createdById: adminId,
      },
    });
    const userIds = await this.resolveNoticeRecipients(
      dto.scope_type,
      dto.scope_id,
    );
    for (const userId of userIds) {
      await this.notifications.notify({
        userId,
        type: NotificationType.NOTICE,
        title: dto.title,
        body: dto.content,
        sourceType: NotificationSourceType.NOTICE,
        sourceId: notice.id,
        channels: notice.channels,
      });
    }
    return this.prisma.notice.update({
      where: { id: notice.id },
      data: { sentAt: new Date() },
    });
  }

  /** 我的通知（type=NOTICE） */
  async myNotices(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId, type: 'NOTICE' },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------- 内部工具

  /** 报名学员解析：显式传入则校验归属；缺省时成人学员取 SELF 绑定 */
  private async resolveRegistrationStudent(
    user: RequestUser,
    studentId?: string,
  ): Promise<string | null> {
    if (studentId) {
      if (user.role !== 'ADMIN') {
        const link = await this.prisma.parentStudentLink.findUnique({
          where: { parentId_studentId: { parentId: user.id, studentId } },
        });
        if (!link) throw new ForbiddenException('无权为该学员报名活动');
      }
      return studentId;
    }
    const selfLink = await this.prisma.parentStudentLink.findFirst({
      where: { parentId: user.id, relationship: 'SELF' },
      select: { studentId: true },
    });
    return selfLink?.studentId ?? null;
  }

  /** 活动报名归属校验：操作人本人或 ADMIN */
  private async assertRegistrationAccessible(
    user: RequestUser,
    registrationId: string,
  ) {
    const reg = await this.prisma.eventRegistration.findUnique({
      where: { id: registrationId },
    });
    if (!reg) throw new NotFoundException(`活动报名不存在：${registrationId}`);
    if (reg.parentId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('无权操作该活动报名');
    }
    return reg;
  }

  /**
   * 门票订单（TICKET）：直接经 prisma 建 Order + OrderItem + EventRegistrationOrder。
   * 说明：billingService.createOrder 当前只支持"报名明细 + 参赛费"
   * 两种明细，无法表达 TICKET 类型与票款金额，故按 §6.6 门票/参赛费
   * 拆单语义在 events 模块内建单（后续可扩展 createOrder 支持）。
   */
  private async createTicketOrder(
    parentId: string,
    registrationId: string,
    ticketTotalCents: number,
    tierName?: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          parentId,
          amountCents: ticketTotalCents,
          originalAmountCents: ticketTotalCents,
          paymentMethod: 'STRIPE',
          items: {
            create: [
              {
                eventRegistrationId: registrationId,
                description: tierName ? `活动门票款（${tierName}）` : '活动门票款',
                amountCents: ticketTotalCents,
              },
            ],
          },
        },
      });
      await tx.eventRegistrationOrder.create({
        data: {
          eventRegistrationId: registrationId,
          orderId: order.id,
          itemType: 'TICKET',
        },
      });
      return order;
    });
  }

  /** 参赛费订单（PARTICIPATION_FEE），同上按 §6.6 拆单语义建单 */
  private async createParticipationFeeOrder(
    parentId: string,
    registrationId: string,
    feeCents: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          parentId,
          amountCents: feeCents,
          originalAmountCents: feeCents,
          paymentMethod: 'STRIPE',
          items: {
            create: [
              {
                eventRegistrationId: registrationId,
                description: '活动参赛费/参与费',
                amountCents: feeCents,
              },
            ],
          },
        },
      });
      await tx.eventRegistrationOrder.create({
        data: {
          eventRegistrationId: registrationId,
          orderId: order.id,
          itemType: 'PARTICIPATION_FEE',
        },
      });
      return order;
    });
  }

  /**
   * 通知收件人展开（§6.28 / 2.11）：
   * - ALL：全部启用用户
   * - CAMPUS：该校区班级下已报名学员的家长 + 任课教师
   * - COURSE：该课程各班已报名学员的家长 + 任教教师
   * - CLASS_SESSION：该班已报名学员的家长 + 任课教师
   * - FAMILY：scope_id 指定的家长用户
   */
  private async resolveNoticeRecipients(
    scopeType: CreateNoticeDto['scope_type'],
    scopeId?: string,
  ): Promise<string[]> {
    const userIds = new Set<string>();
    const addEnrollmentFamilies = async (where: {
      classSessionId?: string;
      classSession?: { campusId?: string; courseId?: string };
    }) => {
      const enrollments = await this.prisma.enrollment.findMany({
        where: {
          status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
          ...where,
        },
        include: {
          student: { include: { parentLinks: { select: { parentId: true } } } },
          classSession: { include: { instructor: true } },
        },
      });
      for (const e of enrollments) {
        for (const l of e.student.parentLinks) userIds.add(l.parentId);
        if (e.classSession.instructor) {
          userIds.add(e.classSession.instructor.userId);
        }
      }
    };

    switch (scopeType) {
      case 'ALL': {
        const users = await this.prisma.user.findMany({
          where: { isActive: true },
          select: { id: true },
        });
        for (const u of users) userIds.add(u.id);
        break;
      }
      case 'FAMILY': {
        if (!scopeId) throw new BadRequestException('FAMILY 范围需要 scope_id');
        const user = await this.prisma.user.findUnique({
          where: { id: scopeId },
        });
        if (!user) throw new NotFoundException(`用户不存在：${scopeId}`);
        userIds.add(user.id);
        break;
      }
      case 'CAMPUS': {
        if (!scopeId) throw new BadRequestException('CAMPUS 范围需要 scope_id');
        await addEnrollmentFamilies({
          classSession: { campusId: scopeId },
        });
        break;
      }
      case 'COURSE': {
        if (!scopeId) throw new BadRequestException('COURSE 范围需要 scope_id');
        await addEnrollmentFamilies({
          classSession: { courseId: scopeId },
        });
        break;
      }
      case 'CLASS_SESSION': {
        if (!scopeId) {
          throw new BadRequestException('CLASS_SESSION 范围需要 scope_id');
        }
        await addEnrollmentFamilies({ classSessionId: scopeId });
        break;
      }
    }
    return [...userIds];
  }

  // ---------------------------------------------------------------- 活动管理（ADMIN）

  /**
   * 活动列表（GET /admin/events，ADMIN）：
   * [{ id, title, startTime, endTime, venue, _count: { registrations } }]，
   * 按 startTime 倒序。venue 取 Event.location（schema 无 venue 字段）。
   */
  async listEvents() {
    const rows = await this.prisma.event.findMany({
      select: {
        id: true,
        title: true,
        category: true,
        startTime: true,
        endTime: true,
        location: true,
        _count: { select: { registrations: true } },
      },
      orderBy: { startTime: 'desc' },
    });
    return rows.map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category,
      startTime: e.startTime,
      endTime: e.endTime,
      venue: e.location,
      _count: e._count,
    }));
  }

  /**
   * 活动报名名单（GET /admin/events/:id/registrations，ADMIN）。
   * 字段取自 EventRegistration（含 student / parent 的 name、phone）。
   * 注：schema 的 EventRegistration 无 groupName / paidAt 字段，故不返回。
   */
  async listRegistrations(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException(`活动不存在：${eventId}`);
    const regs = await this.prisma.eventRegistration.findMany({
      where: { eventId },
      include: {
        student: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return regs.map((r) => ({
      id: r.id,
      student: r.student,
      parent: r.parent,
      status: r.status,
      ticketQuantity: r.ticketQuantity,
      ticketTotalCents: r.ticketTotalCents,
      participationFeeCents: r.participationFeeCents,
      feeStatus: r.feeStatus,
      groupKey: r.groupKey,
      groupName: r.groupName,
      createdAt: r.createdAt,
    }));
  }

  /**
   * 活动报名名单导出 CSV（GET /admin/events/:id/registrations/export，ADMIN）：
   * 带 UTF-8 BOM，列：姓名,联系人,电话,组别,状态,费用(元),报名时间。
   * 组别列为空（schema 无该字段）；费用取 participationFeeCents ?? ticketTotalCents。
   */
  async exportRegistrationsCsv(eventId: string): Promise<string> {
    const regs = await this.listRegistrations(eventId);
    const header = '姓名,联系人,电话,组别,状态,费用(元),报名时间';
    const lines = regs.map((r) => {
      const name = r.student?.name ?? r.parent.name;
      const feeCents = r.participationFeeCents ?? r.ticketTotalCents ?? 0;
      return [
        name,
        r.parent.name,
        r.parent.phone ?? '',
        '',
        r.status,
        (feeCents / 100).toFixed(2),
        r.createdAt.toISOString(),
      ]
        .map(csvCell)
        .join(',');
    });
    return '\uFEFF' + [header, ...lines].join('\n');
  }
}

/** CSV 单元格转义：含逗号/引号/换行时加引号并转义引号 */
function csvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
