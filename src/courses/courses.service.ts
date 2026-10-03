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
import { BrowseCoursesQuery } from './dto/browse-courses.dto';
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

  /**
   * 公开课程列表（GET /courses）：
   * 仅 status = PUBLISHED（schema 无 isActive 字段，以发布状态为准），
   * 支持标题模糊 q、format、audience、campus_id 过滤。
   */
  async browse(query: BrowseCoursesQuery) {
    const courses = await this.prisma.course.findMany({
      where: {
        status: 'PUBLISHED',
        ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
        ...(query.format ? { format: query.format } : {}),
        ...(query.audience ? { audience: query.audience } : {}),
        ...(query.campus_id
          ? { campuses: { some: { campusId: query.campus_id } } }
          : {}),
      },
      select: {
        id: true,
        title: true,
        format: true,
        audience: true,
        skillLevel: true,
        priceCents: true,
        campuses: {
          select: { campus: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return courses.map((c) => ({
      id: c.id,
      title: c.title,
      format: c.format,
      audience: c.audience,
      level: c.skillLevel,
      priceCents: c.priceCents,
      campuses: c.campuses.map((cc) => cc.campus),
    }));
  }

  /**
   * 公开课程详情 + 未来场次（GET /courses/:id）：
   * classSessions 取 startTime >= now 且未取消的，按 startTime 升序。
   */
  async detail(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        campuses: {
          select: { campus: { select: { id: true, name: true } } },
        },
        classSessions: {
          where: {
            startTime: { gte: new Date() },
            status: { not: 'CANCELLED' },
          },
          orderBy: { startTime: 'asc' },
          include: {
            campus: { select: { id: true, name: true } },
            instructor: {
              include: { user: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!course) throw new NotFoundException('课程不存在');
    const { campuses, classSessions, ...rest } = course;
    return {
      ...rest,
      campuses: campuses.map((cc) => cc.campus),
      classSessions: classSessions.map((s) => ({
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        capacity: s.capacity,
        enrolledCount: s.enrolledCount,
        campus: s.campus,
        instructor: s.instructor
          ? { id: s.instructor.id, name: s.instructor.user.name }
          : null,
      })),
    };
  }
}
