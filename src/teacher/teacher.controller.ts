import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { LocalFileInterceptor, UploadedLocalFile } from '../common/local-upload';
import { RequestUser } from '../common/types';
import {
  CreateCourseReviewDto,
  CreateStudentReviewDto,
} from '../reviews/dto/review.dto';
import {
  InstructorCheckInDto,
  UpdateInstructorProfileDto,
} from './dto/teacher.dto';
import { TeacherService } from './teacher.service';

/**
 * 教师端路由（§6.19/6.20/6.21）。全局前缀 /api/v1 在 main.ts 设置。
 * 教师业务以 @Roles(INSTRUCTOR) 为主；照片上传面向家长/本人。
 */
@Controller()
export class TeacherController {
  constructor(private readonly teacher: TeacherService) {}

  @Roles(UserRole.INSTRUCTOR)
  @Get('me/instructor/profile')
  profile(@Request() req: { user: RequestUser }) {
    return this.teacher.profile(req.user.id);
  }

  @Roles(UserRole.INSTRUCTOR)
  @Patch('me/instructor/profile')
  updateProfile(
    @Request() req: { user: RequestUser },
    @Body() dto: UpdateInstructorProfileDto,
  ) {
    return this.teacher.updateProfile(req.user.id, dto);
  }

  @Roles(UserRole.INSTRUCTOR)
  @Get('me/instructor/classes')
  classes(@Request() req: { user: RequestUser }) {
    return this.teacher.classes(req.user.id);
  }

  @Roles(UserRole.INSTRUCTOR)
  @Get('me/instructor/extra-lessons')
  extraLessons(@Request() req: { user: RequestUser }) {
    return this.teacher.extraLessons(req.user.id);
  }

  @Roles(UserRole.INSTRUCTOR)
  @Post('me/instructor/occurrences/:id/check-in')
  checkIn(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: InstructorCheckInDto,
  ) {
    return this.teacher.checkIn(req.user.id, id, dto.enrollment_id, dto.status);
  }

  @Roles(UserRole.INSTRUCTOR)
  @Get('me/instructor/sessions/:id/attendance-summary')
  attendanceSummary(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.teacher.attendanceSummary(req.user.id, id);
  }

  @Roles(UserRole.INSTRUCTOR)
  @Get('me/instructor/occurrences/:id/attendance')
  attendance(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.teacher.attendance(req.user.id, id);
  }

  @Roles(UserRole.INSTRUCTOR)
  @Get('me/instructor/notifications')
  notifications(@Request() req: { user: RequestUser }) {
    return this.teacher.notifications(req.user.id);
  }

  @Roles(UserRole.INSTRUCTOR)
  @Post('me/instructor/courses/:id/reviews')
  createCourseReview(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: CreateCourseReviewDto,
  ) {
    return this.teacher.createCourseReview(req.user, id, dto);
  }

  @Roles(UserRole.INSTRUCTOR)
  @Post('me/instructor/students/:id/reviews')
  createStudentReview(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: CreateStudentReviewDto,
  ) {
    return this.teacher.createStudentReview(req.user, id, dto);
  }

  /** 家长为孩子上传照片：POST /me/students/:id/photo（§6.21） */
  @Roles(UserRole.PARENT, UserRole.ADMIN)
  @Post('me/students/:id/photo')
  @UseInterceptors(LocalFileInterceptor())
  uploadStudentPhoto(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @UploadedFile() file?: UploadedLocalFile,
  ) {
    if (!file) throw new BadRequestException('请上传图片文件');
    return this.teacher.uploadStudentPhoto(req.user, id, file.filename);
  }

  /** 上传自己头像：POST /me/avatar（§6.21） */
  @Post('me/avatar')
  @UseInterceptors(LocalFileInterceptor())
  uploadAvatar(
    @Request() req: { user: RequestUser },
    @UploadedFile() file?: UploadedLocalFile,
  ) {
    if (!file) throw new BadRequestException('请上传图片文件');
    return this.teacher.uploadAvatar(req.user.id, file.filename);
  }
}
