import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';
import { EmailProvider } from './email.provider';

/** SendGrid 真实实现：需要 SENDGRID_API_KEY / SENDGRID_FROM_EMAIL */
@Injectable()
export class SendGridEmailProvider extends EmailProvider {
  private readonly logger = new Logger(SendGridEmailProvider.name);
  private readonly from: string;

  constructor(private config: ConfigService) {
    super();
    const key = config.get<string>('SENDGRID_API_KEY');
    const from = config.get<string>('SENDGRID_FROM_EMAIL');
    if (!key || !from) throw new Error('SendGrid 环境变量未设置完整');
    sgMail.setApiKey(key);
    this.from = from;
  }

  async sendEmail(to: string, subject: string, html: string) {
    const [res] = await sgMail.send({
      from: this.from,
      to,
      subject,
      html,
    });
    const messageId = res.headers['x-message-id'] as string ?? `sg_${Date.now()}`;
    this.logger.log(`Email sent: ${messageId} to ${to}`);
    return { messageId };
  }
}
