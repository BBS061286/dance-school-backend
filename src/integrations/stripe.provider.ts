import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  PaymentsProvider,
  CreateCheckoutSessionInput,
  CreateRefundInput,
} from './payments.provider';

/** Stripe 真实实现：需要 STRIPE_SECRET_KEY 环境变量 */
@Injectable()
export class StripePaymentsProvider extends PaymentsProvider {
  private readonly logger = new Logger(StripePaymentsProvider.name);
  private readonly stripe: Stripe;

  constructor(private config: ConfigService) {
    super();
    const key = config.get<string>('STRIPE_SECRET_KEY');
    if (!key) throw new Error('STRIPE_SECRET_KEY 未设置');
    this.stripe = new Stripe(key);
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput) {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: input.currency.toLowerCase(),
            product_data: { name: `FJW Dance Studio 订单 ${input.orderId}` },
            unit_amount: input.amountCents,
          },
          quantity: 1,
        },
      ],
      metadata: { orderId: input.orderId },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    this.logger.log(`Checkout session created: ${session.id} for order ${input.orderId}`);
    return { url: session.url ?? '', sessionId: session.id };
  }

  async createRefund(input: CreateRefundInput) {
    // 按 metadata orderId 找到对应的 payment_intent 再退款
    const sessions = await this.stripe.checkout.sessions.list({
      limit: 100,
    });
    const matched = sessions.data.find(
      (s) => s.metadata?.orderId === input.orderId && s.payment_intent,
    );
    if (!matched?.payment_intent) {
      throw new Error(`订单 ${input.orderId} 未找到对应的 Stripe 支付记录`);
    }
    const refund = await this.stripe.refunds.create({
      payment_intent: matched.payment_intent as string,
      amount: input.amountCents,
      reason: 'requested_by_customer',
      metadata: { reason: input.reason ?? '' },
    });
    this.logger.log(`Refund created: ${refund.id} for order ${input.orderId}`);
    return { refundId: refund.id };
  }
}
