import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

// 自助注册只允许家长与成人学员（设计文档 §4.2）；管理员/教师由管理端创建
const SelfRegisterRoles = {
  PARENT: 'PARENT',
  ADULT_STUDENT: 'ADULT_STUDENT',
} as const;

export class RegisterDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  password: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsEnum(SelfRegisterRoles, { message: 'role 只能是 PARENT 或 ADULT_STUDENT' })
  role: 'PARENT' | 'ADULT_STUDENT';
}
