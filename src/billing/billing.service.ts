import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderPaymentMethod,
  OrderStatus,
  Payment,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { PaymentsProvider } from '../integrations/payments.provider';
import { PrismaService } from '../prisma/prisma.service';
import { RequestUser, TxClient } from '../common/types';
import { AdminOrdersQuery } from './dto/order.dto';
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
    }
    return { status: next };
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
    const { url } = await this.paymentsProvider.createCheckoutSession({
      orderId: order.id,
      amountCents: order.amountCents,
      currency: order.currency,
      successUrl: `${frontendUrl}/orders/${order.id}/success`,
      cancelUrl: `${frontendUrl}/orders/${order.id}`,
    });
    return { url, stripe_payment_intent_id: piId };
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
              select: { id: true, student: { select: { name: true } } },
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

  /** 管理员订单列表：可选按状态 / 校区过滤 */
  async adminOrders(query: AdminOrdersQuery) {
    const orders = await this.prisma.order.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.campus
          ? {
              items: {
                some: {
                  enrollment: { classSession: { campusId: query.campus } },
                },
              },
            }
          : {}),
      },
      include: {
        items: {
          include: {
            enrollment: {
              select: { id: true, student: { select: { name: true } } },
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
