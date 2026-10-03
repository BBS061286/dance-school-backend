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
} from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateEventDto,
  CreateNoticeDto,
  IssueFeeDto,
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
    if (dto.requires_ticket && (dto.ticket_price_cents ?? 0) <= 0) {
      throw new BadRequestException('需要购票的活动必须设置票单价');
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
      },
    });
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
      ticketQuantity = qty;
      ticketTotalCents = (event.ticketPriceCents ?? 0) * qty;
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
      await this.createTicketOrder(user.id, registration.id, ticketTotalCents!);
    }
    return registration;
  }

  /** 取消活动报名（学员端归属 / ADMIN） */
  async cancelRegistration(user: RequestUser, registrationId: string) {
    const reg = await this.assertRegistrationAccessible(user, registrationId);
    if (reg.status === 'CANCELLED') return reg;
    return this.prisma.eventRegistration.update({
      where: { id: registrationId },
      data: { status: 'CANCELLED' },
    });
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
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          parentId,
          amountCents: ticketTotalCents,
          paymentMethod: 'STRIPE',
          items: {
            create: [
              {
                eventRegistrationId: registrationId,
                description: '活动门票款',
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
