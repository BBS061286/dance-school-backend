import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { DocumentAudience } from '@prisma/client';

/** 上传文件：{ title, requires_signature, audience } + file（§6.24） */
export class CreateDocumentDto {
  @IsString({ message: 'title 必须是字符串' })
  @IsNotEmpty({ message: 'title 不能为空' })
  title: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean({ message: 'requires_signature 必须是布尔值' })
  requires_signature?: boolean;

  @IsOptional()
  @IsEnum(DocumentAudience, { message: 'audience 必须是 ALL/YOUTH/ADULT' })
  audience?: DocumentAudience;
}

/** 电子签署：{ student_id, signature_image }（§6.26） */
export class SignDocumentDto {
  @IsUUID('4', { message: 'student_id 必须是合法的 UUID' })
  student_id: string;

  @IsString({ message: 'signature_image 必须是字符串' })
  @IsNotEmpty({ message: 'signature_image 不能为空' })
  signature_image: string;
}
