import { Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StubEmailProvider, EmailProvider } from './email.provider';
import { SendGridEmailProvider } from './sendgrid.provider';
import { StubPaymentsProvider, PaymentsProvider } from './payments.provider';
import { StripePaymentsProvider } from './stripe.provider';
import { StubPushProvider, PushProvider } from './push.provider';
import { FcmPushProvider } from './fcm.provider';
import { StubSmsProvider, SmsProvider } from './sms.provider';
import { TwilioSmsProvider } from './twilio.provider';

const logger = new Logger('IntegrationsModule');

/**
 * 第三方集成模块：有 key 用真实实现，无 key 自动降级为 stub（只打日志）。
 * 启动时会打印每个渠道的实际模式。
 */
function pickProvider(
  name: string,
  envKeys: string[],
  RealClass: new (config: ConfigService) => any,
  StubClass: new () => any,
) {
  return {
    provide: name,
    useFactory: (config: ConfigService) => {
      const hasAll = envKeys.every((k) => !!config.get<string>(k));
      if (hasAll) {
        logger.log(`[${name}] 使用真实实现`);
        return new RealClass(config);
      }
      logger.warn(`[${name}] 缺少环境变量 ${envKeys.join('/')}，降级为 stub（只打日志）`);
      return new StubClass();
    },
    inject: [ConfigService],
  };
}

@Module({
  providers: [
    pickProvider('PaymentsProvider', ['STRIPE_SECRET_KEY'], StripePaymentsProvider, StubPaymentsProvider),
    pickProvider('SmsProvider', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'], TwilioSmsProvider, StubSmsProvider),
    pickProvider('EmailProvider', ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL'], SendGridEmailProvider, StubEmailProvider),
    pickProvider('PushProvider', ['FIREBASE_SERVICE_ACCOUNT'], FcmPushProvider, StubPushProvider),
    // 兼容旧的 class token 注入
    { provide: PaymentsProvider, useExisting: 'PaymentsProvider' },
    { provide: SmsProvider, useExisting: 'SmsProvider' },
    { provide: EmailProvider, useExisting: 'EmailProvider' },
    { provide: PushProvider, useExisting: 'PushProvider' },
  ],
  exports: [PaymentsProvider, SmsProvider, EmailProvider, PushProvider],
})
export class IntegrationsModule {}
