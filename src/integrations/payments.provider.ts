import { Injectable } from '@nestjs/common';

export interface CreateCheckoutSessionInput {
  orderId: string;
  amountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateRefundInput {
  orderId: string;
  amountCents: number;
  reason?: string;
}

/** 支付服务接口（Stripe）。D1 仅提供 stub，不接真实 key。 */
export abstract class PaymentsProvider {
  abstract createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<{ url: string; sessionId: string }>;
  abstract createRefund(input: CreateRefundInput): Promise<{ refundId: string }>;
}

/** Stripe stub：只打日志、返回假数据，供 D2 之前联调流程使用 */
@Injectable()
export class StubPaymentsProvider extends PaymentsProvider {
  async createCheckoutSession(input: CreateCheckoutSessionInput) {
    // eslint-disable-next-line no-console
    console.log('[StubPaymentsProvider] createCheckoutSession', input);
    return {
      url: `https://stub-checkout.local/sessions/stub_${input.orderId}`,
      sessionId: `stub_${input.orderId}`,
    };
  }

  async createRefund(input: CreateRefundInput) {
    // eslint-disable-next-line no-console
    console.log('[StubPaymentsProvider] createRefund', input);
    return { refundId: `stub_refund_${input.orderId}` };
  }
}
