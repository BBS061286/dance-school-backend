import { Injectable } from '@nestjs/common';

/** 邮件服务接口（SendGrid）。D1 仅提供 stub，不接真实 key。 */
export abstract class EmailProvider {
  abstract sendEmail(
    to: string,
    subject: string,
    html: string,
  ): Promise<{ messageId: string }>;
}

/** SendGrid stub：只打日志 */
@Injectable()
export class StubEmailProvider extends EmailProvider {
  async sendEmail(to: string, subject: string, html: string) {
    // eslint-disable-next-line no-console
    console.log('[StubEmailProvider] sendEmail', { to, subject, html });
    return { messageId: `stub_email_${Date.now()}` };
  }
}
