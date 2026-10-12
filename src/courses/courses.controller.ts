import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CoursesService } from './courses.service';
import { BrowseCoursesQuery } from './dto/browse-courses.dto';
import { AdminCoursesQuery } from './dto/admin-courses.dto';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseStatusDto } from './dto/update-course-status.dto';

/** 课程管理路由（§6.27）。全局前缀 /api/v1 在 main.ts 设置。 */
@Controller()
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  /** 公开课程列表：GET /courses?q=&format=&audience=&campus_id=（仅已发布） */
  @Public()
  @Get('courses')
  browse(@Query() query: BrowseCoursesQuery) {
    return this.courses.browse(query);
  }

  /** 公开课程详情 + 未来场次：GET /courses/:id */
  @Public()
  @Get('courses/:id')
  detail(@Param('id') id: string) {
    return this.courses.detail(id);
  }

  /** 管理端课程列表：GET /admin/courses（ADMIN），支持 q/term/status/format/audience 筛选 */
  @Roles(UserRole.ADMIN)
  @Get('admin/courses')
  adminList(@Query() query: AdminCoursesQuery) {
    return this.courses.adminList(query);
  }

  /** 管理端课程详情：GET /admin/courses/:id/detail（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Get('admin/courses/:id/detail')
  adminDetail(@Param('id') id: string) {
    return this.courses.adminDetail(id);
  }

  /** 课程状态变更：PATCH /admin/courses/:id/status（ADMIN），草稿↔发布↔归档 */
  @Roles(UserRole.ADMIN)
  @Patch('admin/courses/:id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCourseStatusDto) {
    return this.courses.updateStatus(id, dto.status);
  }

  /** 新增课程：POST /admin/courses（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/courses')
  create(@Body() dto: CreateCourseDto) {
    return this.courses.create(dto);
  }
}
