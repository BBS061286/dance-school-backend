import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../common/types';
import { AddTicketsDto, AdminRegisterEventDto, CreateEventDto, CreateNoticeDto, IssueFeeDto, MergeGroupDto, PayEventRegistrationDto, RegisterEventDto } from './dto/events.dto';
import { EventsService } from './events.service';

/**
 * 活动 / 通知路由（设计文档 §6.5/6.6/6.7/§4.7/§6.28）。
 * 全局前缀 /api/v1 已在 main.ts 设置。
 */
@Controller()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /** 活动列表（ADMIN）：GET /admin/events，按开始时间倒序 */
  @Roles(UserRole.ADMIN)
  @Get('admin/events')
  listEvents() {
    return this.events.listEvents();
  }

  /** 活动报名名单（ADMIN）：GET /admin/events/:id/registrations */
  @Roles(UserRole.ADMIN)
  @Get('admin/events/:id/registrations')
  listRegistrations(@Param('id') id: string) {
    return this.events.listRegistrations(id);
  }

  /** 活动报名名单导出 CSV（ADMIN）：GET /admin/events/:id/registrations/export */
  @Roles(UserRole.ADMIN)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="event-registrations.csv"')
  @Get('admin/events/:id/registrations/export')
  exportRegistrations(@Param('id') id: string) {
    return this.events.exportRegistrationsCsv(id);
  }

  /** 购票看板（ADMIN）：GET /admin/events/:id/tickets */
  @Roles(UserRole.ADMIN)
  @Get('admin/events/:id/tickets')
  ticketDashboard(@Param('id') id: string) {
    return this.events.ticketDashboard(id);
  }

  /** 发布活动/比赛（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/events')
  createEvent(
    @Request() req: { user: RequestUser },
    @Body() dto: CreateEventDto,
  ) {
    return this.events.createEvent(req.user.id, dto);
  }

  /** 活动列表（公开）：GET /events，仅可报名的未来活动；可选 ?category=EVENT|COMPETITION */
  @Public()
  @Get('events')
  publicListEvents(@Query('category') category?: string) {
    return this.events.publicListEvents(category);
  }

  /** 活动详情（公开） */
  @Public()
  @Get('events/:id')
  getEvent(@Param('id') id: string) {
    return this.events.getEvent(id);
  }

  /** 我的活动报名（家长 / 成人学员）：GET /me/event-registrations */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT)
  @Get('me/event-registrations')
  myEventRegistrations(@Request() req: { user: RequestUser }) {
    return this.events.myEventRegistrations(req.user.id);
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

  /** 管理员代报名活动/比赛（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/events/:id/register')
  adminRegister(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: AdminRegisterEventDto,
  ) {
    return this.events.adminRegister(req.user.id, id, dto);
  }

  /** 管理员合并分组（ADMIN）：{ registration_ids, group_name? } */
  @Roles(UserRole.ADMIN)
  @Post('admin/event-registrations/merge-group')
  mergeGroup(@Body() dto: MergeGroupDto) {
    return this.events.mergeGroup(dto);
  }

  /** 活动分组列表（登录用户）：供家长加入组队时选择 */
  @Get('events/:id/groups')
  listGroups(@Param('id') id: string) {
    return this.events.listGroups(id);
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

  /** 加购门票：{ quantity }（学员端归属 / ADMIN） */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT, UserRole.ADMIN)
  @Post('event-registrations/:id/add-tickets')
  addTickets(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: AddTicketsDto,
  ) {
    return this.events.addTickets(req.user, id, dto.quantity, dto.tier_name);
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
