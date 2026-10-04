import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

/** 取消 / 取消并顺延课次 */
export class CancelOccurrenceDto {
  /** 取消原因 */
  @IsString()
  cancel_reason: string;

  /** 是否顺延：true=取消并顺延，false=直接取消（仅 cancel-and-postpone 使用） */
  @IsOptional()
  @IsBoolean()
  postpone?: boolean;

  /** 手动指定延期日期（YYYY-MM-DD）：postpone=true 时可选，不填则自动顺延到下一个同星期日 */
  @IsOptional()
  @IsDateString({}, { message: 'postpone_date 格式不正确（YYYY-MM-DD）' })
  postpone_date?: string;
}

/** 学员 / 管理员打卡 */
export class CheckInDto {
  /** 报名 id */
  @IsUUID('4')
  enrollment_id: string;

  /** 打卡状态：PRESENT=已打卡（默认），ABSENT=缺席 */
  @IsOptional()
  @IsIn(['PRESENT', 'ABSENT'], { message: 'status 必须是 PRESENT 或 ABSENT' })
  status?: 'PRESENT' | 'ABSENT';

  /** 手写签名（图片 URL 或 dataURL），可选；存入 AttendanceRecord.signatureUrl */
  @IsOptional()
  @IsString()
  signature?: string;
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

/** 管理员替老师打卡 */
export class AdminInstructorCheckInDto {
  /** 教师 id（Instructor.id） */
  @IsUUID('4')
  instructor_id: string;

  /** 班级 id（与 extra_lesson_slot_id 二选一，可都不填） */
  @IsOptional()
  @IsUUID('4')
  class_session_id?: string;

  /** 课次 id（可选，若能匹配则关联） */
  @IsOptional()
  @IsUUID('4')
  session_occurrence_id?: string;

  /** 上课日期（YYYY-MM-DD） */
  @IsString()
  date: string;

  /** 上课时间段，如 "17:00-18:00" */
  @IsString()
  time: string;

  /** 校区 */
  @IsString()
  campus: string;
}
