import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { ExtraLessonSlotStatus, UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../common/types';
import { ExtraLessonsService } from './extra-lessons.service';
import {
  AdminCreateExtraLessonRequestDto,
  AdminExtraLessonRequestsQuery,
  AdminExtraLessonSlotsQuery,
  CreateExtraLessonRequestDto,
  ExtraLessonAttendanceDto,
  ProposeAltDto,
  RescheduleDto,
  ReviewSlotDto,
} from './dto/extra-lessons.dto';

/**
 * 1对1 / 临时 group 加课路由（设计文档 §6.8/6.9/6.11/6.15/6.17）。
 * 全局前缀 /api/v1 已在 main.ts 设置。
 */
@Controller()
export class ExtraLessonsController {
  constructor(private readonly lessons: ExtraLessonsService) {}

  /** 学员/家长发起加课申请（initiatedBy=STUDENT） */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT)
  @Post('extra-lesson-requests')
  createRequest(
    @Request() req: { user: RequestUser },
    @Body() dto: CreateExtraLessonRequestDto,
  ) {
    return this.lessons.createRequest(req.user, dto);
  }

  /** 管理员发起加课邀请（initiatedBy=ADMIN，student_id 必填） */
  @Roles(UserRole.ADMIN)
  @Post('admin/extra-lesson-requests')
  adminCreateRequest(
    @Request() req: { user: RequestUser },
    @Body() dto: AdminCreateExtraLessonRequestDto,
  ) {
    return this.lessons.adminCreateRequest(req.user.id, dto);
  }

  /** 我的加课申请 */
  @Get('me/extra-lesson-requests')
  myRequests(@Request() req: { user: RequestUser }) {
    return this.lessons.myRequests(req.user);
  }

  /** 管理端加课申请列表：?audience=YOUTH|ADULT&status=时段状态 */
  @Roles(UserRole.ADMIN)
  @Get('admin/extra-lesson-requests')
  adminListRequests(
    @Query() query: AdminExtraLessonRequestsQuery & { status?: ExtraLessonSlotStatus },
  ) {
    return this.lessons.adminListRequests(query);
  }

  /** 私课查询（管理端）：?type=&status=&audience= */
  @Roles(UserRole.ADMIN)
  @Get('admin/extra-lesson-slots')
  adminListSlots(@Query() query: AdminExtraLessonSlotsQuery) {
    return this.lessons.adminListSlots(query);
  }

  /** 直接批准该时段 → CONFIRMED（ADMIN） */
  @Roles(UserRole.ADMIN)
  /** 更换临约私教的老师 */
  @Roles(UserRole.ADMIN)
  @Patch('admin/extra-lesson-requests/:id/instructor')
  reassignInstructor(
    @Param('id') id: string,
    @Body() dto: { instructor_id: string },
  ) {
    return this.lessons.reassignInstructor(id, dto.instructor_id);
  }

  /** 通过加课申请 → APPROVED（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/extra-lesson-requests/:id/approve')
  approveRequest(@Param('id') id: string) {
    return this.lessons.approveRequest(id);
  }

  /** 拒绝加课申请 → REJECTED（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/extra-lesson-requests/:id/reject')
  rejectRequest(@Param('id') id: string, @Body() dto: { reason: string }) {
    return this.lessons.rejectRequest(id, dto.reason);
  }

  /** 更新加课申请的校区（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Patch('admin/extra-lesson-requests/:id/campus')
  updateRequestCampus(
    @Param('id') id: string,
    @Body() dto: { campus_id: string | null; location?: string | null },
  ) {
    return this.lessons.updateRequestCampus(id, dto.campus_id, dto.location ?? null);
  }

  /** 管理员直接排课（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/extra-lesson-requests/:id/slots')
  adminCreateSlots(
    @Param('id') id: string,
    @Body() dto: { slots: Array<{ date: string; time: string }> },
  ) {
    return this.lessons.adminCreateSlots(id, dto.slots);
  }

  @Post('admin/extra-lesson-slots/:id/approve')
  approveSlot(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.lessons.approveSlot(req.user.id, id);
  }

  /** 建议新时间（仅 ONE_ON_ONE）→ ADMIN_PROPOSED_ALT（ADMIN / 任教老师） */
  @Roles(UserRole.ADMIN, UserRole.INSTRUCTOR)
  @Post('admin/extra-lesson-slots/:id/propose-alt')
  proposeAlt(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: ProposeAltDto,
  ) {
    return this.lessons.proposeAlt(req.user, id, dto);
  }

  /** 直接改期（仅 TEMP_GROUP）→ CONFIRMED（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/extra-lesson-slots/:id/reschedule')
  reschedule(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: RescheduleDto,
  ) {
    return this.lessons.reschedule(req.user.id, id, dto);
  }

  /** 管理员直接取消该时段 → DECLINED */
  @Roles(UserRole.ADMIN)
  @Post('admin/extra-lesson-slots/:id/cancel')
  cancelSlot(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.lessons.cancelSlot(req.user.id, id);
  }

  /** 学员/家长确认时段 → CONFIRMED */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT)
  @Post('extra-lesson-slots/:id/accept')
  acceptSlot(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.lessons.acceptSlot(req.user, id);
  }

  /** 学员/家长拒绝时段 → DECLINED */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT)
  @Post('extra-lesson-slots/:id/decline')
  declineSlot(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.lessons.declineSlot(req.user, id);
  }

  /** 给加课写评价（ADMIN）：{ content } */
  @Roles(UserRole.ADMIN)
  @Post('admin/extra-lesson-slots/:id/review')
  reviewSlot(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: ReviewSlotDto,
  ) {
    return this.lessons.reviewSlot(req.user.id, id, dto);
  }

  // ------------------------------------------------------------ 老师端学员出勤

  /** 老师记私教课学员出勤（upsert）：{ studentId, status } */
  @Roles(UserRole.INSTRUCTOR)
  @Post('me/instructor/extra-lessons/slots/:slotId/attendance')
  markSlotAttendance(
    @Request() req: { user: RequestUser },
    @Param('slotId') slotId: string,
    @Body() dto: ExtraLessonAttendanceDto,
  ) {
    return this.lessons.markSlotAttendance(req.user.id, slotId, dto);
  }

  /** 老师查看某加课时段的学员出勤列表 */
  @Roles(UserRole.INSTRUCTOR)
  @Get('me/instructor/extra-lessons/slots/:slotId/attendance')
  slotAttendance(
    @Request() req: { user: RequestUser },
    @Param('slotId') slotId: string,
  ) {
    return this.lessons.slotAttendance(req.user.id, slotId);
  }
}
