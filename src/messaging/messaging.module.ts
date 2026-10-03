import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';

/**
 * 私信模块（§6.22/6.23，D5 新增）。
 * 注意：需在 app.module.ts imports 中加入 MessagingModule（由编排方接线）。
 */
@Module({
  imports: [NotificationsModule],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
