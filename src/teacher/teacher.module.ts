import { Module } from '@nestjs/common';
import { ReviewsModule } from '../reviews/reviews.module';
import { TeacherController } from './teacher.controller';
import { TeacherService } from './teacher.service';

/**
 * 教师端模块（§6.19–6.21，D5 新增）。
 * 注意：需在 app.module.ts imports 中加入 TeacherModule（由编排方接线）。
 */
@Module({
  imports: [ReviewsModule],
  controllers: [TeacherController],
  providers: [TeacherService],
  exports: [TeacherService],
})
export class TeacherModule {}
