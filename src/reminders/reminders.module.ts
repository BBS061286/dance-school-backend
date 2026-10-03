import { Module } from '@nestjs/common';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentTimeoutService } from './payment-timeout.service';
import { ReminderSendWorker } from './reminder-send.worker';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { SeatReconcileService } from './seat-reconcile.service';

/**
 * 提醒模块：规则 CRUD + 三个第五章定时任务的业务逻辑。
 * 注意：PrismaModule 是 @Global() 的，无需显式引入。
 */
@Module({
  imports: [EnrollmentsModule, IntegrationsModule, NotificationsModule],
  controllers: [RemindersController],
  providers: [
    RemindersService,
    ReminderSendWorker,
    PaymentTimeoutService,
    SeatReconcileService,
  ],
  exports: [RemindersService, PaymentTimeoutService, SeatReconcileService],
})
export class RemindersModule {}
