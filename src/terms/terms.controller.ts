import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { TermsService } from './terms.service';
import { CreateTermDto, UpdateTermDto } from './dto/term.dto';

/** 学期管理路由（ADMIN）。全局前缀 /api/v1 在 main.ts 设置。 */
@Controller()
@Roles(UserRole.ADMIN)
export class TermsController {
  constructor(private readonly terms: TermsService) {}

  /** 学期列表：GET /admin/terms */
  @Get('admin/terms')
  list() {
    return this.terms.list();
  }

  /** 新建学期：POST /admin/terms */
  @Post('admin/terms')
  create(@Body() dto: CreateTermDto) {
    return this.terms.create(dto);
  }

  /** 编辑学期：PATCH /admin/terms/:id */
  @Patch('admin/terms/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTermDto) {
    return this.terms.update(id, dto);
  }

  /** 删除学期：DELETE /admin/terms/:id */
  @Delete('admin/terms/:id')
  remove(@Param('id') id: string) {
    return this.terms.remove(id);
  }
}
