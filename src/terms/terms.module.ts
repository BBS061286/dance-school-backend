import { Module } from '@nestjs/common';
import { TermsController } from './terms.controller';
import { TermsService } from './terms.service';

/**
 * 学期管理模块（ADMIN）。
 * 注意：需在 app.module.ts imports 中加入 TermsModule。
 */
@Module({
  controllers: [TermsController],
  providers: [TermsService],
  exports: [TermsService],
})
export class TermsModule {}
