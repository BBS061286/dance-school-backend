import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/**
 * 文件签署模块（§6.24/6.26，D5 新增）。
 * 注意：需在 app.module.ts imports 中加入 DocumentsModule（由编排方接线）。
 */
@Module({
  imports: [NotificationsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
