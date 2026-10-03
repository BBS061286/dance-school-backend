import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

/**
 * 活动模块：活动发布 / 报名购票 / 参赛费 / 通知（§6.5/6.6/6.7/§4.7/§6.28）。
 * 注意：需由父级在 app.module.ts 中装配（EventsModule）。
 */
@Module({
  imports: [NotificationsModule, BillingModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
