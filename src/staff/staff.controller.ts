import { Body, Controller, Get, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateStaffDto } from './dto/staff.dto';
import { StaffService } from './staff.service';

/** 员工（管理员账号）管理路由。全局前缀 /api/v1 在 main.ts 设置。 */
@Controller()
@Roles(UserRole.ADMIN)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /** 新建管理员账号：POST /admin/staff */
  @Post('admin/staff')
  create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto);
  }

  /** 管理员账号列表：GET /admin/staff */
  @Get('admin/staff')
  list() {
    return this.staff.list();
  }
}
