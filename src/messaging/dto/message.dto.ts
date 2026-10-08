import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** 发送私信请求体（§6.22/6.23）：{ body, peerType?, peerId? }
 * peerType=ADMIN（默认，给管理员）| INSTRUCTOR（给老师，需 peerId=老师 userId） */
export class SendMessageDto {
  @IsString({ message: 'body 必须是字符串' })
  @IsNotEmpty({ message: 'body 不能为空' })
  body: string;

  @IsOptional()
  @IsString({ message: 'peerType 必须是字符串' })
  peerType?: string;

  @IsOptional()
  @IsString({ message: 'peerId 必须是字符串' })
  peerId?: string;
}

/** 管理端回复私信请求体：{ body } */
export class ReplyMessageDto {
  @IsString({ message: 'body 必须是字符串' })
  @IsNotEmpty({ message: 'body 不能为空' })
  body: string;
}

/** 管理员主动发起私信请求体：{ userId?, studentId?, body, contextStudentName? }（userId 与 studentId 二选一） */
export class InitiateMessageDto {
  @IsOptional()
  @IsString({ message: 'userId 必须是字符串' })
  userId?: string;

  @IsOptional()
  @IsString({ message: 'studentId 必须是字符串' })
  studentId?: string;

  @IsString({ message: 'body 必须是字符串' })
  @IsNotEmpty({ message: 'body 不能为空' })
  body: string;

  @IsOptional()
  @IsString({ message: 'contextStudentName 必须是字符串' })
  contextStudentName?: string;
}

/** 新建快捷回复模板：{ title, body } */
export class CreateTemplateDto {
  @IsString({ message: 'title 必须是字符串' })
  @IsNotEmpty({ message: 'title 不能为空' })
  title: string;

  @IsString({ message: 'body 必须是字符串' })
  @IsNotEmpty({ message: 'body 不能为空' })
  body: string;
}
