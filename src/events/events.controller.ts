import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../common/types';
import { CreateEventDto, CreateNoticeDto, IssueFeeDto, PayEventRegistrationDto, RegisterEventDto } from './dto/events.dto';
import { EventsService } from './events.service';

/**
 * 活动 / 通知路由（设计文档 §6.5/6.6/6.7/§4.7/§6.28）。
 * 全局前缀 /api/v1 已在 main.ts 设置。
 */
@Controller()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /** 发布活动/比赛（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/events')
  createEvent(
    @Request() req: { user: RequestUser },
    @Body() dto: CreateEventDto,
  ) {
    return this.events.createEvent(req.user.id, dto);
  }

  /** 活动详情（公开） */
  @Public()
  @Get('events/:id')
  getEvent(@Param('id') id: string) {
    return this.events.getEvent(id);
  }

  /** 报名活动/比赛：{ ticket_quantity? }（家长 / 成人学员） */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT)
  @Post('events/:id/register')
  register(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: RegisterEventDto,
  ) {
    return this.events.register(req.user, id, dto);
  }

  /** 取消活动报名 */
  @Patch('event-registrations/:id/cancel')
  cancelRegistration(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.events.cancelRegistration(req.user, id);
  }

  /** 发放参赛/参与费用（ADMIN）：{ participation_fee_cents } */
  @Roles(UserRole.ADMIN)
  @Post('admin/event-registrations/:id/issue-fee')
  issueFee(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: IssueFeeDto,
  ) {
    return this.events.issueFee(req.user.id, id, dto);
  }

  /** 学员缴费（门票款或参赛费）：{ item_type }，走 billing 流程 */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT)
  @Post('event-registrations/:id/pay')
  payRegistration(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: PayEventRegistrationDto,
  ) {
    return this.events.payRegistration(req.user, id, dto);
  }

  /** 发布通知（ADMIN）：按 scope 展开成多条 Notification */
  @Roles(UserRole.ADMIN)
  @Post('admin/notices')
  createNotice(
    @Request() req: { user: RequestUser },
    @Body() dto: CreateNoticeDto,
  ) {
    return this.events.createNotice(req.user.id, dto);
  }

  /** 我的通知（type=NOTICE） */
  @Get('me/notices')
  myNotices(@Request() req: { user: RequestUser }) {
    return this.events.myNotices(req.user.id);
  }
}
