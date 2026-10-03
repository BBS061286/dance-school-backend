import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

/** 取消 / 取消并顺延课次 */
export class CancelOccurrenceDto {
  /** 取消原因 */
  @IsString()
  cancel_reason: string;

  /** 是否顺延：true=取消并顺延，false=直接取消（仅 cancel-and-postpone 使用） */
  @IsOptional()
  @IsBoolean()
  postpone?: boolean;
}

/** 学员 / 管理员打卡 */
export class CheckInDto {
  /** 报名 id */
  @IsUUID('4')
  enrollment_id: string;
}

/** 教师打卡：class_session_id 与 extra_lesson_slot_id 二选一 */
export class InstructorCheckInDto {
  @IsOptional()
  @IsUUID('4')
  class_session_id?: string;

  @IsOptional()
  @IsUUID('4')
  extra_lesson_slot_id?: string;

  /** 上课日期（YYYY-MM-DD） */
  @IsString()
  date: string;

  /** 上课时间段，如 "17:00-18:00" */
  @IsString()
  time: string;

  /** 校区（冗余存储，便于查询展示） */
  @IsString()
  campus: string;
}
