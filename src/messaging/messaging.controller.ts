import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { ParticipantRole, UserRole } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../common/types';
import { ReplyMessageDto, SendMessageDto } from './dto/message.dto';
import { MessagingService } from './messaging.service';

class ListThreadsQueryDto {
  @IsOptional()
  @IsEnum(ParticipantRole, { message: 'role 必须是 PARENT/ADULT_STUDENT/INSTRUCTOR' })
  role?: ParticipantRole;
}

/** 私信路由（§6.22/6.23）。全局前缀 /api/v1 在 main.ts 设置。 */
@Controller()
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  /** 发私信：POST /me/messages（thread 不存在自动创建） */
  @Post('me/messages')
  postMessage(
    @Request() req: { user: RequestUser },
    @Body() dto: SendMessageDto,
  ) {
    return this.messaging.postMessage(req.user, dto.body);
  }

  /** 查看私信：GET /me/messages */
  @Get('me/messages')
  myMessages(@Request() req: { user: RequestUser }) {
    return this.messaging.myMessages(req.user.id);
  }

  /** 管理端收件箱：GET /admin/messages/threads?role=（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Get('admin/messages/threads')
  listThreads(@Query() query: ListThreadsQueryDto) {
    return this.messaging.listThreads(query.role);
  }

  /** 管理端查看会话：GET /admin/messages/threads/:id（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Get('admin/messages/threads/:id')
  getThread(@Param('id') id: string) {
    return this.messaging.getThread(id);
  }

  /** 管理端回复：POST /admin/messages/threads/:id/reply（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/messages/threads/:id/reply')
  reply(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: ReplyMessageDto,
  ) {
    return this.messaging.reply(req.user, id, dto.body);
  }
}
