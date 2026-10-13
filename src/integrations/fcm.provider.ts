import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { PushProvider } from './push.provider';

/** FCM 真实实现：需要 FIREBASE_SERVICE_ACCOUNT（JSON 字符串）环境变量 */
@Injectable()
export class FcmPushProvider extends PushProvider {
  private readonly logger = new Logger(FcmPushProvider.name);

  constructor(private config: ConfigService) {
    super();
    const saJson = config.get<string>('FIREBASE_SERVICE_ACCOUNT');
    if (!saJson) throw new Error('FIREBASE_SERVICE_ACCOUNT 未设置');
    if (getApps().length === 0) {
      initializeApp({
        credential: cert(JSON.parse(saJson)),
      });
    }
  }

  async sendPush(userId: string, title: string, body: string) {
    // userId 对应用户的 FCM device token，需由客户端上报并存储
    // 此处按 topic 推送（topic = user_<userId>），客户端订阅自己的 topic
    const res = await getMessaging().send({
      topic: `user_${userId}`,
      notification: { title, body },
    });
    this.logger.log(`Push sent: ${res} to user ${userId}`);
    return { messageId: res };
  }
}
