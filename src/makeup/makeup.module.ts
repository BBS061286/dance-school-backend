import { Module } from '@nestjs/common';
import { MakeupController } from './makeup.controller';
import { MakeupService } from './makeup.service';

/**
 * 补课模块：补课资格（MakeupEligibility）与补课预约（MakeupBooking，§6.3/6.4）。
 * 注意：需由父级在 app.module.ts 中装配（MakeupModule）。
 */
@Module({
  controllers: [MakeupController],
  providers: [MakeupService],
  exports: [MakeupService],
})
export class MakeupModule {}
