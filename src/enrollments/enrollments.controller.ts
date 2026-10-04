import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../common/types';
import { CancelEnrollmentDto } from './dto/cancel.dto';
import { CreateEnrollmentDto } from './dto/enroll.dto';
import { EnrollmentsService } from './enrollments.service';

/** 报名模块路由（全局前缀 /api/v1 已在 main.ts 设置，此处方法上写全路径） */
@Controller()
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  /** 报名：家长 / 成人学员为自己关联的学生报名，管理员可代报 */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT, UserRole.ADMIN)
  @Post('enrollments')
  enroll(
    @Request() req: { user: RequestUser },
    @Body() dto: CreateEnrollmentDto,
  ) {
    return this.enrollments.enroll(req.user, dto);
  }

  /** 我的报名列表（登录即可） */
  @Get('me/enrollments')
  myEnrollments(@Request() req: { user: RequestUser }) {
    return this.enrollments.myEnrollments(req.user.id);
  }

  /** 我的报名详情（含上课进度） */
  @Get('me/enrollments/:id/progress')
  enrollmentProgress(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.enrollments.enrollmentProgress(req.user.id, id);
  }

  /** 取消报名（登录即可；归属在 service 校验；body 可选） */
  @Patch('enrollments/:id/cancel')
  cancel(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto?: CancelEnrollmentDto,
  ) {
    return this.enrollments.cancelEnrollment(req.user, id, dto?.reason);
  }

  /** 管理员手动确认待支付报名 */
  @Roles(UserRole.ADMIN)
  @Post('admin/enrollments/:id/confirm')
  confirm(@Param('id') id: string) {
    return this.enrollments.confirmEnrollment(id);
  }

  /** 班级花名册（管理员 / 教师） */
  @Roles(UserRole.ADMIN, UserRole.INSTRUCTOR)
  @Get('admin/sessions/:id/roster')
  roster(@Param('id') id: string) {
    return this.enrollments.roster(id);
  }

  /** 同班学员（仅名字；登录即可，本人在该班有有效报名才可见） */
  @Get('me/sessions/:id/classmates')
  classmates(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.enrollments.classmates(req.user, id);
  }

  /** 候补队列（管理员） */
  @Roles(UserRole.ADMIN)
  @Get('admin/sessions/:id/waitlist')
  waitlist(@Param('id') id: string) {
    return this.enrollments.waitlist(id);
  }

  /** 管理员手动转正候补 */
  @Roles(UserRole.ADMIN)
  @Post('admin/enrollments/:id/promote')
  promote(@Param('id') id: string) {
    return this.enrollments.promoteEnrollment(id);
  }

  /** 运行候补自动转正（管理员） */
  @Roles(UserRole.ADMIN)
  @Post('admin/sessions/:id/run-waitlist-promotion')
  runWaitlistPromotion(@Param('id') id: string) {
    return this.enrollments.runWaitlistPromotion(id);
  }
}
