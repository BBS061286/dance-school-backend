import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

/**
 * 打卡模块：课次生成 / 取消与顺延 / 学员打卡 / 教师打卡（§6.1/6.2/6.18）。
 * 注意：需由父级在 app.module.ts 中装配（AttendanceModule）。
 */
@Module({
  imports: [NotificationsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
