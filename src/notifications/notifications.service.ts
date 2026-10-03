import { Injectable } from '@nestjs/common';
import {
  Notification,
  NotificationSourceType,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  sourceType: NotificationSourceType;
  sourceId: string;
  channels?: string[];
}

/**
 * 统一通知写入服务（§6.28）。D4 创建骨架并用于课次取消/顺延、加课状态变更；
 * D5 在此基础上加通知中心端点与各类触发（WAITLIST_PROMOTED / MESSAGE_REPLY /
 * INSTRUCTOR_ASSIGNMENT / DOCUMENT_SIGN_REQUEST / REVIEW_PUBLISHED / PAYMENT_REMINDER）。
 * 契约：notify() 只写 Notification 行，不做实际推送（推送走各通道 stub/ReminderLog 体系）。
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(input: NotifyInput): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        channels: input.channels ?? ['app_push'],
      },
    });
  }
}
