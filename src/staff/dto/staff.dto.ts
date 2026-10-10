import { IsEmail, IsOptional, IsString } from 'class-validator';

/** 创建管理员账号（员工管理） */
export class CreateStaffDto {
  @IsString({ message: '姓名必须是字符串' })
  name: string;

  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsOptional()
  @IsString({ message: '电话必须是字符串' })
  phone?: string;
}
