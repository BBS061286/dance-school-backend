import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceStatus,
  CancelRequestStatus,
  NotificationSourceType,
  NotificationType,
  OccurrenceStatus,
} from '@prisma/client';
import { RequestUser, TxClient } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CancelOccurrenceDto, CheckInDto } from './dto/attendance.dto';
import { CheckInByCodeDto } from './dto/checkin-code.dto';
import { signCheckInCode, verifyCheckInCode } from './checkin-code.util';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- 生成课次

  /**
   * 课次生成规则（§6.1）：按期（TERM）课程从 start_date 当周起，按
   * Course.weekdays 依次在这些星期几上生成课次，直到凑满 total_sessions。
   * 每节默认时间取 Course.timeRange；并据此推算 Course.endDate（未设置时）。
   * 返回生成的课次列表。顺延逻辑（cancel-and-postpone）复用同一 weekday 规则。
   */
  async generateOccurrences(classSessionId: string) {
    const session = await this.prisma.classSession.findUnique({
      where: { id: classSessionId },
      include: { course: true },
    });
    if (!session) throw new NotFoundException(`班级档期不存在：${classSessionId}`);
    const course = session.course;
    if (!course.weekdays?.length) {
      throw new BadRequestException('该课程未配置固定排课星期（weekdays），无法自动生成课次');
    }
    if (!course.totalSessions || course.totalSessions <= 0) {
      throw new BadRequestException('该课程未配置总课次数（total_sessions），无法自动生成课次');
    }

    const weekdays = [...course.weekdays].sort((a, b) => a - b);
    const skipDates = await this.holidayDateSet();
    const dates = this.computeTermDates(
      new Date(course.startDate),
      weekdays,
      course.totalSessions,
      skipDates,
    );

    const existingMax =
      (await this.prisma.sessionOccurrence.aggregate({
        where: { classSessionId },
        _max: { sessionNumber: true },
      }))._max.sessionNumber ?? 0;

    const created = await this.prisma.$transaction(
      dates.map((date, i) =>
        this.prisma.sessionOccurrence.create({
          data: {
            classSessionId,
            sessionNumber: existingMax + i + 1,
            date,
            status: 'SCHEDULED',
            timeRange: course.timeRange ?? null,
          },
        }),
      ),
    );

    // 据生成结果推算 Course.endDate（未设置时）
    if (!course.endDate && dates.length > 0) {
      await this.prisma.course.update({
        where: { id: course.id },
        data: { endDate: dates[dates.length - 1] },
      });
    }
    return created;
  }

  /**
   * 按 weekdays 从 startDate 当周起依次生成 total 个上课日期。
   * weekdays 使用 JS 约定（0=周日..6=周六），date 均为 UTC 午夜（@db.Date）。
   * skipDates：要跳过的日期（YYYY-MM-DD，如学校假期），跳过后自动往后延，保证总数不变。
   */
  private computeTermDates(
    startDate: Date,
    weekdays: number[],
    total: number,
    skipDates?: Set<string>,
  ): Date[] {
    const dates: Date[] = [];
    const startDay = startDate.getUTCDay();
    // startDate 所在周的周日（UTC）
    const weekStart = new Date(
      Date.UTC(
        startDate.getUTCFullYear(),
        startDate.getUTCMonth(),
        startDate.getUTCDate() - startDay,
      ),
    );
    let week = 0;
    while (dates.length < total) {
      for (const wd of weekdays) {
        const d = new Date(
          Date.UTC(
            weekStart.getUTCFullYear(),
            weekStart.getUTCMonth(),
            weekStart.getUTCDate() + week * 7 + wd,
          ),
        );
        if (d >= startDate) {
          const key = d.toISOString().slice(0, 10);
          if (skipDates?.has(key)) continue; // 假期跳过，自动顺延
          dates.push(d);
          if (dates.length >= total) break;
        }
      }
      week++;
      if (week > 520) break; // 兜底：避免死循环（约 10 年）
    }
    return dates;
  }

  /**
   * 顺延日期：从参考日期之后，找下一个落在 course.weekdays 的日期。
   * 若课程没有固定 weekday（私教等），默认往后顺延 7 天。
   * skipDates 中的日期（假期）会自动跳过。
   */
  private nextWeekdayDate(
    fromDate: Date,
    weekdays: number[] | undefined,
    fallbackWeekday: number,
    skipDates?: Set<string>,
  ): Date {
    const base = new Date(
      Date.UTC(
        fromDate.getUTCFullYear(),
        fromDate.getUTCMonth(),
        fromDate.getUTCDate(),
      ),
    );
    const wds = weekdays?.length ? [...weekdays].sort((a, b) => a - b) : [fallbackWeekday];
    for (let i = 1; i <= 60; i++) {
      const d = new Date(base);
      d.setUTCDate(base.getUTCDate() + i);
      if (!wds.includes(d.getUTCDay())) continue;
      if (skipDates?.has(d.toISOString().slice(0, 10))) continue;
      return d;
    }
    // 兜底：+7 天
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + 7);
    return d;
  }

  // ---------------------------------------------------------------- 课次查询

  /** 某班级的全部课次（登录用户可见） */
  async listOccurrences(courseId: string, sessionId: string) {
    const session = await this.prisma.classSession.findUnique({
      where: { id: sessionId },
      include: {
        course: { select: { id: true, title: true } },
        occurrences: {
          include: {
            substituteInstructor: {
              include: { user: { select: { id: true, name: true } } },
            },
          },
          orderBy: { sessionNumber: 'asc' },
        },
      },
    });
    if (!session || session.courseId !== courseId) {
      throw new NotFoundException('班级档期不存在或不属于该课程');
    }
    return session.occurrences;
  }

  // ---------------------------------------------------------------- 取消 / 顺延

  /**
   * 取消并顺延（§6.1）：原场次 → CANCELLED；postpone=true 时在该班最后一节
   * 之后按 weekdays 规则生成新场次（sessionNumber=当前最大+1，时间取
   * Course.timeRange），原场次 postponedToOccurrenceId 指向新场次，
   * Course.endDate 延后。两种操作都发 EXTRA_LESSON_UPDATE 通知
   *（sourceType=SESSION_OCCURRENCE）给该班已报名学员的家长和任课教师。
   */
  async cancelAndPostpone(
    occurrenceId: string,
    dto: CancelOccurrenceDto & { postpone?: boolean },
  ) {
    const occurrence = await this.prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        classSession: {
          include: {
            course: true,
            instructor: { include: { user: true } },
          },
        },
      },
    });
    if (!occurrence) throw new NotFoundException(`课次不存在：${occurrenceId}`);
    if (occurrence.status === 'CANCELLED' || occurrence.status === 'POSTPONED') {
      throw new ConflictException('该课次已取消，无法重复操作');
    }

    const { classSession } = occurrence;
    const course = classSession.course;
    const skipDates = await this.holidayDateSet();

    const result = await this.prisma.$transaction(async (tx) => {
      type NewOcc = {
        id: string;
        sessionNumber: number;
        date: Date;
        status: OccurrenceStatus;
      };
      let newOccurrence: NewOcc | null = null;
      const updateData: {
        status: OccurrenceStatus;
        cancelReason: string;
        postponedToOccurrenceId?: string;
      } = { status: 'CANCELLED', cancelReason: dto.cancel_reason };

      if (dto.postpone) {
        // 取该班最后一节课的日期（排除已取消/已顺延的异常场次，仍按最大日期）
        const last = await tx.sessionOccurrence.findFirst({
          where: { classSessionId: classSession.id },
          orderBy: { date: 'desc' },
        });
        const maxNumber =
          (await tx.sessionOccurrence.aggregate({
            where: { classSessionId: classSession.id },
            _max: { sessionNumber: true },
          }))._max.sessionNumber ?? 0;

        // 手动指定延期日期优先；否则自动顺延到下一个同星期日
        let newDate: Date;
        if (dto.postpone_date) {
          newDate = new Date(dto.postpone_date);
          if (Number.isNaN(newDate.getTime())) {
            throw new BadRequestException(
              `延期日期格式非法：${dto.postpone_date}`,
            );
          }
        } else {
          newDate = this.nextWeekdayDate(
            last ? new Date(last.date) : new Date(occurrence.date),
            course.weekdays,
            new Date(occurrence.date).getUTCDay(),
            skipDates,
          );
        }
        const created = await tx.sessionOccurrence.create({
          data: {
            classSessionId: classSession.id,
            sessionNumber: maxNumber + 1,
            date: newDate,
            status: 'SCHEDULED',
            timeRange: course.timeRange ?? null,
          },
        });
        newOccurrence = {
          id: created.id,
          sessionNumber: created.sessionNumber,
          date: newDate,
          status: created.status,
        };
        updateData.postponedToOccurrenceId = newOccurrence.id;

        // Course.endDate 随之延后（取更晚者）
        const currentEnd = course.endDate ? new Date(course.endDate) : null;
        if (!currentEnd || newDate > currentEnd) {
          await tx.course.update({
            where: { id: course.id },
            data: { endDate: newDate },
          });
        }
      }

      const cancelled = await tx.sessionOccurrence.update({
        where: { id: occurrenceId },
        data: updateData,
      });
      return { cancelled, newOccurrence };
    });

    await this.notifyOccurrenceChange(
      classSession.id,
      classSession.course.title,
      occurrence.sessionNumber,
      occurrence.date,
      dto.cancel_reason,
      dto.postpone === true,
      occurrenceId,
    );
    return result;
  }

  /** 直接取消不顺延（§6.1），同样发送通知 */
  async cancel(occurrenceId: string, dto: CancelOccurrenceDto) {
    return this.cancelAndPostpone(occurrenceId, { ...dto, postpone: false });
  }

  // ---------------------------------------------------------------- 假期日历

  /** 假期日期集合（YYYY-MM-DD），供排课/顺延跳过 */
  async holidayDateSet(): Promise<Set<string>> {
    const holidays = await this.prisma.holiday.findMany({ select: { date: true } });
    return new Set(
      holidays.map((h) => new Date(h.date).toISOString().slice(0, 10)),
    );
  }

  /** 假期列表（管理端） */
  async listHolidays() {
    return this.prisma.holiday.findMany({
      orderBy: { date: 'asc' },
      include: { createdBy: { select: { name: true } } },
    });
  }

  /** 新增假期（管理端） */
  async createHoliday(
    dto: { name: string; date: string; note?: string },
    userId: string,
  ) {
    const date = new Date(dto.date);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`日期格式非法：${dto.date}`);
    }
    // 同一天不重复
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const exists = await this.prisma.holiday.findFirst({
      where: { date: dayStart },
    });
    if (exists) throw new ConflictException(`该日期已有假期：${exists.name}`);
    return this.prisma.holiday.create({
      data: {
        name: dto.name,
        date: dayStart,
        note: dto.note,
        createdById: userId,
      },
    });
  }

  /** 删除假期（管理端） */
  async deleteHoliday(id: string) {
    return this.prisma.holiday.delete({ where: { id } });
  }

  /**
   * 检查撞假期：已排的 SCHEDULED 课次落在假期日期上。
   * 返回课次 + 假期名，供管理端一键顺延。
   */
  async checkHolidayConflicts() {
    const holidays = await this.prisma.holiday.findMany({
      orderBy: { date: 'asc' },
    });
    if (holidays.length === 0) return [];
    const dates = holidays.map(
      (h) =>
        new Date(
          Date.UTC(
            new Date(h.date).getUTCFullYear(),
            new Date(h.date).getUTCMonth(),
            new Date(h.date).getUTCDate(),
          ),
        ),
    );
    const occurrences = await this.prisma.sessionOccurrence.findMany({
      where: { date: { in: dates }, status: 'SCHEDULED' },
      include: {
        classSession: {
          include: {
            course: { select: { title: true } },
            campus: { select: { name: true } },
          },
        },
      },
      orderBy: { date: 'asc' },
    });
    const nameByDate = new Map(
      holidays.map((h) => [new Date(h.date).toISOString().slice(0, 10), h.name]),
    );
    return occurrences.map((o) => ({
      id: o.id,
      sessionNumber: o.sessionNumber,
      date: o.date,
      timeRange: o.timeRange,
      courseTitle: o.classSession.course.title,
      campusName: o.classSession.campus.name,
      holidayName: nameByDate.get(new Date(o.date).toISOString().slice(0, 10)),
    }));
  }

  // ---------------------------------------------------------------- 停课申请（教师发起、管理端审批）

  /** 教师申请停课：只能申请自己任教班级的未来课次 */
  async requestCancel(
    occurrenceId: string,
    userId: string,
    dto: { reason: string; postpone?: boolean },
  ) {
    const instructor = await this.prisma.instructor.findUnique({
      where: { userId },
    });
    if (!instructor) throw new ForbiddenException('未找到教师档案');
    const occurrence = await this.prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { classSession: { include: { course: { select: { title: true } } } } },
    });
    if (!occurrence) throw new NotFoundException('课次不存在');
    if (occurrence.classSession.instructorId !== instructor.id) {
      throw new ForbiddenException('只能申请自己任教班级的课次');
    }
    if (occurrence.status === 'CANCELLED' || occurrence.status === 'POSTPONED') {
      throw new ConflictException('该课次已取消，无需申请');
    }
    if (new Date(occurrence.date) < new Date(new Date().toISOString().slice(0, 10))) {
      throw new BadRequestException('只能申请未来课次的停课');
    }
    const pending = await this.prisma.occurrenceCancelRequest.findFirst({
      where: { occurrenceId, status: 'PENDING' },
    });
    if (pending) throw new ConflictException('该课次已有待审批的停课申请');
    if (!dto.reason?.trim()) throw new BadRequestException('请填写停课原因');
    return this.prisma.occurrenceCancelRequest.create({
      data: {
        occurrenceId,
        instructorId: instructor.id,
        reason: dto.reason.trim(),
        postpone: dto.postpone !== false,
      },
      include: {
        occurrence: { select: { sessionNumber: true, date: true } },
      },
    });
  }

  /** 教师查看自己的停课申请 */
  async myCancelRequests(userId: string) {
    const instructor = await this.prisma.instructor.findUnique({
      where: { userId },
    });
    if (!instructor) throw new ForbiddenException('未找到教师档案');
    return this.prisma.occurrenceCancelRequest.findMany({
      where: { instructorId: instructor.id },
      include: {
        occurrence: {
          select: {
            sessionNumber: true,
            date: true,
            timeRange: true,
            classSession: {
              select: { course: { select: { title: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 停课申请列表（管理端） */
  async listCancelRequests(status?: string) {
    const where =
      status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)
        ? { status: status as CancelRequestStatus }
        : {};
    return this.prisma.occurrenceCancelRequest.findMany({
      where,
      include: {
        occurrence: {
          select: {
            sessionNumber: true,
            date: true,
            timeRange: true,
            status: true,
            classSession: {
              select: {
                course: { select: { title: true } },
                campus: { select: { name: true } },
              },
            },
          },
        },
        instructor: { include: { user: { select: { name: true } } } },
        reviewedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 审批通过：执行取消+顺延（复用 cancelAndPostpone，自动通知家长/老师） */
  async approveCancelRequest(
    id: string,
    reviewerId: string,
    dto: { postpone?: boolean; postpone_date?: string; review_note?: string },
  ) {
    const req = await this.prisma.occurrenceCancelRequest.findUnique({
      where: { id },
    });
    if (!req) throw new NotFoundException('申请不存在');
    if (req.status !== 'PENDING') throw new ConflictException('该申请已处理');
    const result = await this.cancelAndPostpone(req.occurrenceId, {
      cancel_reason: req.reason,
      postpone: dto.postpone !== false,
      postpone_date: dto.postpone_date,
    });
    await this.prisma.occurrenceCancelRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNote: dto.review_note,
      },
    });
    return result;
  }

  /** 驳回停课申请（管理端） */
  async rejectCancelRequest(id: string, reviewerId: string, reviewNote?: string) {
    const req = await this.prisma.occurrenceCancelRequest.findUnique({
      where: { id },
    });
    if (!req) throw new NotFoundException('申请不存在');
    if (req.status !== 'PENDING') throw new ConflictException('该申请已处理');
    return this.prisma.occurrenceCancelRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNote,
      },
    });
  }

  /**
   * 课次取消/顺延通知：发给该班已报名学员（CONFIRMED/PENDING_PAYMENT）的
   * 家长（优先主要联系人，无主要联系人则发给全部监护人）与任课教师。
   */
  private async notifyOccurrenceChange(
    classSessionId: string,
    courseTitle: string,
    sessionNumber: number,
    date: Date,
    reason: string,
    postponed: boolean,
    occurrenceId: string,
  ) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        classSessionId,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
      },
      include: {
        student: { include: { parentLinks: true } },
      },
    });
    const session = await this.prisma.classSession.findUnique({
      where: { id: classSessionId },
      include: { instructor: true },
    });

    const userIds = new Set<string>();
    for (const e of enrollments) {
      const links = e.student.parentLinks;
      const primary = links.filter((l) => l.isPrimaryContact);
      const targets = primary.length > 0 ? primary : links;
      for (const l of targets) userIds.add(l.parentId);
    }
    if (session?.instructor) userIds.add(session.instructor.userId);

    const dateStr = new Date(date).toISOString().slice(0, 10);
    const title = postponed ? '课程顺延通知' : '课程取消通知';
    const body = postponed
      ? `《${courseTitle}》第 ${sessionNumber} 节（${dateStr}）因故取消：${reason}。已按排课规则顺延补课，具体时间请查看课表。`
      : `《${courseTitle}》第 ${sessionNumber} 节（${dateStr}）因故取消：${reason}。给您带来不便，敬请谅解。`;

    for (const userId of userIds) {
      await this.notifications.notify({
        userId,
        type: NotificationType.EXTRA_LESSON_UPDATE,
        title,
        body,
        sourceType: NotificationSourceType.SESSION_OCCURRENCE,
        sourceId: occurrenceId,
      });
    }
  }

  // ---------------------------------------------------------------- 打卡

  /**
   * 学员自助打卡（§6.2）：校验 enrollment 属于当前用户或其孩子
   *（ParentStudentLink）。SELF → PENDING_CONFIRMATION。
   * @@unique([sessionOccurrenceId, enrollmentId]) 防重：命中直接返回已有记录。
   */
  async selfCheckIn(
    user: RequestUser,
    occurrenceId: string,
    dto: CheckInDto,
  ) {
    const { occurrence, enrollment } = await this.loadCheckInTargets(
      occurrenceId,
      dto.enrollment_id,
    );
    return this.doSelfCheckIn(
      user,
      occurrence,
      enrollment,
      dto.signature,
      dto.status,
    );
  }

  /**
   * 自助打卡核心（SELF → PENDING_CONFIRMATION，幂等，附带补课抵扣）。
   * 供 selfCheckIn / selfCheckInByCode 共用。
   */
  private async doSelfCheckIn(
    user: RequestUser,
    occurrence: { id: string },
    enrollment: { id: string; studentId: string },
    signature?: string,
    status?: 'PRESENT' | 'ABSENT',
  ) {
    await this.assertEnrollmentBelongsToUser(user, enrollment.studentId);

    const existing = await this.prisma.attendanceRecord.findUnique({
      where: {
        sessionOccurrenceId_enrollmentId: {
          sessionOccurrenceId: occurrence.id,
          enrollmentId: enrollment.id,
        },
      },
    });
    if (existing) return existing; // 幂等：直接返回已有记录

    const isAbsent = status === 'ABSENT';
    const record = await this.prisma.attendanceRecord.create({
      data: {
        sessionOccurrenceId: occurrence.id,
        enrollmentId: enrollment.id,
        checkInMethod: 'SELF',
        status: isAbsent ? 'ABSENT' : 'PENDING_CONFIRMATION',
        signatureUrl: signature ?? null,
      },
    });
    // 缺席不触发补课抵扣逻辑
    if (!isAbsent) {
      await this.applyMakeupOnCheckIn(enrollment.id, occurrence.id, record.id);
    }
    return record;
  }

  /**
   * 生成签到二维码码值（POST /admin/occurrences/:id/checkin-code）：
   * HMAC-SHA256 签名，15 分钟有效，不存 DB。
   */
  async createCheckInCode(occurrenceId: string) {
    const occurrence = await this.prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      select: { id: true },
    });
    if (!occurrence) throw new NotFoundException(`课次不存在：${occurrenceId}`);
    return { code: signCheckInCode(occurrence.id) };
  }

  /**
   * 扫码打卡（POST /check-in/by-code，家长 / 成人学员）：
   * 验签（格式、签名、过期）→ 取出 occurrenceId → 兼容解析 enrollment
   * （enrollment_id 可能是报名 id，也可能是学员 id）→ 复用自助打卡核心。
   */
  async selfCheckInByCode(user: RequestUser, dto: CheckInByCodeDto) {
    let occurrenceId: string;
    try {
      occurrenceId = verifyCheckInCode(dto.code);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const occurrence = await this.prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
    });
    if (!occurrence) throw new NotFoundException(`课次不存在：${occurrenceId}`);
    if (
      occurrence.status === 'CANCELLED' ||
      occurrence.status === 'POSTPONED'
    ) {
      throw new ConflictException('该课次已取消，无法打卡');
    }
    const enrollment = await this.resolveCheckInEnrollment(
      occurrence.classSessionId,
      dto.enrollment_id,
    );
    if (enrollment.status !== 'CONFIRMED') {
      throw new ConflictException('只有已确认的报名才能打卡');
    }
    return this.doSelfCheckIn(user, occurrence, enrollment, dto.signature);
  }

  /**
   * 打卡报名兼容解析：
   * 1) 先按 enrollment id 查（且必须属于该课次所在班级）；
   * 2) 查不到再按 student id 查该学员在本班最新一条未取消的报名；
   * 3) 都查不到 → NotFoundException("找不到该学员的有效报名")。
   */
  private async resolveCheckInEnrollment(
    classSessionId: string,
    idOrStudentId: string,
  ) {
    const byEnrollment = await this.prisma.enrollment.findUnique({
      where: { id: idOrStudentId },
    });
    if (byEnrollment && byEnrollment.classSessionId === classSessionId) {
      return byEnrollment;
    }
    const byStudent = await this.prisma.enrollment.findFirst({
      where: {
        studentId: idOrStudentId,
        classSessionId,
        status: { not: 'CANCELLED' },
      },
      orderBy: { enrolledAt: 'desc' },
    });
    if (byStudent) return byStudent;
    throw new NotFoundException('找不到该学员的有效报名');
  }

  /**
   * 管理员代打卡（§6.2）：→ CONFIRMED，confirmedBy=当前用户。
   * 若已存在 PENDING_CONFIRMATION 记录则更新为 CONFIRMED，不新增。
   */
  async adminCheckIn(
    admin: RequestUser,
    occurrenceId: string,
    dto: CheckInDto,
  ) {
    const { occurrence, enrollment } = await this.loadCheckInTargets(
      occurrenceId,
      dto.enrollment_id,
    );

    const existing = await this.prisma.attendanceRecord.findUnique({
      where: {
        sessionOccurrenceId_enrollmentId: {
          sessionOccurrenceId: occurrence.id,
          enrollmentId: enrollment.id,
        },
      },
    });

    const targetStatus = dto.status === 'ABSENT' ? 'ABSENT' : 'CONFIRMED';
    let record;
    if (existing) {
      // 已有记录 → 更新状态，不新增
      record = await this.prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          status: targetStatus,
          checkInMethod: 'ADMIN',
          confirmedById: admin.id,
          confirmedAt: new Date(),
        },
      });
    } else {
      record = await this.prisma.attendanceRecord.create({
        data: {
          sessionOccurrenceId: occurrence.id,
          enrollmentId: enrollment.id,
          checkInMethod: 'ADMIN',
          status: targetStatus,
          confirmedById: admin.id,
          confirmedAt: new Date(),
        },
      });
    }
    if (targetStatus === 'CONFIRMED') {
      await this.applyMakeupOnCheckIn(enrollment.id, occurrence.id, record.id);
    }
    return record;
  }

  /** 管理员确认待确认打卡（§6.2） */
  async confirmAttendance(adminId: string, recordId: string) {
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { id: recordId },
    });
    if (!record) throw new NotFoundException(`打卡记录不存在：${recordId}`);
    if (record.status === 'CONFIRMED') return record;
    const confirmed = await this.prisma.attendanceRecord.update({
      where: { id: recordId },
      data: {
        status: 'CONFIRMED',
        confirmedById: adminId,
        confirmedAt: new Date(),
      },
    });
    // 确认后若为补课打卡，对应补课预约 → ATTENDED（§6.4）
    await this.prisma.$transaction(async (tx) => {
      await this.markMakeupAttended(tx, confirmed.id);
    });
    return confirmed;
  }

  /**
   * 管理员替老师打卡：直接创建 InstructorCheckin 记录。
   */
  async adminInstructorCheckIn(dto: {
    instructor_id: string;
    class_session_id?: string;
    session_occurrence_id?: string;
    date: string;
    time: string;
    campus: string;
  }) {
    const instructor = await this.prisma.instructor.findUnique({
      where: { id: dto.instructor_id },
    });
    if (!instructor) throw new NotFoundException(`教师不存在：${dto.instructor_id}`);
    const date = new Date(dto.date);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`日期格式非法：${dto.date}`);
    }
    return this.prisma.instructorCheckin.create({
      data: {
        instructorId: instructor.id,
        classSessionId: dto.class_session_id ?? null,
        sessionOccurrenceId: dto.session_occurrence_id ?? null,
        campus: dto.campus,
        date,
        time: dto.time,
      },
      include: { instructor: { include: { user: { select: { name: true } } } } },
    });
  }

  /** 安排代课：POST /admin/occurrences/:id/substitute */
  async assignSubstitute(
    occurrenceId: string,
    dto: { instructor_id: string; reason?: string },
    adminId: string,
  ) {
    const occurrence = await this.prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        classSession: {
          include: {
            course: { select: { title: true } },
            instructor: { include: { user: { select: { name: true } } } },
          },
        },
      },
    });
    if (!occurrence) throw new NotFoundException('课次不存在');
    const substitute = await this.prisma.instructor.findUnique({
      where: { id: dto.instructor_id },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!substitute) throw new NotFoundException('代课老师不存在');
    // 不能给自己代自己的课
    if (occurrence.classSession.instructorId === dto.instructor_id) {
      throw new BadRequestException('代课老师不能是原任课老师');
    }
    const updated = await this.prisma.sessionOccurrence.update({
      where: { id: occurrenceId },
      data: {
        substituteInstructorId: dto.instructor_id,
        substituteReason: dto.reason || null,
        substituteAssignedAt: new Date(),
        substituteAssignedById: adminId,
      },
      include: {
        substituteInstructor: { include: { user: { select: { name: true } } } },
      },
    });
    // 通知代课老师
    try {
      const dateStr = new Date(occurrence.date).toISOString().slice(0, 10);
      await this.prisma.notification.create({
        data: {
          userId: substitute.user.id,
          type: 'CLASS_REMINDER',
          title: '代课安排通知',
          body: `${occurrence.classSession.course.title} ${dateStr}（第${occurrence.sessionNumber}节）安排您代课${dto.reason ? `，原因：${dto.reason}` : ''}`,
          sourceType: 'COURSE',
          sourceId: occurrence.classSession.courseId,
          channels: ['IN_APP'],
        },
      });
    } catch {
      /* 通知失败不影响代课安排 */
    }
    return updated;
  }

  /** 取消代课：DELETE /admin/occurrences/:id/substitute */
  async removeSubstitute(occurrenceId: string) {
    const occurrence = await this.prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
    });
    if (!occurrence) throw new NotFoundException('课次不存在');
    return this.prisma.sessionOccurrence.update({
      where: { id: occurrenceId },
      data: {
        substituteInstructorId: null,
        substituteReason: null,
        substituteAssignedAt: null,
        substituteAssignedById: null,
      },
    });
  }

  /**
   * 管理员查看某课次出勤名单（分组：已确认/待确认/缺席/补课）。
   * GET /admin/occurrences/:id/attendance
   */
  async adminOccurrenceAttendance(occurrenceId: string) {
    const occurrence = await this.prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
    });
    if (!occurrence) throw new NotFoundException(`课次不存在：${occurrenceId}`);
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        classSessionId: occurrence.classSessionId,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
      },
      include: {
        student: { select: { id: true, name: true } },
      },
      orderBy: { enrolledAt: 'asc' },
    });
    const records = await this.prisma.attendanceRecord.findMany({
      where: { sessionOccurrenceId: occurrenceId },
    });
    const recordByEnrollment = new Map(records.map((r) => [r.enrollmentId, r]));
    const confirmed: unknown[] = [];
    const pending: unknown[] = [];
    const absent: unknown[] = [];
    for (const enrollment of enrollments) {
      const record = recordByEnrollment.get(enrollment.id) ?? null;
      const entry = { enrollment, record };
      if (record?.status === AttendanceStatus.CONFIRMED) confirmed.push(entry);
      else if (record?.status === AttendanceStatus.PENDING_CONFIRMATION)
        pending.push(entry);
      else absent.push(entry);
    }
    return {
      occurrence: {
        id: occurrence.id,
        session_number: occurrence.sessionNumber,
        date: occurrence.date,
        status: occurrence.status,
      },
      confirmed,
      pending,
      absent,
    };
  }

  // ---------------------------------------------------------------- 教师打卡（§6.18）

  /**
   * 教师上课打卡：class_session_id 与 extra_lesson_slot_id 二选一。
   * 常规班级打卡时若能按日期匹配到当节 SessionOccurrence，一并写入
   * sessionOccurrenceId，便于与学员打卡交叉核对。
   */
  async instructorCheckIn(
    user: RequestUser,
    dto: {
      class_session_id?: string;
      extra_lesson_slot_id?: string;
      date: string;
      time: string;
      campus: string;
    },
  ) {
    const instructor = await this.prisma.instructor.findUnique({
      where: { userId: user.id },
    });
    if (!instructor) throw new ForbiddenException('当前用户没有教师档案');

    const hasClass = !!dto.class_session_id;
    const hasSlot = !!dto.extra_lesson_slot_id;
    if (hasClass === hasSlot) {
      throw new BadRequestException(
        'class_session_id 与 extra_lesson_slot_id 必须且只能填写其中一个',
      );
    }
    const date = new Date(dto.date);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`日期格式非法：${dto.date}`);
    }

    let sessionOccurrenceId: string | null = null;
    if (dto.class_session_id) {
      const session = await this.prisma.classSession.findUnique({
        where: { id: dto.class_session_id },
      });
      if (!session) throw new NotFoundException('班级档期不存在');
      if (session.instructorId !== instructor.id) {
        throw new ForbiddenException('只能为自己任教的班级打卡');
      }
      const occurrence = await this.prisma.sessionOccurrence.findFirst({
        where: { classSessionId: session.id, date },
      });
      sessionOccurrenceId = occurrence?.id ?? null;
    } else {
      const slot = await this.prisma.extraLessonSlot.findUnique({
        where: { id: dto.extra_lesson_slot_id },
        include: { request: true },
      });
      if (!slot) throw new NotFoundException('加课时段不存在');
      if (slot.request.instructorId && slot.request.instructorId !== instructor.id) {
        throw new ForbiddenException('只能为自己任教的加课打卡');
      }
      if (!slot.request.instructorId) {
        throw new ForbiddenException('该加课尚未指定任教教师，无法打卡');
      }
    }

    const checkin = await this.prisma.instructorCheckin.create({
      data: {
        instructorId: instructor.id,
        classSessionId: dto.class_session_id ?? null,
        sessionOccurrenceId,
        extraLessonSlotId: dto.extra_lesson_slot_id ?? null,
        campus: dto.campus,
        date,
        time: dto.time,
      },
    });

    // 私教课：授课教师打卡后，若该课程所有班次均已打卡，自动归档
    if (dto.class_session_id) {
      await this.autoArchivePrivateCourse(dto.class_session_id);
    }
    return checkin;
  }

  /**
   * 私教课自动归档：教师为某班次打卡后，若该私教课程（PUBLISHED）
   * 的所有未取消班次都已有教师打卡记录，则自动置为 ARCHIVED（课已上完）。
   * 大课/大师课不受影响。
   */
  private async autoArchivePrivateCourse(
    classSessionId: string,
  ): Promise<void> {
    const session = await this.prisma.classSession.findUnique({
      where: { id: classSessionId },
      select: {
        course: { select: { id: true, format: true, status: true } },
      },
    });
    const course = session?.course;
    if (!course || course.format !== 'PRIVATE' || course.status !== 'PUBLISHED') {
      return;
    }
    const sessions = await this.prisma.classSession.findMany({
      where: { courseId: course.id, status: { not: 'CANCELLED' } },
      select: { id: true },
    });
    if (sessions.length === 0) return;
    const checked = await this.prisma.instructorCheckin.groupBy({
      by: ['classSessionId'],
      where: { classSessionId: { in: sessions.map((s) => s.id) } },
    });
    const checkedIds = new Set(
      checked.map((c) => c.classSessionId).filter((x): x is string => !!x),
    );
    if (sessions.every((s) => checkedIds.has(s.id))) {
      await this.prisma.course.update({
        where: { id: course.id },
        data: { status: 'ARCHIVED' },
      });
    }
  }

  /** 我的教师打卡记录 */
  async myInstructorCheckins(userId: string) {
    const instructor = await this.prisma.instructor.findUnique({
      where: { userId },
    });
    if (!instructor) throw new ForbiddenException('当前用户没有教师档案');
    return this.prisma.instructorCheckin.findMany({
      where: { instructorId: instructor.id },
      include: {
        classSession: {
          include: { course: { select: { id: true, title: true } } },
        },
        sessionOccurrence: true,
        extraLessonSlot: { include: { request: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  // ---------------------------------------------------------------- 内部工具

  /** 打卡前置：课次存在、报名存在且属于该班 */
  private async loadCheckInTargets(occurrenceId: string, enrollmentId: string) {
    const occurrence = await this.prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
    });
    if (!occurrence) throw new NotFoundException(`课次不存在：${occurrenceId}`);
    if (
      occurrence.status === 'CANCELLED' ||
      occurrence.status === 'POSTPONED'
    ) {
      throw new ConflictException('该课次已取消，无法打卡');
    }
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment) throw new NotFoundException(`报名不存在：${enrollmentId}`);
    if (enrollment.classSessionId !== occurrence.classSessionId) {
      throw new BadRequestException('该报名不属于本节课所在班级');
    }
    if (enrollment.status !== 'CONFIRMED') {
      throw new ConflictException('只有已确认的报名才能打卡');
    }
    return { occurrence, enrollment };
  }

  /** 校验报名学员属于当前用户或其孩子（经 ParentStudentLink） */
  private async assertEnrollmentBelongsToUser(
    user: RequestUser,
    studentId: string,
  ) {
    if (user.role === 'ADMIN') return;
    const link = await this.prisma.parentStudentLink.findUnique({
      where: { parentId_studentId: { parentId: user.id, studentId } },
    });
    if (!link) {
      throw new ForbiddenException('只能为自己或自己绑定的孩子打卡');
    }
  }

  /**
   * 补课联动（§6.4）：若该报名在该场次有一条 BOOKED 的补课预约，
   * 则打卡记录置 isMakeup=true；打卡已确认时预约 → ATTENDED。
   */
  private async applyMakeupOnCheckIn(
    enrollmentId: string,
    occurrenceId: string,
    recordId: string,
  ) {
    const booking = await this.prisma.makeupBooking.findFirst({
      where: {
        enrollmentId,
        makeupOccurrenceId: occurrenceId,
        status: 'BOOKED',
      },
    });
    if (!booking) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceRecord.update({
        where: { id: recordId },
        data: { isMakeup: true },
      });
      const record = await tx.attendanceRecord.findUnique({
        where: { id: recordId },
      });
      if (record?.status === 'CONFIRMED') {
        await tx.makeupBooking.update({
          where: { id: booking.id },
          data: { status: 'ATTENDED' },
        });
      }
    });
  }

  /** attendance 模块内部导出：供 confirmAttendance 确认后补联动的场景复用 */
  async markMakeupAttended(tx: TxClient, recordId: string) {
    const record = await tx.attendanceRecord.findUnique({
      where: { id: recordId },
    });
    if (!record || record.status !== 'CONFIRMED' || !record.isMakeup) return;
    const booking = await tx.makeupBooking.findFirst({
      where: {
        enrollmentId: record.enrollmentId,
        makeupOccurrenceId: record.sessionOccurrenceId,
        status: 'BOOKED',
      },
    });
    if (booking) {
      await tx.makeupBooking.update({
        where: { id: booking.id },
        data: { status: 'ATTENDED' },
      });
    }
  }
}
