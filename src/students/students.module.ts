import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

/**
 * 学员查询模块（§6.12，D5 新增）。
 * 注意：需在 app.module.ts imports 中加入 StudentsModule（由编排方接线）。
 */
@Module({
  controllers: [StudentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
