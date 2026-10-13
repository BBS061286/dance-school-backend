import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { TranslateService } from './translate.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, TranslateService],
  exports: [SettingsService, TranslateService],
})
export class SettingsModule {}
