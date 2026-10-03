import { Controller, Get, Param, Query } from '@nestjs/common';
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
}

/** 学员查询路由（§6.12，ADMIN）。全局前缀 /api/v1 在 main.ts 设置。 */
@Controller()
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  /** 全体学员搜索：GET /admin/students?audience=&campus=&weekday=&q= */
  @Roles(UserRole.ADMIN)
  @Get('admin/students')
  search(@Query() query: SearchStudentsQueryDto) {
    return this.students.search(query);
  }

  /** 学员详情：GET /admin/students/:id/detail */
  @Roles(UserRole.ADMIN)
  @Get('admin/students/:id/detail')
  detail(@Param('id') id: string) {
    return this.students.detail(id);
  }
}
