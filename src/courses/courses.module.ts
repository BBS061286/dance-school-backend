import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { TermArchiveService } from './term-archive.service';

/**
 * 课程管理模块（§6.27，D5 新增）。
 * 注意：需在 app.module.ts imports 中加入 CoursesModule（由编排方接线）。
 */
@Module({
  imports: [NotificationsModule],
  controllers: [CoursesController],
  providers: [CoursesService, TermArchiveService],
  exports: [CoursesService, TermArchiveService],
})
export class CoursesModule {}
