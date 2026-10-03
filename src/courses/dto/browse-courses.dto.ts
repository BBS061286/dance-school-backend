import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CourseAudience, CourseFormat } from '@prisma/client';

/** 公开课程列表查询条件：GET /courses */
export class BrowseCoursesQuery {
  /** 标题模糊搜索 */
  @IsOptional()
  @IsString()
  q?: string;

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
  campus_id?: string;
}
