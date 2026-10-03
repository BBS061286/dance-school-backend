import { Body, Controller, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';

/** 课程管理路由（§6.27）。全局前缀 /api/v1 在 main.ts 设置。 */
@Controller()
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  /** 新增课程：POST /admin/courses（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/courses')
  create(@Body() dto: CreateCourseDto) {
    return this.courses.create(dto);
  }
}
