import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { Gender } from '@prisma/client';

/** 家长更新孩子信息 */
export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;
}
