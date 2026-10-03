import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../common/types';
import { CreateMakeupBookingDto, CreateMakeupEligibilityDto } from './dto/makeup.dto';
import { MakeupService } from './makeup.service';

/** 补课模块路由（设计文档 §6.3/6.4/6.7）。全局前缀 /api/v1 已在 main.ts 设置。 */
@Controller()
export class MakeupController {
  constructor(private readonly makeup: MakeupService) {}

  /** 查看某班级的补课资格列表（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Get('admin/class-sessions/:id/makeup-eligibility')
  listEligibility(@Param('id') id: string) {
    return this.makeup.listEligibility(id);
  }

  /** 为班级配置补课资格（ADMIN）：{ eligible_class_session_id } */
  @Roles(UserRole.ADMIN)
  @Post('admin/class-sessions/:id/makeup-eligibility')
  createEligibility(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: CreateMakeupEligibilityDto,
  ) {
    return this.makeup.createEligibility(req.user.id, id, dto);
  }

  /** 学员查看某次报名的可选补课场次 */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT, UserRole.ADMIN)
  @Get('me/enrollments/:id/makeup-options')
  makeupOptions(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.makeup.makeupOptions(req.user, id);
  }

  /** 预约补课：{ enrollment_id, missed_occurrence_id?, makeup_occurrence_id } */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT, UserRole.ADMIN)
  @Post('makeup-bookings')
  createBooking(
    @Request() req: { user: RequestUser },
    @Body() dto: CreateMakeupBookingDto,
  ) {
    return this.makeup.createBooking(req.user, dto);
  }
}
