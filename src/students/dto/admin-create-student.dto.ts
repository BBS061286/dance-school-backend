import { IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Gender } from '@prisma/client';

class ParentInputDto {
  @IsString()
  name: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class AdminCreateStudentDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  birthdate?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsIn(['child', 'adult'])
  type: 'child' | 'adult';

  @IsOptional()
  @IsUUID('4')
  parentId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ParentInputDto)
  parent?: ParentInputDto;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
