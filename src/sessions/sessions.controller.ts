import { Body, Controller, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateSessionDto } from './dto/create-session.dto';
import { SessionsService } from './sessions.service';

@Controller()
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /** 新建班次：POST /admin/sessions（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/sessions')
  create(@Body() dto: CreateSessionDto) {
    return this.sessions.create(dto);
  }
}
