import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { isUniqueViolation } from '../common/prisma-errors';

/**
 * Stripe webhook 接收器（D2 stub 模式）。
 * v2 R8c 幂等：所有写操作靠 Stripe 侧 ID 的唯一约束去重，重复回调命中 P2002 直接 200。
 * v2 R4：charge.refunded 落 RefundRecord 流水并重新派生 Order 状态。
 */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  /**
   * 签名校验（stub 模式）。
   * 若配了 STRIPE_WEBHOOK_SECRET 说明期望真实校验，但 D2 stub 不支持（真实 HMAC 需要 raw body），
   * 直接 400 并要求 README 注明的 stub 流程；否则只做结构校验。
   */
  verifySignature(body: any, sigHeader: string | undefined): void {
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      throw new BadRequestException(
        '已配置真实 secret 但当前为 stub 模式，暂不支持真实签名校验',
      );
    }
    const objId = body?.data?.object?.id;
    if (!body || typeof body.type !== 'string' || typeof objId !== 'string') {
      throw new BadRequestException('webhook 事件结构非法');
    }
    console.warn('[webhook] stub 签名结构校验通过（非生产模式）');
  }

  /** 事件分发：所有分支（重复回调、未知订单、未知事件）都静默 200，只有结构非法才 400。 */
  async handleEvent(body: any, sigHeader?: string): Promise<void> {
    this.verifySignature(body, sigHeader);
    switch (body.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(body.data.object);
        return;
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(body.data.object);
        return;
      case 'charge.refunded':
        await this.handleChargeRefunded(body.data.object);
        return;
      default:
        console.log(`[webhook] 未知事件类型: ${body.type}，忽略`);
        return;
    }
  }

  /** payment_intent.succeeded：落一条 Payment 流水（内部派生 Order 状态），重复回调靠 stripe_charge_id 唯一约束幂等。 */
  private async handlePaymentIntentSucceeded(obj: any): Promise<void> {
    const piId: string = obj.id;
    const order = await this.billing.findOrderByPaymentIntentId(piId);
    if (!order) return; // 未知订单 → 200 忽略

    const charge = obj.charges?.data?.[0];
    if (!charge?.id) return;

    const amount: number =
      charge.amount ?? obj.amount_received ?? order.amountCents;

    try {
      await this.prisma.$transaction((tx) =>
        this.billing.recordStripePayment(tx, {
          orderId: order.id,
          amountCents: amount,
          stripeChargeId: charge.id,
        }),
      );
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // 重复回调 → 200
    }
  }

  /** payment_intent.payment_failed：订单标记 FAILED（已是终态的不动）。 */
  private async handlePaymentIntentFailed(obj: any): Promise<void> {
    const order = await this.billing.findOrderByPaymentIntentId(obj.id);
    if (!order) return;
    const terminal: OrderStatus[] = [
      OrderStatus.PAID,
      OrderStatus.REFUNDED,
      OrderStatus.FAILED,
      OrderStatus.CANCELLED,
    ];
    if (terminal.includes(order.status)) return;
    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.FAILED },
    });
  }

  /** charge.refunded：逐条退款落 RefundRecord 流水（stripe_refund_id 唯一约束幂等），再派生 Order 状态，全额退款时同步 Enrollment。 */
  private async handleChargeRefunded(obj: any): Promise<void> {
    const chargeId: string = obj.id;
    const payment = await this.billing.findPaymentByChargeId(chargeId);
    if (!payment) return; // 未知 charge → 200 忽略

    const actor = await this.billing.findSystemActor();
    if (!actor) {
      // refundedById 必填（外键），无系统账号时跳过，避免写库报错
      console.warn(
        `[webhook] charge.refunded：未找到系统账号（ADMIN），跳过退款记录 charge=${chargeId}`,
      );
      return;
    }

    const refunds: any[] = obj.refunds?.data ?? [];
    await this.prisma.$transaction(async (tx) => {
      for (const r of refunds) {
        try {
          await this.billing.createStripeRefundRecord(tx, {
            orderId: payment.orderId,
            amountCents: r.amount,
            stripeRefundId: r.id,
            refundedById: actor.id,
            reason: 'Stripe charge.refunded webhook',
          });
        } catch (e) {
          if (!isUniqueViolation(e)) throw e; // 重复回调 → 200
        }
      }
      const { status } = await this.billing.deriveOrder(tx, payment.orderId);
      if (status === OrderStatus.REFUNDED) {
        await this.billing.syncEnrollmentsForRefundedOrder(tx, payment.orderId);
      }
    });
  }
}
