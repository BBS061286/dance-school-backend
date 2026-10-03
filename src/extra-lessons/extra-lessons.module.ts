import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExtraLessonsController } from './extra-lessons.controller';
import { ExtraLessonsService } from './extra-lessons.service';

/**
 * 加课模块：1对1 / 临时 group 加课申请与时段审批（§6.8/6.9/6.11/6.15/6.17）。
 * 注意：需由父级在 app.module.ts 中装配（ExtraLessonsModule）。
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ExtraLessonsController],
  providers: [ExtraLessonsService],
  exports: [ExtraLessonsService],
})
export class ExtraLessonsModule {}
