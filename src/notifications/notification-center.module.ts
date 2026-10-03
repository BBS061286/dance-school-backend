import { Module } from '@nestjs/common';
import { NotificationCenterService } from './notification-center.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsModule } from './notifications.module';

/**
 * 通知中心模块（§6.28，D5 新增）：挂载通知列表/未读数/标记已读/催缴提醒路由。
 * 复用 D1/D4 既有的 NotificationsModule（写入能力），不改动其文件。
 * 注意：需在 app.module.ts imports 中加入 NotificationCenterModule（由编排方接线）。
 */
@Module({
  imports: [NotificationsModule],
  controllers: [NotificationsController],
  providers: [NotificationCenterService],
  exports: [NotificationCenterService],
})
export class NotificationCenterModule {}
