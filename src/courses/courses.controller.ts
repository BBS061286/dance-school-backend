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

  /** 临时：修复演示数据（用完即删） */
  @Roles(UserRole.ADMIN)
  @Post('admin/_fix-demo-data2')
  async fixDemoData2() {
    // 1. 百老汇大师课：totalSessions 1 -> 2（实际有2个课次）
    await this.courses.fixTotalSessions('b75e6907-b162-4dfc-9373-17c267d89b84', 2);
    // 2. 少儿中国舞：删除9个空班次，保留有2个报名的 fa7b6ccc，并移到未来周六、状态改 SCHEDULED
    const deleted = await this.courses.dedupeSessions('66d667f8-0b7f-4080-bd59-698b792f14f3', 'fa7b6ccc-6185-4718-b7de-64f330f1409a');
    return { totalSessionsFixed: true, sessionsDeleted: deleted };
  }
}
