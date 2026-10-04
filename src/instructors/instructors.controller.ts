import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  AssignInstructorDto,
  CreateInstructorDto,
  UpdateInstructorDto,
} from './dto/instructor.dto';
import { InstructorsService } from './instructors.service';

/** 教师管理路由（§6.25，ADMIN）。全局前缀 /api/v1 在 main.ts 设置。 */
@Controller()
@Roles(UserRole.ADMIN)
export class InstructorsController {
  constructor(private readonly instructors: InstructorsService) {}

  /** 私教老师浏览（家长 / 成人学员）：GET /instructors/browse */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT)
  @Get('instructors/browse')
  browseInstructors() {
    return this.instructors.browseInstructors();
  }

  /** 手动添加教师：POST /admin/instructors */
  @Post('admin/instructors')
  create(@Body() dto: CreateInstructorDto) {
    return this.instructors.create(dto);
  }

  /** 教师列表：GET /admin/instructors */
  @Get('admin/instructors')
  list() {
    return this.instructors.list();
  }

  /** 教师详情：GET /admin/instructors/:id */
  @Get('admin/instructors/:id')
  detail(@Param('id') id: string) {
    return this.instructors.detail(id);
  }

  /** 教师课时统计：GET /admin/instructors/:id/stats?term= */
  @Get('admin/instructors/:id/stats')
  teachingStats(@Param('id') id: string, @Query('term') term?: string) {
    return this.instructors.teachingStats(id, term);
  }

  /** 编辑教师资料：PATCH /admin/instructors/:id */
  @Patch('admin/instructors/:id')
  update(@Param('id') id: string, @Body() dto: UpdateInstructorDto) {
    return this.instructors.update(id, dto);
  }

  /** 分配教师到班级：POST /admin/course-sessions/:id/assign-instructor */
  @Post('admin/course-sessions/:id/assign-instructor')
  assignInstructor(@Param('id') id: string, @Body() dto: AssignInstructorDto) {
    return this.instructors.assignInstructor(id, dto);
  }
}
