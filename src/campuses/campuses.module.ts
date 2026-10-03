import { Module } from '@nestjs/common';
import { CampusesController } from './campuses.controller';
import { CampusesService } from './campuses.service';

/**
 * 校区管理模块（ADMIN）。
 * 注意：需在 app.module.ts imports 中加入 CampusesModule。
 */
@Module({
  controllers: [CampusesController],
  providers: [CampusesService],
  exports: [CampusesService],
})
export class CampusesModule {}
