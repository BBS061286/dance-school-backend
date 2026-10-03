import { IsOptional, IsString } from 'class-validator';

/** 取消报名请求 */
export class CancelEnrollmentDto {
  @IsOptional()
  @IsString({ message: 'reason 必须是字符串' })
  reason?: string;
}
