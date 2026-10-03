import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseFormat,
  NotificationSourceType,
  NotificationType,
  PricingType,
} from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';

/**
 * 课程管理服务（§6.27）：管理端新增课程（大课 / 大师课 / 私教课）。
 * 建 Course + CourseCampus + 可选 CourseInstructor；
 * 若传 instructor_id，向该教师发 INSTRUCTOR_ASSIGNMENT 通知（sourceType=COURSE）。
 */
@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** POST /admin/courses（ADMIN） */
  async create(dto: CreateCourseDto) {
    let capacity = dto.capacity;
    if (dto.format === CourseFormat.PRIVATE) {
      capacity = 1; // PRIVATE 强制 capacity=1
      if (
        dto.pricing_type !== PricingType.PER_SESSION &&
        dto.pricing_type !== PricingType.PACKAGE
      ) {
        throw new BadRequestException(
          '私教课 pricing_type 只能是 PER_SESSION 或 PACKAGE',
        );
      }
    }
    const campus = await this.prisma.campus.findUnique({
      where: { id: dto.campus_id },
      select: { id: true },
    });
    if (!campus) throw new NotFoundException('校区不存在');
    let instructorUserId: string | null = null;
    if (dto.instructor_id) {
      const instructor = await this.prisma.instructor.findUnique({
        where: { id: dto.instructor_id },
        select: { id: true, userId: true },
      });
      if (!instructor) throw new NotFoundException('教师不存在');
      instructorUserId = instructor.userId;
    }

    const course = await this.prisma.$transaction(async (tx) => {
      const created = await tx.course.create({
        data: {
          title: dto.title,
          description: dto.description,
          format: dto.format,
          audience: dto.audience,
          skillLevel: dto.skill_level ?? 'NONE',
          minAge: dto.min_age,
          maxAge: dto.max_age,
          altMinAge: dto.alt_min_age,
          altMaxAge: dto.alt_max_age,
          weekdays: dto.weekdays ?? [],
          timeRange: dto.time_range,
          pricingType: dto.pricing_type,
          requiresPayment: dto.requires_payment ?? true,
          priceCents: dto.price_cents,
          packageSize: dto.package_size,
          totalSessions: dto.total_sessions,
          startDate: new Date(dto.start_date),
          endDate: dto.end_date ? new Date(dto.end_date) : undefined,
          address: dto.address,
          capacity,
        },
      });
      await tx.courseCampus.create({
        data: { courseId: created.id, campusId: dto.campus_id },
      });
      if (dto.instructor_id) {
        await tx.courseInstructor.create({
          data: { courseId: created.id, instructorId: dto.instructor_id },
        });
      }
      return created;
    });

    if (dto.instructor_id && instructorUserId) {
      await this.notifications.notify({
        userId: instructorUserId,
        type: NotificationType.INSTRUCTOR_ASSIGNMENT,
        title: '你被分配了新课程',
        body: `你被指定为《${course.title}》的任课教师。`,
        sourceType: NotificationSourceType.COURSE,
        sourceId: course.id,
      });
    }
    return course;
  }
}
