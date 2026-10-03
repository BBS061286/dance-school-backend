import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/** 新建班次：POST /admin/sessions */
export class CreateSessionDto {
  @IsUUID('4', { message: 'course_id 必须是合法的 UUID' })
  course_id: string;

  @IsUUID('4', { message: 'campus_id 必须是合法的 UUID' })
  campus_id: string;

  @IsUUID('4', { message: 'instructor_id 必须是合法的 UUID' })
  instructor_id: string;

  @IsOptional()
  @IsString()
  room?: string;

  @IsDateString({}, { message: 'start_time 必须是 ISO 时间' })
  start_time: string;

  @IsDateString({}, { message: 'end_time 必须是 ISO 时间' })
  end_time: string;

  /** 名额，不传则继承课程名额 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  capacity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  waitlist_capacity?: number;
}
