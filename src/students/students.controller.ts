import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { StudentsService } from './students.service';
import { AdminCreateStudentDto } from './dto/admin-create-student.dto';

class SearchStudentsQueryDto {
  @IsOptional()
  @IsIn(['YOUTH', 'ADULT'], { message: 'audience 必须是 YOUTH 或 ADULT' })
  audience?: 'YOUTH' | 'ADULT';

  @IsOptional()
  @IsUUID('4', { message: 'campus 必须是合法的 UUID' })
  campus?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt({ message: 'weekday 必须是整数' })
  @Min(0, { message: 'weekday 取值 0-6' })
  @Max(6, { message: 'weekday 取值 0-6' })
  weekday?: number;

  @IsOptional()
  @IsString({ message: 'q 必须是字符串' })
  q?: string;

  @IsOptional()
  @IsString({ message: 'term 必须是学期 ID' })
  term?: string;

  @IsOptional()
  @IsString({ message: 'formats 必须是逗号分隔的课程类型' })
  formats?: string;
}

/** 学员查询路由（§6.12，ADMIN）。全局前缀 /api/v1 在 main.ts 设置。 */
@Controller()
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  /** 学员统计：GET /admin/students/stats */
  @Roles(UserRole.ADMIN)
  @Get('admin/students/stats')
  stats() {
    return this.students.stats();
  }

  /** 全体学员搜索：GET /admin/students?audience=&campus=&weekday=&q= */
  @Roles(UserRole.ADMIN)
  @Get('admin/students')
  search(@Query() query: SearchStudentsQueryDto) {
    return this.students.search(query);
  }

  /** 管理端直接建学员：POST /admin/students */
  @Roles(UserRole.ADMIN)
  @Post('admin/students')
  adminCreate(@Body() dto: AdminCreateStudentDto) {
    return this.students.adminCreate(dto);
  }

  /** 学员详情：GET /admin/students/:id/detail */
  @Roles(UserRole.ADMIN)
  @Get('admin/students/:id/detail')
  detail(@Param('id') id: string) {
    return this.students.detail(id);
  }
}
