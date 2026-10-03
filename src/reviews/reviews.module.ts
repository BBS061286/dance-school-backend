import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

/**
 * 评价模块（§6.13–6.16，D5 新增）。
 * ReviewsService 导出供教师端复用（教师只能给自己课的学生写评价）。
 * 注意：需在 app.module.ts imports 中加入 ReviewsModule（由编排方接线）。
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
