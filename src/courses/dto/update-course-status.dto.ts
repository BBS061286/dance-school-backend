import { IsEnum } from 'class-validator';
import { CourseStatus } from '@prisma/client';

/** 课程状态变更：PATCH /admin/courses/:id/status */
export class UpdateCourseStatusDto {
  @IsEnum(CourseStatus, { message: 'status 必须是 DRAFT/PUBLISHED/ARCHIVED' })
  status: CourseStatus;
}
