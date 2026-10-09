import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseFormat,
  OrderPaymentMethod,
  OrderStatus,
  Payment,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import {
  PaymentsProvider,
  StubPaymentsProvider,
} from '../integrations/payments.provider';
import { PrismaService } from '../prisma/prisma.service';
import { RequestUser, TxClient } from '../common/types';
import { AdminOrdersQuery, SetDiscountDto } from './dto/order.dto';
import { RecordPaymentDto, RefundDto } from './dto/payment.dto';

/** 学员自助提交允许的付款方式（线上 Stripe 必须走 Checkout） */
const SELF_PAYMENT_METHODS: PaymentMethod[] = [
  'ZELLE',
  'PAYPAL',
  'CASH',
  'CHECK',
  'OTHER',
];

/** 管理员线下代收允许的付款方式（核实即到账，跳过 PENDING_CONFIRM） */
const ADMIN_PAYMENT_METHODS: PaymentMethod[] = [
  'CASH',
  'CHECK',
  'ZELLE',
  'PAYPAL',
];

/** 可下单的报名状态 */
const ORDERABLE_ENROLLMENT_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED'];

/** 不允许再新增付款 / 发起支付的订单状态 */
const CLOSED_ORDER_STATUSES = ['FAILED', 'CANCELLED'];

/**
 * 账单服务：订单 / 付款 / 退款。
 * 核心约定（v2 R4/R5）：除 FAILED / CANCELLED 显式终态外，Order.status 只能由
 * deriveOrder 根据 Payment 与 RefundRecord 流水派生，禁止任何地方直接修改。
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsProvider: PaymentsProvider,
    private readonly enrollmentsService: EnrollmentsService,
  ) {}

  // ---------------------------------------------------------------- 核心派生

  /**
   * 根据流水派生订单状态并写回。
   * 规则：refunded > 0 → refunded >= paid ? REFUNDED : PARTIALLY_REFUNDED；
   *       否则 paid === 0 → PENDING；paid < amountCents → PARTIALLY_PAID；否则 PAID。
   * 首次进入 PAID 时（paidAt 为空则打时间戳）触发报名确认。
   * FAILED / CANCELLED 为显式终态，直接返回不参与派生。
   */
  async deriveOrder(
    tx: TxClient,
    orderId: string,
  ): Promise<{ status: OrderStatus }> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { payments: true, refunds: true },
    });
    if (!order) throw new NotFoundException(`订单不存在：${orderId}`);

    if (order.status === 'FAILED' || order.status === 'CANCELLED') {
      return { status: order.status };
    }

    const paid = order.payments
      .filter((p) => p.status === 'SUCCEEDED')
      .reduce((sum, p) => sum + p.amountCents, 0);
    const refunded = order.refunds.reduce((sum, r) => sum + r.amountCents, 0);

    let next: OrderStatus;
    if (refunded > 0) {
      next = refunded >= paid ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    } else if (paid === 0) {
      next = 'PENDING';
    } else if (paid < order.amountCents) {
      next = 'PARTIALLY_PAID';
    } else {
      next = 'PAID';
    }

    const wasPaid = order.status === 'PAID';
    const data: { status: OrderStatus; paidAt?: Date } = { status: next };
    if (next === 'PAID' && !order.paidAt) data.paidAt = new Date();
    await tx.order.update({ where: { id: orderId }, data });

    if (next === 'PAID' && !wasPaid) {
      await this.enrollmentsService.confirmEnrollmentsForPaidOrder(tx, orderId);
      // D4（§6.8 私教课产品联动）：订单含 format=PRIVATE 的 Course 的报名时，
      // 自动创建 ExtraLessonRequest（initiatedBy=COURSE_PURCHASE，
      // sourceCourseId/sourceEnrollmentId 回填，type 按课程 capacity 是否为 1
      // 判定 ONE_ON_ONE / TEMP_GROUP）。内联 prisma 调用，不 import
      // extra-lessons 模块以避免循环依赖；已存在时幂等跳过。
      await this.createExtraLessonRequestsForPrivateCourses(tx, orderId);
    }
    return { status: next };
  }

  /**
   * 私教课产品购买联动（§6.8）：订单变 PAID 时，为其中 format=PRIVATE
   * 课程的每个报名自动生成一条待选时段的 ExtraLessonRequest。
   * 内联实现，不依赖 extra-lessons 模块（避免循环依赖）。
   */
  private async createExtraLessonRequestsForPrivateCourses(
    tx: TxClient,
    orderId: string,
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            enrollment: {
              include: {
                classSession: { include: { course: true } },
              },
            },
          },
        },
      },
    });
    if (!order) return;

    for (const item of order.items) {
      const enrollment = item.enrollment;
      const course = enrollment?.classSession?.course;
      if (!enrollment || !course || course.format !== 'PRIVATE') continue;

      // 幂等：同一报名已生成过 COURSE_PURCHASE 申请则跳过
      const existing = await tx.extraLessonRequest.findFirst({
        where: {
          sourceEnrollmentId: enrollment.id,
          initiatedBy: 'COURSE_PURCHASE',
        },
      });
      if (existing) continue;

      // audience 由 student 经 SELF 关系派生（§6.8）：有 SELF 绑定 → ADULT，否则 YOUTH
      const selfLink = await tx.parentStudentLink.findFirst({
        where: { studentId: enrollment.studentId, relationship: 'SELF' },
      });

      await tx.extraLessonRequest.create({
        data: {
          type: course.capacity === 1 ? 'ONE_ON_ONE' : 'TEMP_GROUP',
          studentId: enrollment.studentId,
          audience: selfLink ? 'ADULT' : 'YOUTH',
          initiatedBy: 'COURSE_PURCHASE',
          sourceCourseId: course.id,
          sourceEnrollmentId: enrollment.id,
          createdById: order.parentId,
        },
      });
    }
  }

  // ---------------------------------------------------------------- 下单

  /** 创建订单：校验报名归属/状态/防重复下单，汇总金额，写入明细行 */
  async createOrder(requester: RequestUser, dto: { enrollment_ids: string[]; event_registration_ids?: string[]; payment_method?: OrderPaymentMethod }) {
    return this.prisma.$transaction(async (tx) => {
      let amountCents = 0;
      const itemInputs: {
        enrollmentId: string;
        description: string;
        amountCents: number;
      }[] = [];

      // 逐个校验报名
      for (const enrollmentId of dto.enrollment_ids) {
        const enrollment = await tx.enrollment.findUnique({
          where: { id: enrollmentId },
          include: { classSession: { include: { course: true } } },
        });
        if (!enrollment) throw new NotFoundException(`报名不存在：${enrollmentId}`);

        // 归属校验：家长只能为自己关联的学员下单
        if (requester.role !== 'ADMIN') {
          const link = await tx.parentStudentLink.findUnique({
            where: {
              parentId_studentId: {
                parentId: requester.id,
                studentId: enrollment.studentId,
              },
            },
          });
          if (!link) throw new ForbiddenException('无权为该学员下单');
        }

        if (!ORDERABLE_ENROLLMENT_STATUSES.includes(enrollment.status)) {
          throw new ConflictException('报名状态不允许下单');
        }

        // 防重复下单：同一报名已有未关闭（非 CANCELLED / FAILED）的订单时拒绝
        const existing = await tx.orderItem.findFirst({
          where: {
            enrollmentId,
            order: { status: { notIn: ['CANCELLED', 'FAILED'] } },
          },
        });
        if (existing) throw new ConflictException('该报名已有未完成的订单');

        const priceCents = enrollment.classSession.course.priceCents;
        amountCents += priceCents;
        itemInputs.push({
          enrollmentId: enrollment.id,
          description: `报名:${enrollment.classSession.course.title}`,
          amountCents: priceCents,
        });
      }

      // 逐个校验活动报名（参赛费/参与费）
      const eventRegIds: string[] = [];
      for (const regId of dto.event_registration_ids ?? []) {
        const reg = await tx.eventRegistration.findUnique({
          where: { id: regId },
        });
        if (!reg) throw new NotFoundException(`活动报名不存在：${regId}`);
        if (reg.parentId !== requester.id && requester.role !== 'ADMIN') {
          throw new ForbiddenException('无权为该活动报名下单');
        }
        amountCents += reg.participationFeeCents ?? 0;
        eventRegIds.push(reg.id);
      }

      const order = await tx.order.create({
        data: {
          parentId: requester.id,
          amountCents,
          originalAmountCents: amountCents,
          paymentMethod: dto.payment_method ?? 'STRIPE',
          items: { create: itemInputs },
        },
        include: { items: true },
      });

      // 活动参赛费走 EventRegistrationOrder 关联表（金额已计入订单总额）
      for (const eventRegistrationId of eventRegIds) {
        await tx.eventRegistrationOrder.create({
          data: {
            eventRegistrationId,
            orderId: order.id,
            itemType: 'PARTICIPATION_FEE',
          },
        });
      }

      return order;
    });
  }

  // ---------------------------------------------------------------- Stripe Checkout

  /** 为订单创建 Stripe Checkout 会话；stripePaymentIntentId 作为幂等键写回 */
  async createCheckoutSession(requester: RequestUser, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException(`订单不存在：${orderId}`);
    if (order.parentId !== requester.id && requester.role !== 'ADMIN') {
      throw new ForbiddenException('无权访问该订单');
    }
    if (CLOSED_ORDER_STATUSES.includes(order.status)) {
      throw new ConflictException('订单已关闭，无法发起支付');
    }

    let piId = order.stripePaymentIntentId;
    if (!piId) {
      piId = `stub_pi_${order.id}`;
      await this.prisma.order.update({
        where: { id: order.id },
        data: { stripePaymentIntentId: piId },
      });
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    // 演示模式（stub）：不返回打不开的 stub-checkout.local 假链接，
    // 而是进应用内演示收银台，点"模拟支付成功"即可走完付款全流程。
    // 接入真实 Stripe 后此分支自动失效（demoCompletePayment 会拒绝）。
    if (this.paymentsProvider instanceof StubPaymentsProvider) {
      const rolePrefix =
        requester.role === 'ADULT_STUDENT' ? '/adult' : '/parent';
      return {
        url: `${frontendUrl}${rolePrefix}/demo-checkout/${order.id}`,
        demo: true,
        stripe_payment_intent_id: piId,
      };
    }
    const { url } = await this.paymentsProvider.createCheckoutSession({
      orderId: order.id,
      amountCents: order.amountCents,
      currency: order.currency,
      successUrl: `${frontendUrl}/orders/${order.id}/success`,
      cancelUrl: `${frontendUrl}/orders/${order.id}`,
    });
    return { url, demo: false, stripe_payment_intent_id: piId };
  }

  /**
   * 演示收银台：模拟支付成功（仅 stub 演示模式可用）。
   * 家长/成人学员只能操作自己的订单；管理员可操作任意订单。
   * 写入一笔 SUCCEEDED 的 STRIPE 付款后走 deriveOrder 派生：
   * 订单变 PAID → 报名自动确认 → 触发报名成功通知，与真实支付路径一致。
   */
  async demoCompletePayment(requester: RequestUser, orderId: string) {
    if (!(this.paymentsProvider instanceof StubPaymentsProvider)) {
      throw new BadRequestException('当前为真实支付模式，演示完成接口不可用');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });
    if (!order) throw new NotFoundException(`订单不存在：${orderId}`);
    if (order.parentId !== requester.id && requester.role !== 'ADMIN') {
      throw new ForbiddenException('无权访问该订单');
    }
    if (['FAILED', 'CANCELLED', 'REFUNDED', 'PAID'].includes(order.status)) {
      throw new ConflictException('订单当前状态不允许演示支付');
    }
    const paidCents = order.payments
      .filter((p) => p.status === 'SUCCEEDED')
      .reduce((sum, p) => sum + p.amountCents, 0);
    const remaining = order.amountCents - paidCents;
    if (remaining <= 0) {
      throw new ConflictException('订单已付清，无需再支付');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId,
          amountCents: remaining,
          method: 'STRIPE',
          status: 'SUCCEEDED',
          externalRef: `demo_stub_${orderId}`,
        },
      });
      await this.deriveOrder(tx, orderId);
      return tx.order.findUnique({
        where: { id: orderId },
        include: { payments: true, refunds: true },
      });
    });
  }

  // ---------------------------------------------------------------- 付款

  /** 学员自助提交付款：进入 PENDING_CONFIRM，待管理员核实 */
  async recordSelfPayment(
    requester: RequestUser,
    orderId: string,
    dto: RecordPaymentDto,
  ) {
    if (dto.method === 'STRIPE') {
      throw new BadRequestException('线上支付请走 Stripe Checkout');
    }
    if (!SELF_PAYMENT_METHODS.includes(dto.method as PaymentMethod)) {
      throw new BadRequestException(`不支持的付款方式：${dto.method}`);
    }
    const order = await this.getAccessibleOrder(requester, orderId);
    if (['FAILED', 'CANCELLED', 'REFUNDED'].includes(order.status)) {
      throw new ConflictException('订单当前状态不允许新增付款');
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId,
          amountCents: dto.amount_cents,
          method: dto.method as PaymentMethod,
          externalRef: dto.external_ref ?? null,
          status: 'PENDING_CONFIRM',
        },
      });
      await this.deriveOrder(tx, orderId);
      return payment;
    });
  }

  /** 管理员线下代收：核实即到账（SUCCEEDED），recordedById 记录经办人 */
  async recordAdminPayment(
    adminId: string,
    orderId: string,
    dto: RecordPaymentDto,
  ) {
    if (!ADMIN_PAYMENT_METHODS.includes(dto.method as PaymentMethod)) {
      throw new BadRequestException(`不支持的付款方式：${dto.method}`);
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException(`订单不存在：${orderId}`);
    if (['FAILED', 'CANCELLED', 'REFUNDED'].includes(order.status)) {
      throw new ConflictException('订单当前状态不允许新增付款');
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId,
          amountCents: dto.amount_cents,
          method: dto.method as PaymentMethod,
          externalRef: dto.external_ref ?? null,
          status: 'SUCCEEDED',
          recordedById: adminId,
        },
      });
      await this.deriveOrder(tx, orderId);
      return payment;
    });
  }

  /** 管理员确认一笔待核实付款 */
  async confirmPayment(adminId: string, paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException(`付款记录不存在：${paymentId}`);
    if (payment.status !== 'PENDING_CONFIRM') {
      throw new ConflictException('只有待确认的付款可以确认');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'SUCCEEDED', recordedById: adminId },
      });
      await this.deriveOrder(tx, payment.orderId);
      return updated;
    });
  }

  /** 管理员驳回一笔待核实付款：仅将状态置为 FAILED，不派生订单状态 */
  async rejectPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException(`付款记录不存在：${paymentId}`);
    if (payment.status !== 'PENDING_CONFIRM') {
      throw new ConflictException('只有待确认的付款可以驳回');
    }
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'FAILED' },
    });
  }

  // ---------------------------------------------------------------- 查询

  /** 我的订单列表：按创建时间倒序，附加已付/已退金额 */
  async myOrders(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { parentId: userId },
      include: {
        items: {
          include: {
            enrollment: {
              select: {
                id: true,
                student: { select: { name: true } },
                classSession: {
                  select: {
                    course: {
                      select: {
                        id: true,
                        title: true,
                        term: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
            eventRegistration: {
              select: {
                id: true,
                event: { select: { id: true, title: true } },
              },
            },
          },
        },
        payments: true,
        refunds: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((o) => ({ ...o, ...this.attachTotals(o) }));
  }

  /** 管理员订单列表：可选按状态 / 学期 / 校区 / 课程过滤；明细带课程信息（课程名、学期、上课时间、地点） */
  async adminOrders(query: AdminOrdersQuery) {
    const classSessionFilter: Record<string, unknown> = {};
    if (query.campus) classSessionFilter.campusId = query.campus;
    if (query.course || query.term) {
      classSessionFilter.course = {
        ...(query.course ? { id: query.course } : {}),
        ...(query.term ? { termId: query.term } : {}),
      };
    }
    const hasItemFilter = query.campus || query.course || query.term;
    const orders = await this.prisma.order.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(hasItemFilter
          ? { items: { some: { enrollment: { classSession: classSessionFilter } } } }
          : {}),
      },
      include: {
        items: {
          include: {
            enrollment: {
              select: {
                id: true,
                student: {
                  select: {
                    name: true,
                    dob: true,
                    parentLinks: { select: { relationship: true } },
                  },
                },
                classSession: {
                  select: {
                    id: true,
                    startTime: true,
                    endTime: true,
                    room: true,
                    course: {
                      select: {
                        id: true,
                        title: true,
                        format: true,
                        term: { select: { id: true, name: true } },
                      },
                    },
                    campus: { select: { id: true, name: true } },
                  },
                },
              },
            },
            eventRegistration: {
              select: {
                id: true,
                student: {
                  select: {
                    name: true,
                    dob: true,
                    parentLinks: { select: { relationship: true } },
                  },
                },
                event: {
                  select: { id: true, title: true, category: true },
                },
              },
            },
          },
        },
        payments: true,
        refunds: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // 缴费类型判定：报名 → 课程形式（大课/私教/大师课）；活动报名 → 活动/比赛
    const itemKind = (item: {
      enrollment?: { classSession?: { course?: { format?: string } | null } | null } | null;
      eventRegistration?: { event?: { category?: string } | null } | null;
    }): string => {
      const format = item.enrollment?.classSession?.course?.format;
      if (format === 'GROUP' || format === 'PRIVATE' || format === 'MASTER') return format;
      const category = item.eventRegistration?.event?.category;
      if (category === 'EVENT' || category === 'COMPETITION') return category;
      return 'OTHER';
    };
    // 学员类型判定：满 18 岁或 SELF 绑定 → 成人，否则小孩
    const studentTypeOf = (student?: {
      dob?: Date | string | null;
      parentLinks?: Array<{ relationship?: string }>;
    } | null): 'ADULT' | 'YOUTH' => {
      if (student?.dob) {
        const dob = new Date(student.dob);
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 18);
        if (dob <= cutoff) return 'ADULT';
      }
      if (student?.parentLinks?.some((l) => l.relationship === 'SELF')) return 'ADULT';
      return 'YOUTH';
    };

    let result = orders.map((o) => {
      const kinds = [...new Set(o.items.map(itemKind))];
      const studentTypes: Array<'ADULT' | 'YOUTH'> = [
        ...new Set(
          o.items.map((it) =>
            studentTypeOf(it.enrollment?.student ?? it.eventRegistration?.student),
          ),
        ),
      ];
      return { ...o, ...this.attachTotals(o), kinds, studentTypes };
    });
    if (query.kind) result = result.filter((o) => o.kinds.includes(query.kind as string));
    if (query.student_type)
      result = result.filter((o) =>
        o.studentTypes.includes(query.student_type as 'ADULT' | 'YOUTH'),
      );
    return result;
  }

  /**
   * 管理员设置/清除订单折扣。
   * 仅无任何付款/退款记录的待支付订单可操作；折扣只改应付金额，不动明细行。
   * PERCENT：discount_value 1-99（如 90=9折）；FIXED：discount_value 为直减 cents。
   * 传 discount_type=null 清除折扣，应付恢复为原价。
   */
  async setOrderDiscount(orderId: string, dto: SetDiscountDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true, refunds: true },
    });
    if (!order) throw new NotFoundException(`订单不存在：${orderId}`);
    if (order.payments.length > 0 || order.refunds.length > 0) {
      throw new ConflictException('订单已有付款或退款记录，不可再设置折扣');
    }

    const type = dto.discount_type ?? null;
    const value = dto.discount_value ?? null;
    let discountType: string | null = null;
    let discountValue: number | null = null;
    let amountCents = order.originalAmountCents;

    if (type) {
      if (value == null) throw new BadRequestException('请填写折扣值');
      if (type === 'PERCENT') {
        if (value < 1 || value > 99)
          throw new BadRequestException('打折须为 1-99 的整数，如 90 表示 9 折');
        amountCents = Math.round((order.originalAmountCents * value) / 100);
      } else {
        if (value >= order.originalAmountCents)
          throw new BadRequestException('直减金额须小于订单原价');
        amountCents = order.originalAmountCents - value;
      }
      if (amountCents < 1) throw new BadRequestException('折后应付金额至少为 1 分');
      discountType = type;
      discountValue = value;
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { discountType, discountValue, amountCents },
    });
  }

  // ---------------------------------------------------------------- 退款

  /** 退款预览：直接委托报名模块 */
  async getRefundPreview(enrollmentId: string) {
    return this.enrollmentsService.refundPreview(enrollmentId);
  }

  /**
   * 按报名退款（管理员）。
   * 流程：取该报名的付款汇总 → 定位首个有可退余额的订单明细 → 金额校验
   * （不超订单已付）→ Stripe 侧先退款（线上支付订单）→ 事务内写 RefundRecord
   * 并派生订单状态 → 明细全额退回时触发报名全额退款流程。
   */
  async createRefundForEnrollment(
    adminId: string,
    enrollmentId: string,
    dto: RefundDto,
  ) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment) throw new NotFoundException(`报名不存在：${enrollmentId}`);

    const summary =
      await this.enrollmentsService.getEnrollmentPaymentSummary(enrollmentId);
    if (summary.netCents <= 0) {
      throw new ConflictException('该报名没有可退金额');
    }
    const target = summary.items.find(
      (i) => i.shareCents - i.refundedCents > 0,
    );
    if (!target) throw new ConflictException('该报名没有可退的订单明细');

    const order = await this.prisma.order.findUnique({
      where: { id: target.orderId },
      include: { payments: true, refunds: true },
    });
    if (!order) throw new NotFoundException(`订单不存在：${target.orderId}`);

    const orderPaid = order.payments
      .filter((p) => p.status === 'SUCCEEDED')
      .reduce((sum, p) => sum + p.amountCents, 0);
    const orderRefunded = order.refunds.reduce(
      (sum, r) => sum + r.amountCents,
      0,
    );
    const preview = await this.enrollmentsService.refundPreview(enrollmentId);
    const amount: number = dto.amount_cents ?? preview.suggestedCents;
    if (!amount || amount <= 0) {
      throw new BadRequestException('退款金额必须大于 0');
    }
    if (orderRefunded + amount > orderPaid) {
      throw new BadRequestException('退款金额不能超过已付金额');
    }

    // 订单走过 Stripe 线上支付时，先在 Stripe 侧退款拿到 refund id
    const hasStripe =
      order.payments.some(
        (p) => p.method === 'STRIPE' && p.status === 'SUCCEEDED',
      ) || order.paymentMethod === 'STRIPE';
    let stripeRefundId: string | undefined;
    if (hasStripe) {
      const { refundId } = await this.paymentsProvider.createRefund({
        orderId: order.id,
        amountCents: amount,
        reason: dto.reason,
      });
      stripeRefundId = refundId;
    }

    return this.prisma.$transaction(async (tx) => {
      const record = await tx.refundRecord.create({
        data: {
          orderId: order.id,
          orderItemId: target.orderItemId,
          amountCents: amount,
          reason: dto.reason ?? null,
          refundedById: adminId,
          stripeRefundId: stripeRefundId ?? null,
        },
      });
      const { status } = await this.deriveOrder(tx, order.id);

      if (target.refundedCents + amount >= target.shareCents) {
        // 该明细已全额退回：报名走全额退款流程（名额释放 / 状态流转）
        await this.enrollmentsService.applyFullRefundForEnrollment(
          tx,
          enrollmentId,
        );
      } else if (status === 'REFUNDED') {
        // 订单整体已全额退款：同步该订单下其余仍有效的报名
        await this.syncEnrollmentsForRefundedOrder(tx, order.id);
      }
      return record;
    });
  }

  /**
   * 订单整体进入 REFUNDED 时，把该订单下仍处于 CONFIRMED / PENDING_PAYMENT
   * 的报名全部走全额退款流程。
   */
  async syncEnrollmentsForRefundedOrder(
    tx: TxClient,
    orderId: string,
  ): Promise<void> {
    const items = await tx.orderItem.findMany({
      where: { orderId, enrollmentId: { not: null } },
      include: { enrollment: { select: { id: true, status: true } } },
    });
    for (const item of items) {
      if (!item.enrollment) continue;
      if (
        item.enrollment.status === 'CONFIRMED' ||
        item.enrollment.status === 'PENDING_PAYMENT'
      ) {
        await this.enrollmentsService.applyFullRefundForEnrollment(
          tx,
          item.enrollment.id,
        );
      }
    }
  }

  // ---------------------------------------------------------------- webhook primitives

  /** 按 Stripe payment intent id 查找订单（含付款流水），webhook 幂等入口 */
  async findOrderByPaymentIntentId(piId: string) {
    return this.prisma.order.findUnique({
      where: { stripePaymentIntentId: piId },
      include: { payments: true },
    });
  }

  /**
   * 记录一笔 Stripe 成功付款并派生订单状态。
   * stripeChargeId 唯一冲突（webhook 重复回调）直接抛给调用方做幂等处理。
   */
  async recordStripePayment(
    tx: TxClient,
    input: { orderId: string; amountCents: number; stripeChargeId: string },
  ): Promise<Payment> {
    const payment = await tx.payment.create({
      data: {
        orderId: input.orderId,
        amountCents: input.amountCents,
        method: 'STRIPE',
        status: 'SUCCEEDED',
        stripeChargeId: input.stripeChargeId,
      },
    });
    await this.deriveOrder(tx, input.orderId);
    return payment;
  }

  /** 按 Stripe charge id 查找付款记录 */
  async findPaymentByChargeId(chargeId: string) {
    return this.prisma.payment.findUnique({
      where: { stripeChargeId: chargeId },
    });
  }

  /**
   * 写入 Stripe 退款记录。stripeRefundId 唯一冲突（重复回调）直接抛给调用方。
   */
  async createStripeRefundRecord(
    tx: TxClient,
    input: {
      orderId: string;
      amountCents: number;
      stripeRefundId: string;
      refundedById: string;
      reason?: string;
    },
  ) {
    return tx.refundRecord.create({
      data: {
        orderId: input.orderId,
        amountCents: input.amountCents,
        stripeRefundId: input.stripeRefundId,
        refundedById: input.refundedById,
        reason: input.reason ?? null,
      },
    });
  }

  /** 取第一个管理员用户作为 webhook 场景的系统操作人；不存在返回 null */
  async findSystemActor() {
    return this.prisma.user.findFirst({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    });
  }


  // ---------------------------------------------------------------- 退款中心

  /**
   * GET /admin/refunds/enrollments：退款中心-课程报名查询。
   * 按学期 / 课程类型（大课 GROUP / 大师课 MASTER / 私教课 PRIVATE）/
   * 校区 / 课程 / 学员姓名过滤，返回报名及缴费汇总（已付/已退/可退）。
   */
  async refundEnrollments(query: {
    term?: string;
    format?: string;
    campus?: string;
    course?: string;
    student?: string;
  }) {
    const format =
      query.format === 'GROUP' || query.format === 'MASTER' || query.format === 'PRIVATE'
        ? (query.format as CourseFormat)
        : undefined;
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        ...(query.student
          ? { student: { name: { contains: query.student, mode: 'insensitive' } } }
          : {}),
        classSession: {
          ...(query.campus ? { campusId: query.campus } : {}),
          ...(query.course ? { courseId: query.course } : {}),
          course: {
            ...(query.term ? { termId: query.term } : {}),
            ...(format ? { format } : {}),
          },
        },
      },
      include: {
        student: { select: { id: true, name: true } },
        classSession: {
          select: {
            startTime: true,
            course: {
              select: {
                id: true,
                title: true,
                format: true,
                term: { select: { id: true, name: true } },
              },
            },
            campus: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { classSession: { startTime: 'desc' } },
      take: 200,
    });
    const rows: Array<Record<string, unknown>> = [];
    for (const e of enrollments) {
      const summary = await this.enrollmentsService.getEnrollmentPaymentSummary(e.id);
      rows.push({
        id: e.id,
        status: e.status,
        student: e.student,
        course: e.classSession.course,
        campus: e.classSession.campus,
        startTime: e.classSession.startTime,
        paidCents: summary.paidCents,
        refundedCents: summary.refundedCents,
        netCents: summary.netCents,
      });
    }
    return rows;
  }

  /**
   * GET /admin/refunds/event-registrations：退款中心-活动/比赛报名查询。
   * 按活动、年份（活动开始时间）过滤，返回报名及缴费汇总。
   */
  async refundEventRegistrations(query: { event?: string; year?: string }) {
    const yearNum = query.year ? parseInt(query.year, 10) : NaN;
    const yearFilter =
      Number.isFinite(yearNum) && yearNum >= 2000 && yearNum <= 2100
        ? {
            event: {
              startTime: {
                gte: new Date(`${yearNum}-01-01T00:00:00Z`),
                lt: new Date(`${yearNum + 1}-01-01T00:00:00Z`),
              },
            },
          }
        : {};
    const regs = await this.prisma.eventRegistration.findMany({
      where: { ...(query.event ? { eventId: query.event } : {}), ...yearFilter },
      include: {
        student: { select: { id: true, name: true } },
        event: { select: { id: true, title: true, startTime: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const rows: Array<Record<string, unknown>> = [];
    for (const r of regs) {
      const summary = await this.getEventRegistrationPaymentSummary(r.id);
      rows.push({
        id: r.id,
        status: r.status,
        feeStatus: r.feeStatus,
        ticketQuantity: r.ticketQuantity,
        participationFeeCents: r.participationFeeCents,
        ticketTotalCents: r.ticketTotalCents,
        student: r.student,
        event: r.event,
        paidCents: summary.paidCents,
        refundedCents: summary.refundedCents,
        netCents: summary.netCents,
      });
    }
    return rows;
  }

  /**
   * 活动报名的缴费汇总（经 OrderItem.eventRegistrationId → Order →
   * Payment/RefundRecord），口径与报名汇总一致：按明细金额占订单比例分摊。
   */
  async getEventRegistrationPaymentSummary(registrationId: string) {
    const items = await this.prisma.orderItem.findMany({
      where: { eventRegistrationId: registrationId },
      include: {
        order: { include: { payments: true } },
        refunds: true,
      },
    });
    const summary = {
      paidCents: 0,
      refundedCents: 0,
      netCents: 0,
      items: [] as Array<{
        orderItemId: string;
        orderId: string;
        orderAmountCents: number;
        shareCents: number;
        refundedCents: number;
      }>,
    };
    for (const item of items) {
      const orderPaid = item.order.payments
        .filter((p) => p.status === 'SUCCEEDED')
        .reduce((sum, p) => sum + p.amountCents, 0);
      const shareCents =
        item.order.amountCents > 0
          ? Math.round((orderPaid * item.amountCents) / item.order.amountCents)
          : 0;
      const refundedCents = item.refunds.reduce((sum, r) => sum + r.amountCents, 0);
      summary.items.push({
        orderItemId: item.id,
        orderId: item.orderId,
        orderAmountCents: item.order.amountCents,
        shareCents,
        refundedCents,
      });
      summary.paidCents += shareCents;
      summary.refundedCents += refundedCents;
    }
    summary.netCents = summary.paidCents - summary.refundedCents;
    return summary;
  }

  /** 退款预览（按活动报名）：建议金额为可退净额 */
  async eventRegistrationRefundPreview(registrationId: string) {
    const reg = await this.prisma.eventRegistration.findUnique({
      where: { id: registrationId },
      include: {
        student: { select: { name: true } },
        event: { select: { title: true } },
      },
    });
    if (!reg) throw new NotFoundException('活动报名不存在');
    const summary = await this.getEventRegistrationPaymentSummary(registrationId);
    return {
      registrationId,
      studentName: reg.student?.name ?? null,
      eventTitle: reg.event?.title ?? null,
      priceCents: (reg.participationFeeCents ?? 0) + (reg.ticketTotalCents ?? 0),
      paidCents: summary.paidCents,
      refundedCents: summary.refundedCents,
      netCents: summary.netCents,
      suggestedCents: summary.netCents,
      formula: 'PAID_AMOUNT' as const,
    };
  }

  /**
   * 按活动报名退款（管理员）。
   * 流程与按报名退款一致：定位首个有可退余额的订单明细 → 金额校验 →
   * Stripe 侧先退款（线上支付订单）→ 事务内写 RefundRecord 并派生订单状态 →
   * 明细全额退回时该活动报名置为已取消。
   */
  async createRefundForEventRegistration(
    adminId: string,
    registrationId: string,
    dto: { amount_cents?: number; reason?: string },
  ) {
    const reg = await this.prisma.eventRegistration.findUnique({
      where: { id: registrationId },
    });
    if (!reg) throw new NotFoundException('活动报名不存在');

    const summary = await this.getEventRegistrationPaymentSummary(registrationId);
    if (summary.netCents <= 0) {
      throw new ConflictException('该报名没有可退金额');
    }
    const target = summary.items.find((i) => i.shareCents - i.refundedCents > 0);
    if (!target) throw new ConflictException('该报名没有可退的订单明细');

    const order = await this.prisma.order.findUnique({
      where: { id: target.orderId },
      include: { payments: true, refunds: true },
    });
    if (!order) throw new NotFoundException(`订单不存在：${target.orderId}`);

    const orderPaid = order.payments
      .filter((p) => p.status === 'SUCCEEDED')
      .reduce((sum, p) => sum + p.amountCents, 0);
    const orderRefunded = order.refunds.reduce((sum, r) => sum + r.amountCents, 0);
    const preview = await this.eventRegistrationRefundPreview(registrationId);
    const amount: number = dto.amount_cents ?? preview.suggestedCents;
    if (!amount || amount <= 0) {
      throw new BadRequestException('退款金额必须大于 0');
    }
    if (orderRefunded + amount > orderPaid) {
      throw new BadRequestException('退款金额不能超过已付金额');
    }

    const hasStripe =
      order.payments.some(
        (p) => p.method === 'STRIPE' && p.status === 'SUCCEEDED',
      ) || order.paymentMethod === 'STRIPE';
    let stripeRefundId: string | undefined;
    if (hasStripe) {
      const { refundId } = await this.paymentsProvider.createRefund({
        orderId: order.id,
        amountCents: amount,
        reason: dto.reason,
      });
      stripeRefundId = refundId;
    }

    return this.prisma.$transaction(async (tx) => {
      const record = await tx.refundRecord.create({
        data: {
          orderId: order.id,
          orderItemId: target.orderItemId,
          amountCents: amount,
          reason: dto.reason ?? null,
          refundedById: adminId,
          stripeRefundId: stripeRefundId ?? null,
        },
      });
      await this.deriveOrder(tx, order.id);

      if (target.refundedCents + amount >= target.shareCents) {
        // 该明细已全额退回：活动报名置为已取消
        await tx.eventRegistration.update({
          where: { id: registrationId },
          data: { status: 'CANCELLED' },
        });
      }
      return record;
    });
  }

  /**
   * GET /admin/refunds/records：退款记录列表（审计）。
   * 可选按学期过滤（仅课程报名类退款；活动类退款不归属学期）。
   */
  async refundRecords(query: { term?: string }) {
    return this.prisma.refundRecord.findMany({
      where: query.term
        ? {
            orderItem: {
              enrollment: { classSession: { course: { termId: query.term } } },
            },
          }
        : {},
      include: {
        order: { select: { id: true } },
        orderItem: {
          select: {
            id: true,
            description: true,
            enrollment: {
              select: {
                id: true,
                student: { select: { name: true } },
                classSession: {
                  select: {
                    course: {
                      select: {
                        title: true,
                        term: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
            eventRegistration: {
              select: {
                id: true,
                student: { select: { name: true } },
                event: { select: { title: true } },
              },
            },
          },
        },
        refundedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // ---------------------------------------------------------------- 内部工具

  /** 查订单 + 归属校验（家长只能访问自己的订单） */
  private async getAccessibleOrder(requester: RequestUser, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException(`订单不存在：${orderId}`);
    if (order.parentId !== requester.id && requester.role !== 'ADMIN') {
      throw new ForbiddenException('无权访问该订单');
    }
    return order;
  }

  /** 为订单附加已付 / 已退金额（SUCCEEDED 付款求和，全部退款记录求和） */
  private attachTotals<
    O extends {
      payments: { status: PaymentStatus; amountCents: number }[];
      refunds: { amountCents: number }[];
    },
  >(order: O) {
    const paidCents = order.payments
      .filter((p) => p.status === 'SUCCEEDED')
      .reduce((sum, p) => sum + p.amountCents, 0);
    const refundedCents = order.refunds.reduce(
      (sum, r) => sum + r.amountCents,
      0,
    );
    return { paidCents, refundedCents };
  }
}
