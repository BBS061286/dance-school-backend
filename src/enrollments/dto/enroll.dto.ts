import { IsUUID } from 'class-validator';

/** 报名请求（设计文档 §4.6） */
export class CreateEnrollmentDto {
  @IsUUID('4', { message: 'student_id 必须是合法的 UUID' })
  student_id: string;

  @IsUUID('4', { message: 'class_session_id 必须是合法的 UUID' })
  class_session_id: string;
}
