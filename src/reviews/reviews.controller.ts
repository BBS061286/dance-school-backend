import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsOptional, IsUUID } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../common/types';
import {
  CreateCourseReviewDto,
  CreateStudentReviewDto,
} from './dto/review.dto';
import { ReviewsService } from './reviews.service';

class MyStudentReviewsQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'course_id 必须是合法的 UUID' })
  course_id?: string;
}

/** 评价路由（§6.13–6.16）。全局前缀 /api/v1 在 main.ts 设置。 */
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** 发布课程整体要求评价：POST /admin/courses/:id/reviews（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/courses/:id/reviews')
  createCourseReview(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: CreateCourseReviewDto,
  ) {
    return this.reviews.createCourseReview(req.user, id, dto);
  }

  /** 查看课程评价流：GET /courses/:id/reviews（该课已确认报名的学员/家长可见） */
  @Get('courses/:id/reviews')
  listCourseReviews(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.reviews.listCourseReviews(req.user, id);
  }

  /** 发布学员个人评价（私密）：POST /admin/students/:id/reviews（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/students/:id/reviews')
  createStudentReview(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: CreateStudentReviewDto,
  ) {
    return this.reviews.createStudentReview(req.user, id, dto);
  }

  /** 查看自己（孩子）的个人评价：GET /me/students/:id/reviews?course_id= */
  @Get('me/students/:id/reviews')
  myStudentReviews(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Query() query: MyStudentReviewsQueryDto,
  ) {
    return this.reviews.myStudentReviews(req.user, id, query.course_id);
  }
}
