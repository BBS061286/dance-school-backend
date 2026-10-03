import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/** 统一通知中心（§6.28）：列表 / 未读数 / 标记已读 / 催缴提醒触发 */
@Injectable()
export class NotificationCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 统一通知列表，各端（家长/成人/教师）复用 */
  async list(
    userId: string,
    query: { type?: NotificationType; unreadOnly?: boolean },
  ) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(query.type ? { type: query.type } : {}),
        ...(query.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** 角标未读数 */
  async unreadCount(userId: string): Promise<{ unread_count: number }> {
    const unread_count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { unread_count };
  }

  /** 标记已读（幂等；只能标记自己的通知） */
  async markRead(userId: string, id: string) {
    const record = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!record) throw new NotFoundException('通知不存在');
    if (!record.readAt) {
      await this.prisma.notification.update({
        where: { id },
        data: { readAt: new Date() },
      });
    }
    return { id, read: true };
  }

  /**
   * 催缴学费（§6.28 缴费管理 API）：读订单欠费金额，向学员家长/成人学员本人
   * （订单 parentId 对应的 User）发送 PAYMENT_REMINDER 通知，sourceType=ORDER。
   * 文案含欠费金额及可用支付方式（Zelle/PayPal/线下现金/支票）。
   */
  async remindOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true, refunds: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    const paid = order.payments
      .filter((p) => p.status === 'SUCCEEDED')
      .reduce((sum, p) => sum + p.amountCents, 0);
    const refunded = order.refunds.reduce((sum, r) => sum + r.amountCents, 0);
    const outstanding = order.amountCents - paid + refunded;
    if (outstanding <= 0) {
      throw new ConflictException('该订单无欠费，无需催缴');
    }
    const notification = await this.notifications.notify({
      userId: order.parentId,
      type: NotificationType.PAYMENT_REMINDER,
      title: '学费催缴提醒',
      body: `您的订单尚有学费未缴清，欠费金额 $${(outstanding / 100).toFixed(2)}。可通过 Zelle / PayPal / 线下现金 / 支票 完成支付，如有疑问请联系学校。`,
      sourceType: 'ORDER',
      sourceId: order.id,
    });
    return {
      order_id: order.id,
      outstanding_cents: outstanding,
      notified_user_id: order.parentId,
      notification_id: notification.id,
    };
  }
}
