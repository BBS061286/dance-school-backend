import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CampusesService } from './campuses.service';
import { CreateCampusDto, UpdateCampusDto } from './dto/campus.dto';

/** 校区管理路由（ADMIN）。全局前缀 /api/v1 在 main.ts 设置。 */
@Controller()
@Roles(UserRole.ADMIN)
export class CampusesController {
  constructor(private readonly campuses: CampusesService) {}

  /** 公开校区列表（家长端下拉用）：GET /campuses */
  @Public()
  @Roles()
  @Get('campuses')
  publicList() {
    return this.campuses.publicList();
  }

  /** 校区列表：GET /admin/campuses */
  @Get('admin/campuses')
  list() {
    return this.campuses.list();
  }

  /** 新建校区：POST /admin/campuses */
  @Post('admin/campuses')
  create(@Body() dto: CreateCampusDto) {
    return this.campuses.create(dto);
  }

  /** 校区课程：GET /admin/campuses/:id/courses（该校区所有课程+时间+老师+人数） */
  @Get('admin/campuses/:id/courses')
  campusCourses(@Param('id') id: string) {
    return this.campuses.campusCourses(id);
  }

  /** 校区详情：GET /admin/campuses/:id */
  @Get('admin/campuses/:id')
  detail(@Param('id') id: string) {
    return this.campuses.detail(id);
  }

  /** 编辑校区：PATCH /admin/campuses/:id */
  @Patch('admin/campuses/:id')
  update(@Param('id') id: string, @Body() dto: UpdateCampusDto) {
    return this.campuses.update(id, dto);
  }

  /** 彻底删除校区（仅无关联数据时）：DELETE /admin/campuses/:id */
  @Delete('admin/campuses/:id')
  remove(@Param('id') id: string) {
    return this.campuses.remove(id);
  }
}
