import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { ParticipantRole, UserRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../common/types';
import {
  CreateTemplateDto,
  InitiateMessageDto,
  InstructorInitiateDto,
  ReplyMessageDto,
  SendMessageDto,
} from './dto/message.dto';
import { MessagingService } from './messaging.service';

class ListThreadsQueryDto {
  @IsOptional()
  @IsEnum(ParticipantRole, { message: 'role 必须是 PARENT/ADULT_STUDENT/INSTRUCTOR' })
  role?: ParticipantRole;

  @IsOptional()
  @IsString({ message: 'search 必须是字符串' })
  search?: string;
}

class MyMessagesQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'threadId 必须是合法的 UUID' })
  threadId?: string;
}

/** 私信路由（§6.22/6.23）。全局前缀 /api/v1 在 main.ts 设置。 */
@Controller()
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  /** 发私信：POST /me/messages（thread 不存在自动创建，可指定 peerType/peerId 发给老师） */
  @Post('me/messages')
  postMessage(
    @Request() req: { user: RequestUser },
    @Body() dto: SendMessageDto,
  ) {
    return this.messaging.postMessage(
      req.user,
      dto.body,
      dto.peerType ?? 'ADMIN',
      dto.peerId ?? null,
    );
  }

  /** 查看私信：GET /me/messages?threadId=（不传则看与管理员的） */
  @Get('me/messages')
  myMessages(
    @Request() req: { user: RequestUser },
    @Query() query: MyMessagesQueryDto,
  ) {
    return this.messaging.myMessages(req.user.id, query.threadId);
  }

  /** 我的会话列表：GET /me/message-threads */
  @Get('me/message-threads')
  myThreads(@Request() req: { user: RequestUser }) {
    return this.messaging.myThreads(req.user.id);
  }

  /** 标已读：POST /me/message-threads/:id/read */
  @Post('me/message-threads/:id/read')
  markThreadRead(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.messaging.markThreadRead(req.user.id, id);
  }

  /** 我可联系的老师：GET /me/messageable-teachers */
  @Get('me/messageable-teachers')
  messageableTeachers(@Request() req: { user: RequestUser }) {
    return this.messaging.messageableTeachers(req.user.id);
  }

  /** 教师端收件箱：GET /me/instructor/message-threads（INSTRUCTOR） */
  @Roles(UserRole.INSTRUCTOR)
  @Get('me/instructor/message-threads')
  instructorThreads(@Request() req: { user: RequestUser }) {
    return this.messaging.instructorThreads(req.user.id);
  }

  /** 教师端看会话：GET /me/instructor/message-threads/:id（INSTRUCTOR） */
  @Roles(UserRole.INSTRUCTOR)
  @Get('me/instructor/message-threads/:id')
  instructorThread(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.messaging.instructorThread(req.user.id, id);
  }

  /** 教师端回复：POST /me/instructor/message-threads/:id/reply（INSTRUCTOR） */
  @Roles(UserRole.INSTRUCTOR)
  @Post('me/instructor/message-threads/:id/reply')
  instructorReply(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: ReplyMessageDto,
  ) {
    return this.messaging.instructorReply(req.user, id, dto.body);
  }

  /** 教师端标已读：POST /me/instructor/message-threads/:id/read（INSTRUCTOR） */
  @Roles(UserRole.INSTRUCTOR)
  @Post('me/instructor/message-threads/:id/read')
  instructorMarkRead(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.messaging.instructorMarkRead(req.user.id, id);
  }

  /** 教师端主动发起私信：POST /me/instructor/messages/initiate（INSTRUCTOR） */
  @Roles(UserRole.INSTRUCTOR)
  @Post('me/instructor/messages/initiate')
  instructorInitiate(
    @Request() req: { user: RequestUser },
    @Body() dto: InstructorInitiateDto,
  ) {
    return this.messaging.instructorInitiate(req.user, dto.parentId);
  }

  /** 管理端收件箱：GET /admin/messages/threads?role=&search=（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Get('admin/messages/threads')
  listThreads(@Query() query: ListThreadsQueryDto) {
    return this.messaging.listThreads(query.role, query.search);
  }

  /** 管理员主动发起私信：POST /admin/messages/initiate（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/messages/initiate')
  initiate(
    @Request() req: { user: RequestUser },
    @Body() dto: InitiateMessageDto,
  ) {
    return this.messaging.initiate(req.user, dto);
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

  /** 标已读：POST /admin/messages/threads/:id/read（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/messages/threads/:id/read')
  markRead(@Param('id') id: string) {
    return this.messaging.markRead(id);
  }

  /** 快捷回复模板列表：GET /admin/message-templates（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Get('admin/message-templates')
  listTemplates() {
    return this.messaging.listTemplates();
  }

  /** 新建快捷回复模板：POST /admin/message-templates（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/message-templates')
  createTemplate(
    @Request() req: { user: RequestUser },
    @Body() dto: CreateTemplateDto,
  ) {
    return this.messaging.createTemplate(req.user.id, dto);
  }

  /** 删除快捷回复模板：DELETE /admin/message-templates/:id（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Delete('admin/message-templates/:id')
  deleteTemplate(@Param('id') id: string) {
    return this.messaging.deleteTemplate(id);
  }
}
