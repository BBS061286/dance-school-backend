import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';

/** 报名模块：EnrollmentsService 导出供 BillingService（D3）调用；D5 引入 NotificationsModule 以发送 WAITLIST_PROMOTED 通知 */
@Module({
  imports: [NotificationsModule],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
