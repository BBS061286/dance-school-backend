import { Injectable } from '@nestjs/common';

/** 短信服务接口（Twilio）。D1 仅提供 stub，不接真实 key。 */
export abstract class SmsProvider {
  abstract sendSms(to: string, body: string): Promise<{ messageId: string }>;
}

/** Twilio stub：只打日志 */
@Injectable()
export class StubSmsProvider extends SmsProvider {
  async sendSms(to: string, body: string) {
    // eslint-disable-next-line no-console
    console.log('[StubSmsProvider] sendSms', { to, body });
    return { messageId: `stub_sms_${Date.now()}` };
  }
}
