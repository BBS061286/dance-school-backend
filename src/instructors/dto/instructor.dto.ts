import { Transform } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/** 管理端编辑教师资料（§6.25） */
export class UpdateInstructorDto {
  @IsOptional()
  @IsString({ message: 'bio 必须是字符串' })
  bio?: string;

  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',').map((s: string) => s.trim()).filter(Boolean)
        : value,
  )
  @IsArray({ message: 'specialties 必须是数组' })
  @IsString({ each: true, message: 'specialties 元素必须是字符串' })
  specialties?: string[];

  @IsOptional()
  @IsUUID('4', { message: 'default_campus_id 必须是合法的 UUID' })
  default_campus_id?: string;
}

/** 分配/重新分配教师：{ instructor_id }（§6.25） */
export class AssignInstructorDto {
  @IsUUID('4', { message: 'instructor_id 必须是合法的 UUID' })
  instructor_id: string;
}
