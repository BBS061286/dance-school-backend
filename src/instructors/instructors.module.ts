import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { InstructorsController } from './instructors.controller';
import { InstructorsService } from './instructors.service';

/**
 * 教师管理模块（§6.25，D5 新增）。
 * 注意：需在 app.module.ts imports 中加入 InstructorsModule（由编排方接线）。
 */
@Module({
  imports: [NotificationsModule],
  controllers: [InstructorsController],
  providers: [InstructorsService],
  exports: [InstructorsService],
})
export class InstructorsModule {}
