import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/** 教师端：更新个人资料（§6.17/6.20），头像复用 User.avatar_url */
export class UpdateInstructorProfileDto {
  @IsString({ message: 'bio 必须是字符串' })
  @IsNotEmpty({ message: 'bio 不能为空' })
  bio: string;

  @IsString({ message: 'avatar_url 必须是字符串' })
  @IsNotEmpty({ message: 'avatar_url 不能为空' })
  avatar_url: string;
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
