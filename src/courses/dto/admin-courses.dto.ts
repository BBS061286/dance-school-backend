import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CourseAudience, CourseFormat, CourseStatus } from '@prisma/client';

/** 管理端课程列表查询：GET /admin/courses */
export class AdminCoursesQuery {
  /** 标题模糊搜索 */
  @IsOptional()
  @IsString()
  q?: string;

  /** 学期 id */
  @IsOptional()
  @IsString()
  term?: string;

  /** 只返回该老师有任教班次的课程 */
  @IsOptional()
  @IsString()
  instructor_id?: string;

  /** 状态：DRAFT / PUBLISHED / ARCHIVED */
  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;

  /** 课程形式：GROUP / PRIVATE / MASTER */
  @IsOptional()
  @IsEnum(CourseFormat)
  format?: CourseFormat;

  /** 面向学员：YOUTH / ADULT / ALL */
  @IsOptional()
  @IsEnum(CourseAudience)
  audience?: CourseAudience;

  /** 校区 id */
  @IsOptional()
  @IsString()
  campus?: string;
}
