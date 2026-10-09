import { Body, Controller, Get, Post, Query } from '@nestjs/common';
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

  /** 课表日历：GET /admin/schedule（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Get('admin/schedule')
  schedule(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('campusId') campusId?: string,
  ) {
    return this.sessions.schedule(from, to, campusId);
  }
}
