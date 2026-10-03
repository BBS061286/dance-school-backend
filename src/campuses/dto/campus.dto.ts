import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** 新建校区（管理端） */
export class CreateCampusDto {
  @IsString({ message: '校区名称必须是字符串' })
  @MaxLength(100, { message: '校区名称过长' })
  name: string;

  @IsOptional()
  @IsString({ message: '地址必须是字符串' })
  @MaxLength(255, { message: '地址过长' })
  address?: string;

  @IsOptional()
  @IsString({ message: '城市必须是字符串' })
  @MaxLength(100, { message: '城市过长' })
  city?: string;

  @IsOptional()
  @IsString({ message: '电话必须是字符串' })
  @MaxLength(50, { message: '电话过长' })
  phone?: string;

  /** IANA 时区名，如 America/New_York（v2 R7） */
  @IsOptional()
  @IsString({ message: '时区必须是 IANA 时区名' })
  @MaxLength(64, { message: '时区过长' })
  timezone?: string;
}

/** 编辑校区（管理端）：全部可选，含启用/停用开关 */
export class UpdateCampusDto {
  @IsOptional()
  @IsString({ message: '校区名称必须是字符串' })
  @MaxLength(100, { message: '校区名称过长' })
  name?: string;

  @IsOptional()
  @IsString({ message: '地址必须是字符串' })
  @MaxLength(255, { message: '地址过长' })
  address?: string;

  @IsOptional()
  @IsString({ message: '城市必须是字符串' })
  @MaxLength(100, { message: '城市过长' })
  city?: string;

  @IsOptional()
  @IsString({ message: '电话必须是字符串' })
  @MaxLength(50, { message: '电话过长' })
  phone?: string;

  @IsOptional()
  @IsString({ message: '时区必须是 IANA 时区名' })
  @MaxLength(64, { message: '时区过长' })
  timezone?: string;

  @IsOptional()
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive?: boolean;
}
