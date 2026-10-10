import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/** 教师端：更新个人资料（§6.17/6.20），头像复用 User.avatar_url；简介与头像均为选填 */
export class UpdateInstructorProfileDto {
  @IsOptional()
  @IsString({ message: 'bio 必须是字符串' })
  bio?: string;

  @IsOptional()
  @IsString({ message: 'avatar_url 必须是字符串' })
  avatar_url?: string;
}

/** 教师点名：{ enrollment_id }（§6.20） */
export class InstructorCheckInDto {
  @IsUUID('4', { message: 'enrollment_id 必须是合法的 UUID' })
  enrollment_id: string;

  /** 打卡状态：PRESENT=已打卡（默认），ABSENT=缺席 */
  @IsOptional()
  @IsIn(['PRESENT', 'ABSENT'], { message: 'status 必须是 PRESENT 或 ABSENT' })
  status?: 'PRESENT' | 'ABSENT';
}

/** 教师一键点名：{ studentIds: string[] }（§6.20） */
export class InstructorBatchCheckInDto {
  @IsArray({ message: 'studentIds 必须是数组' })
  @ArrayMaxSize(100, { message: '一次最多点名 100 人' })
  @IsUUID('4', { each: true, message: 'studentIds 须为合法 UUID' })
  studentIds: string[];
}
