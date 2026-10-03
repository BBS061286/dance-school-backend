import { IsNotEmpty, IsString } from 'class-validator';

/** 发送私信请求体（§6.22/6.23）：{ body } */
export class SendMessageDto {
  @IsString({ message: 'body 必须是字符串' })
  @IsNotEmpty({ message: 'body 不能为空' })
  body: string;
}

/** 管理端回复私信请求体：{ body } */
export class ReplyMessageDto {
  @IsString({ message: 'body 必须是字符串' })
  @IsNotEmpty({ message: 'body 不能为空' })
  body: string;
}
