import { Module } from '@nestjs/common';
import { StubEmailProvider, EmailProvider } from './email.provider';
import { StubPaymentsProvider, PaymentsProvider } from './payments.provider';
import { StubPushProvider, PushProvider } from './push.provider';
import { StubSmsProvider, SmsProvider } from './sms.provider';

/**
 * 第三方集成模块：D1 全部为 stub 实现（只打日志、返回假数据），不接真实 key。
 * D2 起按需替换为真实实现（Stripe / Twilio / SendGrid / FCM）。
 */
@Module({
  providers: [
    { provide: PaymentsProvider, useClass: StubPaymentsProvider },
    { provide: SmsProvider, useClass: StubSmsProvider },
    { provide: EmailProvider, useClass: StubEmailProvider },
    { provide: PushProvider, useClass: StubPushProvider },
  ],
  exports: [PaymentsProvider, SmsProvider, EmailProvider, PushProvider],
})
export class IntegrationsModule {}
