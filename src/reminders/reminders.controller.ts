import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query, Delete} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateReminderRuleDto } from './dto/create-reminder-rule.dto';
import { UpdateReminderRuleDto } from './dto/update-reminder-rule.dto';
import { RemindersService } from './reminders.service';

/**
 * 提醒规则管理（设计文档 §4.8）：全部 ADMIN。
 * 全局前缀 /api/v1 在 main.ts 设置，此处用空前缀 + 相对路径（与 BillingController 一致）。
 */
@Controller()
@Roles('ADMIN')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  /** 提醒规则列表 */
  @Get('admin/reminder-rules')
  listRules() {
    return this.remindersService.listRules();
  }

  /** 新建提醒规则 */
  @Post('admin/reminder-rules')
  createRule(@Body() dto: CreateReminderRuleDto) {
    return this.remindersService.createRule(dto);
  }

  /** 更新提醒规则 */
  @Patch('admin/reminder-rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateReminderRuleDto) {
    return this.remindersService.updateRule(id, dto);
  }

  @Delete('admin/reminder-rules/:id')
  deleteRule(@Param('id') id: string) {
    return this.remindersService.deleteRule(id);
  }

  /** 发送日志查询（可按 target_id 过滤） */
  @Get('admin/reminder-logs')
  listLogs(@Query('target_id') targetId?: string) {
    return this.remindersService.listLogs(targetId);
  }
}
