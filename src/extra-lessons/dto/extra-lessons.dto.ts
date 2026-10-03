import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExtraLessonAudience, ExtraLessonSlotStatus, ExtraLessonType } from '@prisma/client';

/** 加课申请单下的一个具体时段 */
export class ExtraLessonSlotInput {
  /** 日期（YYYY-MM-DD） */
  @IsString()
  date: string;

  /** 时间段，如 "17:00-18:00" */
  @IsString()
  time: string;
}

/** 学员/家长发起加课申请 */
export class CreateExtraLessonRequestDto {
  /** ONE_ON_ONE=1对1 / TEMP_GROUP=临时 group 加课 */
  @IsEnum(ExtraLessonType)
  type: ExtraLessonType;

  /** 针对哪个学员/孩子（必填） */
  @IsUUID('4')
  student_id: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExtraLessonSlotInput)
  slots: ExtraLessonSlotInput[];
}

/** 管理员发起加课邀请：student_id 必填，instructor_id 可选指定任教教师 */
export class AdminCreateExtraLessonRequestDto extends CreateExtraLessonRequestDto {
  @IsOptional()
  @IsUUID('4')
  instructor_id?: string;
}

/** 管理员建议新时间（仅 ONE_ON_ONE） */
export class ProposeAltDto {
  @IsString()
  alt_date: string;

  @IsString()
  alt_time: string;

  @IsOptional()
  @IsString()
  admin_note?: string;
}

/** 直接改期（仅 TEMP_GROUP）：单方面改期 → CONFIRMED */
export class RescheduleDto {
  @IsString()
  new_date: string;

  @IsString()
  new_time: string;
}

/** 写加课评价 */
export class ReviewSlotDto {
  @IsString()
  content: string;
}

/** 管理端加课申请查询 */
export class AdminExtraLessonRequestsQuery {
  @IsOptional()
  @IsEnum(ExtraLessonAudience)
  audience?: ExtraLessonAudience;
}

/** 私课查询（管理端） */
export class AdminExtraLessonSlotsQuery {
  @IsOptional()
  @IsEnum(ExtraLessonType)
  type?: ExtraLessonType;

  @IsOptional()
  @IsEnum(ExtraLessonSlotStatus)
  status?: ExtraLessonSlotStatus;

  @IsOptional()
  @IsEnum(ExtraLessonAudience)
  audience?: ExtraLessonAudience;
}
