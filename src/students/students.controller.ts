import { Body, Controller, Get, Param, Post, Query, Request, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { LocalFileInterceptor, UploadedLocalFile } from '../common/local-upload';
import { ParentCreateStudentDto } from './dto/parent-create-student.dto';
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

  /** 家长自助添加孩子：POST /me/students */
  @Roles(UserRole.PARENT)
  @Post('me/students')
  parentCreate(
    @Request() req: { user: { id: string } },
    @Body() dto: ParentCreateStudentDto,
  ) {
    return this.students.parentCreate(req.user.id, dto);
  }

  /** 家长给孩子上传照片：POST /me/students/:id/photo */
  @Roles(UserRole.PARENT)
  @Post('me/students/:id/photo')
  @UseInterceptors(LocalFileInterceptor())
  uploadPhoto(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @UploadedFile() file?: UploadedLocalFile,
  ) {
    if (!file) throw new BadRequestException('请上传图片文件');
    return this.students.uploadPhoto(req.user.id, id, file.filename);
  }

  /** 学员详情：GET /admin/students/:id/detail */
  @Roles(UserRole.ADMIN)
  @Get('admin/students/:id/detail')
  detail(@Param('id') id: string) {
    return this.students.detail(id);
  }
}
