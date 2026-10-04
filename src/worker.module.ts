import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoursesModule } from './courses/courses.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { RemindersModule } from './reminders/reminders.module';
import { WorkerSchedulerService } from './worker-scheduler.service';

/**
 * 独立 worker 进程的根模块（设计文档 §五）：
 * 只跑 BullMQ 定时任务（dance-tasks / reminder-send），不开 HTTP 服务。
 * 注意：package.json 的 `worker` 脚本（node dist/worker.js）由协调器统一添加。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    IntegrationsModule,
    RemindersModule,
    EnrollmentsModule,
    NotificationsModule,
    CoursesModule,
  ],
  providers: [WorkerSchedulerService],
})
export class WorkerModule {}
