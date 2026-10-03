import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../common/types';
import { AttendanceService } from './attendance.service';
import {
  CancelOccurrenceDto,
  CheckInDto,
  InstructorCheckInDto,
} from './dto/attendance.dto';

/**
 * 打卡 / 课次路由（设计文档 §6.1/6.2/6.7/6.18/6.20）。
 * 全局前缀 /api/v1 已在 main.ts 设置，此处用空前缀 + 全路径。
 */
@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /** 某班级的全部课次（登录用户可见） */
  @Get('courses/:id/sessions/:sessionId/occurrences')
  listOccurrences(
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.attendance.listOccurrences(id, sessionId);
  }

  /** 取消并顺延（ADMIN）：{ cancel_reason, postpone } */
  @Roles(UserRole.ADMIN)
  @Post('admin/occurrences/:id/cancel-and-postpone')
  cancelAndPostpone(
    @Param('id') id: string,
    @Body() dto: CancelOccurrenceDto,
  ) {
    return this.attendance.cancelAndPostpone(id, dto);
  }

  /** 直接取消不顺延（ADMIN）：{ cancel_reason } */
  @Roles(UserRole.ADMIN)
  @Post('admin/occurrences/:id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelOccurrenceDto) {
    return this.attendance.cancel(id, dto);
  }

  /** 学员自助打卡（家长 / 成人学员）：{ enrollment_id } */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT)
  @Post('occurrences/:id/check-in')
  selfCheckIn(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: CheckInDto,
  ) {
    return this.attendance.selfCheckIn(req.user, id, dto);
  }

  /** 管理员代打卡（ADMIN）：{ enrollment_id } */
  @Roles(UserRole.ADMIN)
  @Post('admin/occurrences/:id/check-in')
  adminCheckIn(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: CheckInDto,
  ) {
    return this.attendance.adminCheckIn(req.user, id, dto);
  }

  /** 管理员确认待确认打卡（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/attendance/:id/confirm')
  confirmAttendance(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.attendance.confirmAttendance(req.user.id, id);
  }

  /** 教师打卡（INSTRUCTOR）：常规班级与加课二选一 */
  @Roles(UserRole.INSTRUCTOR)
  @Post('me/instructor/checkins')
  instructorCheckIn(
    @Request() req: { user: RequestUser },
    @Body() dto: InstructorCheckInDto,
  ) {
    return this.attendance.instructorCheckIn(req.user, dto);
  }

  /** 我的教师打卡记录（INSTRUCTOR） */
  @Roles(UserRole.INSTRUCTOR)
  @Get('me/instructor/checkins')
  myInstructorCheckins(@Request() req: { user: RequestUser }) {
    return this.attendance.myInstructorCheckins(req.user.id);
  }
}
