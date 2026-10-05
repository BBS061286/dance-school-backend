import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { Gender, Relationship } from '@prisma/client';

/** 家长自助添加孩子 */
export class ParentCreateStudentDto {
  @IsString()
  name: string;

  @IsDateString()
  birthdate: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsString()
  medicalNotes?: string;

  @IsOptional()
  @IsEnum(Relationship)
  relationship?: Relationship;
}
