import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CoursesService } from './courses.service';
import { BrowseCoursesQuery } from './dto/browse-courses.dto';
import { CreateCourseDto } from './dto/create-course.dto';

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

  /** 新增课程：POST /admin/courses（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/courses')
  create(@Body() dto: CreateCourseDto) {
    return this.courses.create(dto);
  }
}
