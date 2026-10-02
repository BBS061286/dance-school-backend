import { Injectable } from '@nestjs/common';

/** 推送服务接口（Firebase FCM）。D1 仅提供 stub，不接真实 key。 */
export abstract class PushProvider {
  abstract sendPush(
    userId: string,
    title: string,
    body: string,
  ): Promise<{ messageId: string }>;
}

/** FCM stub：只打日志 */
@Injectable()
export class StubPushProvider extends PushProvider {
  async sendPush(userId: string, title: string, body: string) {
    // eslint-disable-next-line no-console
    console.log('[StubPushProvider] sendPush', { userId, title, body });
    return { messageId: `stub_push_${Date.now()}` };
  }
}
