import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { SmsProvider } from './sms.provider';

/** Twilio 真实实现：需要 TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER */
@Injectable()
export class TwilioSmsProvider extends SmsProvider {
  private readonly logger = new Logger(TwilioSmsProvider.name);
  private readonly client: Twilio;
  private readonly from: string;

  constructor(private config: ConfigService) {
    super();
    const sid = config.get<string>('TWILIO_ACCOUNT_SID');
    const token = config.get<string>('TWILIO_AUTH_TOKEN');
    const from = config.get<string>('TWILIO_FROM_NUMBER');
    if (!sid || !token || !from) throw new Error('Twilio 环境变量未设置完整');
    this.client = new Twilio(sid, token);
    this.from = from;
  }

  async sendSms(to: string, body: string) {
    const msg = await this.client.messages.create({
      from: this.from,
      to,
      body,
    });
    this.logger.log(`SMS sent: ${msg.sid} to ${to}`);
    return { messageId: msg.sid };
  }
}
