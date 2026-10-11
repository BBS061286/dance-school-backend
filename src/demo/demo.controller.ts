import { Body, Controller, Post, Request } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { DemoService } from './demo.service';

/** 演示数据接口（ADMIN） */
@Controller()
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  /** 创建春季学期演示数据 */
  @Roles(UserRole.ADMIN)
  @Post('admin/demo/seed-spring')
  seedSpring(@Request() req: { user: { id: string } }, @Body() dto: { student_id: string }) {
    return this.demo.seedSpringTerm(dto.student_id);
  }

  /** 给课程补介绍 */
  @Roles(UserRole.ADMIN)
  @Post('admin/demo/seed-descriptions')
  seedDescriptions() {
    return this.demo.seedDescriptions();
  }

  /** 临时：教师端全套演示数据 */
  @Roles(UserRole.ADMIN)
  @Post('admin/demo/seed-teacher')
  async seedTeacher() {
    try {
      return await this.demo.seedTeacherDemo();
    } catch (e: any) {
      return { ok: false, error: e?.message, stack: (e?.stack || '').split('\n').slice(0, 6) };
    }
  }
}
