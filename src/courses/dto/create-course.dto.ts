import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  CourseAudience,
  CourseFormat,
  PricingType,
  SkillLevel,
} from '@prisma/client';

/** 管理端新增课程请求体（§6.27） */
export class CreateCourseDto {
  @IsEnum(CourseFormat, { message: 'format 必须是 GROUP/PRIVATE/MASTER' })
  format: CourseFormat;

  @IsEnum(CourseAudience, { message: 'audience 必须是 YOUTH/ADULT/ALL' })
  audience: CourseAudience;

  @IsString({ message: 'title 必须是字符串' })
  title: string;

  @IsOptional()
  @IsString({ message: 'description 必须是字符串' })
  description?: string;

  @IsOptional()
  @IsEnum(SkillLevel)
  skill_level?: SkillLevel;

  @IsInt({ message: 'min_age 必须是整数' })
  @Min(0, { message: 'min_age 不能为负' })
  min_age: number;

  @IsOptional()
  @IsInt({ message: 'max_age 必须是整数' })
  max_age?: number;

  /** 仅 audience=ALL 时可选填的成人端年龄区间 */
  @IsOptional()
  @IsInt({ message: 'alt_min_age 必须是整数' })
  alt_min_age?: number;

  @IsOptional()
  @IsInt({ message: 'alt_max_age 必须是整数' })
  alt_max_age?: number;

  @IsUUID('4', { message: 'campus_id 必须是合法的 UUID' })
  campus_id: string;

  @IsOptional()
  @IsString({ message: 'address 必须是字符串' })
  address?: string;

  @IsOptional()
  @IsArray({ message: 'weekdays 必须是数组' })
  @IsInt({ each: true, message: 'weekdays 元素必须是整数' })
  @Min(0, { each: true, message: 'weekdays 取值 0-6' })
  @Max(6, { each: true, message: 'weekdays 取值 0-6' })
  weekdays?: number[];

  @IsOptional()
  @IsString({ message: 'time_range 必须是字符串' })
  time_range?: string;

  @IsDateString({}, { message: 'start_date 必须是日期字符串' })
  start_date: string;

  @IsOptional()
  @IsDateString({}, { message: 'end_date 必须是日期字符串' })
  end_date?: string;

  @IsEnum(PricingType, { message: 'pricing_type 必须是 PACKAGE/PER_SESSION/TERM' })
  pricing_type: PricingType;

  @IsOptional()
  @IsInt({ message: 'total_sessions 必须是整数' })
  @Min(1, { message: 'total_sessions 至少为 1' })
  total_sessions?: number;

  @IsOptional()
  @IsInt({ message: 'package_size 必须是整数' })
  @Min(1, { message: 'package_size 至少为 1' })
  package_size?: number;

  @IsInt({ message: 'capacity 必须是整数' })
  @Min(1, { message: 'capacity 至少为 1' })
  capacity: number;

  @IsInt({ message: 'price_cents 必须是整数' })
  @Min(0, { message: 'price_cents 不能为负' })
  price_cents: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean({ message: 'requires_payment 必须是布尔值' })
  requires_payment?: boolean;

  @IsOptional()
  @IsUUID('4', { message: 'instructor_id 必须是合法的 UUID' })
  instructor_id?: string;
}
