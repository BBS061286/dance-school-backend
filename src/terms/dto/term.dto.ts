import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** 新建学期（管理端） */
export class CreateTermDto {
  @IsString({ message: '学期名称必须是字符串' })
  @MaxLength(50, { message: '学期名称过长' })
  name: string;

  @IsDateString({}, { message: '开始日期格式不正确（YYYY-MM-DD）' })
  startDate: string;

  @IsDateString({}, { message: '结束日期格式不正确（YYYY-MM-DD）' })
  endDate: string;
}

/** 编辑学期（管理端）：全部可选 */
export class UpdateTermDto {
  @IsOptional()
  @IsString({ message: '学期名称必须是字符串' })
  @MaxLength(50, { message: '学期名称过长' })
  name?: string;

  @IsOptional()
  @IsDateString({}, { message: '开始日期格式不正确（YYYY-MM-DD）' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: '结束日期格式不正确（YYYY-MM-DD）' })
  endDate?: string;

  @IsOptional()
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive?: boolean;

  @IsOptional()
  @IsInt({ message: 'makeupQuota 必须是整数' })
  @Min(0, { message: 'makeupQuota 不能为负数' })
  makeupQuota?: number;
}
