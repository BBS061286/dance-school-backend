import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseFormat,
  CourseStatus,
  NotificationSourceType,
  NotificationType,
  PricingType,
} from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { BrowseCoursesQuery } from './dto/browse-courses.dto';
import { AdminCoursesQuery } from './dto/admin-courses.dto';
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
      // 私教课名额不设上限：1v1 / 1v多 / 大班加练均可，仅要求至少 1 人
      if (capacity < 1) {
        throw new BadRequestException('私教课名额至少为 1 人');
      }
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
    if (dto.term_id) {
      const term = await this.prisma.term.findUnique({
        where: { id: dto.term_id },
        select: { id: true },
      });
      if (!term) throw new NotFoundException('学期不存在');
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
          termId: dto.term_id,
          sourceCourseId: dto.source_course_id,
          status: dto.status ?? 'DRAFT',
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
   * 支持标题模糊 q、format、audience、campus_id、term_id 过滤。
   * 卡片富化信息：学期、上课时间（周几/时段）、老师、剩余名额。
   */
  async browse(query: BrowseCoursesQuery) {
    const courses = await this.prisma.course.findMany({
      where: {
        status: 'PUBLISHED',
        ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
        ...(query.format ? { format: query.format } : {}),
        // 适合对象筛选：选"少儿"/"成人"时，"不限"(ALL)的课程也符合（对所有人开放）
        ...(query.audience === 'YOUTH' || query.audience === 'ADULT'
          ? { audience: { in: [query.audience, 'ALL'] } }
          : query.audience
            ? { audience: query.audience }
            : {}),
        ...(query.campus_id
          ? { campuses: { some: { campusId: query.campus_id } } }
          : {}),
        ...(query.term_id ? { termId: query.term_id } : {}),
      },
      select: {
        id: true,
        title: true,
        format: true,
        audience: true,
        skillLevel: true,
        priceCents: true,
        weekdays: true,
        timeRange: true,
        capacity: true,
        term: { select: { id: true, name: true } },
        campuses: {
          select: { campus: { select: { id: true, name: true } } },
        },
        instructors: {
          select: { instructor: { select: { user: { select: { name: true } } } } },
        },
        classSessions: {
          where: { status: { not: 'CANCELLED' }, startTime: { gte: new Date() } },
          select: {
            id: true,
            capacity: true,
            enrolledCount: true,
            instructor: { select: { user: { select: { name: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return courses.map((c) => {
      const teachers = new Set<string>();
      for (const ci of c.instructors) {
        const n = ci.instructor?.user?.name;
        if (n) teachers.add(n);
      }
      let totalCapacity = 0;
      let enrolled = 0;
      for (const s of c.classSessions) {
        const n = s.instructor?.user?.name;
        if (n) teachers.add(n);
        totalCapacity += s.capacity ?? c.capacity ?? 0;
        enrolled += s.enrolledCount;
      }
      const weekdays = [...(c.weekdays ?? [])].sort(
        (a: number, b: number) => a - b,
      );
      return {
        id: c.id,
        title: c.title,
        format: c.format,
        audience: c.audience,
        level: c.skillLevel,
        priceCents: c.priceCents,
        campuses: c.campuses.map((cc) => cc.campus),
        term: c.term,
        weekdays,
        timeRange: c.timeRange,
        teachers: [...teachers],
        capacity: totalCapacity,
        enrolled,
        seatsLeft: Math.max(totalCapacity - enrolled, 0),
      };
    });
  }

  /**
   * 管理端课程列表（GET /admin/courses）：
   * 全量课程（含 DRAFT/ARCHIVED），支持 q/term/status/format/audience 筛选，
   * 每门课程聚合报名人数/名额/班次数。
   */
  async adminList(query: AdminCoursesQuery) {
    const courses = await this.prisma.course.findMany({
      where: {
        ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
        ...(query.term ? { termId: query.term } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.format ? { format: query.format } : {}),
        // 适合对象筛选：选"少儿"/"成人"时，"不限"(ALL)的课程也符合（对所有人开放）
        ...(query.audience === 'YOUTH' || query.audience === 'ADULT'
          ? { audience: { in: [query.audience, 'ALL'] } }
          : query.audience
            ? { audience: query.audience }
            : {}),
        ...(query.campus
          ? { campuses: { some: { campusId: query.campus } } }
          : {}),
        ...(query.instructor_id
          ? { sessions: { some: { instructorId: query.instructor_id } } }
          : {}),
      },
      select: {
        id: true,
        title: true,
        format: true,
        audience: true,
        skillLevel: true,
        priceCents: true,
        status: true,
        weekdays: true,
        timeRange: true,
        capacity: true,
        term: { select: { id: true, name: true } },
        campuses: {
          select: { campus: { select: { id: true, name: true } } },
        },
        instructors: {
          select: { instructor: { select: { user: { select: { name: true } } } } },
        },
        classSessions: {
          select: {
            id: true,
            startTime: true,
            capacity: true,
            enrolledCount: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return courses.map((c) => {
      const teachers = new Set<string>();
      for (const ci of c.instructors) {
        const n = ci.instructor?.user?.name;
        if (n) teachers.add(n);
      }
      let totalCapacity = 0;
      let enrolled = 0;
      for (const s of c.classSessions) {
        totalCapacity += s.capacity ?? c.capacity ?? 0;
        enrolled += s.enrolledCount;
      }
      return {
        id: c.id,
        title: c.title,
        format: c.format,
        audience: c.audience,
        level: c.skillLevel,
        priceCents: c.priceCents,
        status: c.status,
        term: c.term,
        campuses: c.campuses.map((cc) => cc.campus),
        teachers: [...teachers],
        weekdays: [...(c.weekdays ?? [])].sort((a: number, b: number) => a - b),
        timeRange: c.timeRange,
        sessionCount: c.classSessions.length,
        enrolled,
        capacity: totalCapacity,
      };
    });
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

  /**
   * 课程状态变更：PATCH /admin/courses/:id/status（ADMIN）。
   * 草稿↔发布↔归档，用于新建后的发布、学期结束归档等。
   */
  async updateStatus(id: string, status: CourseStatus) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!course) throw new NotFoundException('课程不存在');
    return this.prisma.course.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });
  }

  /**
   * 管理端课程详情：GET /admin/courses/:id/detail（ADMIN）。
   * 返回基本信息 + 学期（含起止日期）+ 全部班次（日期/时间/地点/老师/报名/名额）
   * + 每个班次的报名学员（含状态、候补序号、缴费：应收/已付/已退/净付）+ 汇总统计。
   * 缴费口径与退款试算一致：订单已付按明细金额比例分摊。
   */
  async adminDetail(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        term: true,
        campuses: {
          select: { campus: { select: { id: true, name: true } } },
        },
        instructors: {
          include: {
            instructor: { include: { user: { select: { name: true } } } },
          },
        },
        classSessions: {
          orderBy: { startTime: 'asc' },
          include: {
            campus: { select: { id: true, name: true } },
            instructor: {
              include: { user: { select: { name: true } } },
            },
            enrollments: {
              include: { student: { select: { id: true, name: true } } },
              orderBy: { enrolledAt: 'asc' },
            },
          },
        },
      },
    });
    if (!course) throw new NotFoundException('课程不存在');

    // 批量算每条报名的缴费，避免 N+1
    const enrollmentIds: string[] = [];
    for (const s of course.classSessions) {
      for (const e of s.enrollments) enrollmentIds.push(e.id);
    }
    const items = enrollmentIds.length
      ? await this.prisma.orderItem.findMany({
          where: { enrollmentId: { in: enrollmentIds } },
          include: { order: { include: { payments: true } }, refunds: true },
        })
      : [];
    const payMap = new Map<
      string,
      { amountCents: number; paidCents: number; refundedCents: number }
    >();
    for (const item of items) {
      if (!item.enrollmentId) continue;
      const orderPaid = item.order.payments
        .filter((pay) => pay.status === 'SUCCEEDED')
        .reduce((sum, pay) => sum + pay.amountCents, 0);
      const share =
        item.order.amountCents > 0
          ? Math.round((orderPaid * item.amountCents) / item.order.amountCents)
          : 0;
      const refunded = item.refunds.reduce(
        (sum, r) => sum + r.amountCents,
        0,
      );
      const cur = payMap.get(item.enrollmentId) ?? {
        amountCents: 0,
        paidCents: 0,
        refundedCents: 0,
      };
      cur.amountCents += item.amountCents;
      cur.paidCents += share;
      cur.refundedCents += refunded;
      payMap.set(item.enrollmentId, cur);
    }

    const teachers = new Set<string>();
    const instructorList: Array<{ id: string; name: string }> = [];
    for (const ci of course.instructors) {
      const n = ci.instructor?.user?.name;
      if (n) teachers.add(n);
      if (ci.instructor) {
        instructorList.push({
          id: ci.instructor.id,
          name: ci.instructor.user?.name ?? '—',
        });
      }
    }

    const sessions = course.classSessions.map((s) => {
      const enrollments = s.enrollments.map((e) => {
        const pay = payMap.get(e.id) ?? {
          amountCents: 0,
          paidCents: 0,
          refundedCents: 0,
        };
        return {
          id: e.id,
          status: e.status,
          waitlistPosition: e.waitlistPosition,
          enrolledAt: e.enrolledAt,
          student: e.student,
          amountCents: pay.amountCents,
          paidCents: pay.paidCents,
          refundedCents: pay.refundedCents,
          netCents: pay.paidCents - pay.refundedCents,
        };
      });
      return {
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room,
        status: s.status,
        capacity: s.capacity,
        enrolledCount: s.enrolledCount,
        campus: s.campus,
        instructor: s.instructor
          ? { id: s.instructor.id, name: s.instructor.user?.name ?? '—' }
          : null,
        enrollments,
      };
    });

    const allEnrollments = sessions.flatMap((s) => s.enrollments);
    const stats = {
      sessionCount: sessions.length,
      studentCount: allEnrollments.length,
      totalCapacity: sessions.reduce((a, s) => a + (s.capacity ?? 0), 0),
      totalAmountCents: allEnrollments.reduce((a, e) => a + e.amountCents, 0),
      totalPaidCents: allEnrollments.reduce((a, e) => a + e.paidCents, 0),
      totalNetCents: allEnrollments.reduce((a, e) => a + e.netCents, 0),
    };

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      format: course.format,
      audience: course.audience,
      skillLevel: course.skillLevel,
      priceCents: course.priceCents,
      status: course.status,
      weekdays: course.weekdays,
      timeRange: course.timeRange,
      term: course.term
        ? {
            id: course.term.id,
            name: course.term.name,
            startDate: course.term.startDate,
            endDate: course.term.endDate,
          }
        : null,
      campuses: course.campuses.map((c) => c.campus),
      teachers: [...teachers],
      instructors: instructorList,
      sessions,
      stats,
    };
  }
}
