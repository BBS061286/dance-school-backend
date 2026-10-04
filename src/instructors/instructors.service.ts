import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import {
  NotificationSourceType,
  NotificationType,
  UserRole,
} from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssignInstructorDto,
  CreateInstructorDto,
  UpdateInstructorDto,
} from './dto/instructor.dto';

/**
 * 教师管理服务（§6.25，管理端统一管控）：
 * 教师列表/详情（任教班级+成员+打卡记录）、编辑资料、分配教师到班级。
 */
@Injectable()
export class InstructorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * POST /admin/instructors：管理员手动添加教师。
   * 同时创建 TEACHER 用户与 Instructor 档案，生成随机初始密码一次返回。
   */
  async create(dto: CreateInstructorDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException('该邮箱已被注册');

    const tempPassword = randomBytes(4).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const instructor = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          phone: dto.phone,
          role: UserRole.INSTRUCTOR,
          passwordHash,
        },
      });
      return tx.instructor.create({
        data: {
          userId: user.id,
          bio: dto.bio,
          specialties: dto.specialties ?? [],
          defaultCampusId: dto.default_campus_id,
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });
    });
    return { ...instructor, tempPassword };
  }

  /** GET /admin/instructors：教师列表（含头像、简介、任教班级数） */
  async list() {
    return this.prisma.instructor.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, avatarUrl: true, isActive: true, createdAt: true },
        },
        _count: { select: { classSessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * GET /admin/instructors/:id：教师详情
   *（任教班级大课+私教课、班级成员、打卡记录含私课打卡）。
   */
  async detail(id: string) {
    const instructor = await this.prisma.instructor.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, avatarUrl: true, isActive: true, createdAt: true },
        },
        defaultCampus: { select: { id: true, name: true } },
        classSessions: {
          include: {
            course: { select: { id: true, title: true, format: true, term: { select: { id: true, name: true } } } },
            campus: { select: { id: true, name: true } },
            enrollments: {
              where: { status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
              include: {
                student: { select: { id: true, name: true, photoUrl: true } },
              },
              orderBy: { enrolledAt: 'asc' },
            },
          },
          orderBy: { startTime: 'asc' },
        },
        // 课程关联（含每门课时费）
        courseLinks: {
          include: {
            course: {
              select: {
                id: true,
                title: true,
                format: true,
                term: { select: { id: true, name: true } },
              },
            },
          },
        },
        // 私教课安排（1对1/临时 group）
        extraLessons: {
          include: {
            student: { select: { id: true, name: true } },
            slots: { orderBy: { date: 'asc' } },
          },
          orderBy: { createdAt: 'desc' },
        },
        // 打卡记录（常规班级 + 私课打卡）
        checkins: {
          include: {
            classSession: { select: { id: true } },
            sessionOccurrence: {
              select: { id: true, sessionNumber: true, date: true },
            },
            extraLessonSlot: { select: { id: true, date: true, time: true } },
          },
          orderBy: { checkedInAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!instructor) throw new NotFoundException('教师不存在');
    // 该老师课程的学员评价
    const courseIds = instructor.classSessions.map((cs) => cs.course.id);
    const reviews = courseIds.length
      ? await this.prisma.courseReview.findMany({
          where: { courseId: { in: [...new Set(courseIds)] } },
          include: {
            course: { select: { id: true, title: true } },
            createdBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      : [];
    return { ...instructor, reviews };
  }

  /** 删除老师：DELETE /admin/instructors/:id
   * 有未结束班级时拒绝（先停用或重新分配）；无负担时删除 Instructor + User */
  async remove(id: string) {
    const instructor = await this.prisma.instructor.findUnique({
      where: { id },
      include: {
        classSessions: {
          where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          select: { id: true },
        },
      },
    });
    if (!instructor) throw new NotFoundException('教师不存在');
    if (instructor.classSessions.length > 0) {
      throw new BadRequestException(
        `该老师还有 ${instructor.classSessions.length} 个未结束班级，请先重新分配或停用`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.instructor.delete({ where: { id } }),
      this.prisma.user.delete({ where: { id: instructor.userId } }),
    ]);
    return { ok: true };
  }

  /** 管理端上传老师头像：POST /admin/instructors/:id/avatar */
  async uploadAvatar(id: string, filename: string) {
    const instructor = await this.prisma.instructor.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!instructor) throw new NotFoundException('教师不存在');
    return this.prisma.user.update({
      where: { id: instructor.userId },
      data: { avatarUrl: `uploads/${filename}` },
      select: { id: true, name: true, avatarUrl: true },
    });
  }

  /** 设置老师在某门课的课时费：PATCH /admin/courses/:courseId/instructors/:instructorId/rate */
  async setCourseRate(courseId: string, instructorId: string, hourlyRateCents: number | null) {
    const link = await this.prisma.courseInstructor.findUnique({
      where: { courseId_instructorId: { courseId, instructorId } },
    });
    if (!link) throw new NotFoundException('该老师未关联此课程');
    return this.prisma.courseInstructor.update({
      where: { courseId_instructorId: { courseId, instructorId } },
      data: { hourlyRateCents },
      include: {
        course: { select: { id: true, title: true, format: true } },
        instructor: { include: { user: { select: { name: true } } } },
      },
    });
  }

  /** 教师课时统计：GET /admin/instructors/:id/stats?term= — 按学期分组 + 按月课时 + 薪资 */
  async teachingStats(id: string, termId?: string) {
    const instructor = await this.prisma.instructor.findUnique({
      where: { id },
      select: {
        id: true,
        defaultGroupRateCents: true,
        defaultPrivateRateCents: true,
        defaultMasterRateCents: true,
      },
    });
    if (!instructor) throw new NotFoundException('教师不存在');
    // 该老师所有课程的课时费
    const rateLinks = await this.prisma.courseInstructor.findMany({
      where: { instructorId: id },
      select: { courseId: true, hourlyRateCents: true },
    });
    const rateMap = new Map(rateLinks.map((r) => [r.courseId, r.hourlyRateCents]));
    const defaultRateFor = (format: string): number | null => {
      if (format === 'PRIVATE') return instructor.defaultPrivateRateCents;
      if (format === 'MASTER') return instructor.defaultMasterRateCents;
      return instructor.defaultGroupRateCents;
    };
    const rateFor = (courseId: string, format: string): number | null => {
      const specific = rateMap.get(courseId);
      if (specific != null) return specific;
      return defaultRateFor(format);
    };
    const sessions = await this.prisma.classSession.findMany({
      where: {
        instructorId: id,
        ...(termId ? { course: { termId } } : {}),
      },
      select: {
        id: true,
        course: {
          select: {
            id: true,
            title: true,
            format: true,
            term: { select: { id: true, name: true } },
          },
        },
        occurrences: {
          select: {
            id: true,
            date: true,
            status: true,
            timeRange: true,
            substituteInstructorId: true,
          },
        },
        _count: { select: { enrollments: true } },
      },
    });
    // 按学期聚合
    const byTerm = new Map<string, { termId: string; termName: string; sessions: number; occurrences: number; students: number }>();
    for (const sess of sessions) {
      const termId = sess.course.term?.id ?? 'no-term';
      const termName = sess.course.term?.name ?? '未分学期';
      if (!byTerm.has(termId)) {
        byTerm.set(termId, { termId, termName, sessions: 0, occurrences: 0, students: 0 });
      }
      const g = byTerm.get(termId)!;
      g.sessions += 1;
      g.occurrences += sess.occurrences.length;
      g.students += sess._count.enrollments;
    }
    // 打卡数（实际授课）
    const checkinCount = await this.prisma.instructorCheckin.count({
      where: { instructorId: id },
    });
    // 按月统计课时（小时）：解析 timeRange，如 "17:00-18:00" = 1 小时；解析失败按 1 小时
    // 同时按课程统计薪资：hours × rate
    const byMonth = new Map<string, { month: string; sessions: number; hours: number }>();
    const byCoursePay = new Map<string, {
      courseId: string; courseTitle: string; format: string;
      hours: number; rateCents: number | null; payCents: number;
    }>();
    const parseHours = (tr?: string | null): number => {
      if (!tr) return 1;
      const m = tr.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      if (!m) return 1;
      const start = parseInt(m[1]) * 60 + parseInt(m[2]);
      const end = parseInt(m[3]) * 60 + parseInt(m[4]);
      const diff = end - start;
      return diff > 0 ? diff / 60 : 1;
    };
    for (const sess of sessions) {
      const rate = rateFor(sess.course.id, sess.course.format);
      const hrs = sess.occurrences
        .filter((occ) => occ.status !== 'CANCELLED' && !occ.substituteInstructorId)
        .reduce((sum, occ) => sum + parseHours(occ.timeRange), 0);
      for (const occ of sess.occurrences) {
        if (occ.status === 'CANCELLED') continue;
        // 有代课老师的课次不计入原老师课时（计入代课老师）
        if (occ.substituteInstructorId) continue;
        const month = new Date(occ.date).toISOString().slice(0, 7); // YYYY-MM
        if (!byMonth.has(month)) byMonth.set(month, { month, sessions: 0, hours: 0 });
        const g = byMonth.get(month)!;
        g.sessions += 1;
        g.hours += parseHours(occ.timeRange);
      }
      // 按课程累加薪资
      if (hrs > 0) {
        if (!byCoursePay.has(sess.course.id)) {
          byCoursePay.set(sess.course.id, {
            courseId: sess.course.id,
            courseTitle: sess.course.title,
            format: sess.course.format,
            hours: 0,
            rateCents: rate,
            payCents: 0,
          });
        }
        const cp = byCoursePay.get(sess.course.id)!;
        cp.hours += hrs;
        cp.payCents += rate != null ? Math.round(hrs * rate) : 0;
      }
    }
    // 加上该老师代课的课次
    const subOccurrences = await this.prisma.sessionOccurrence.findMany({
      where: {
        substituteInstructorId: id,
        status: { notIn: ['CANCELLED'] },
        ...(termId
          ? { classSession: { course: { termId } } }
          : {}),
      },
      select: { id: true, date: true, timeRange: true },
    });
    let subSessions = 0;
    for (const occ of subOccurrences) {
      const month = new Date(occ.date).toISOString().slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, { month, sessions: 0, hours: 0 });
      const g = byMonth.get(month)!;
      g.sessions += 1;
      g.hours += parseHours(occ.timeRange);
      subSessions += 1;
    }
    const monthly = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
    const payByCourse = [...byCoursePay.values()];
    return {
      byTerm: [...byTerm.values()],
      byMonth: monthly,
      totalSessions: sessions.length,
      totalCheckins: checkinCount,
      totalHours: monthly.reduce((a, b) => a + b.hours, 0),
      substituteSessions: subSessions,
      payByCourse,
      totalPayCents: payByCourse.reduce((a, b) => a + b.payCents, 0),
    };
  }

  /** PATCH /admin/instructors/:id：管理端编辑教师资料 */
  async update(id: string, dto: UpdateInstructorDto) {
    const instructor = await this.prisma.instructor.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!instructor) throw new NotFoundException('教师不存在');
    if (dto.default_campus_id) {
      const campus = await this.prisma.campus.findUnique({
        where: { id: dto.default_campus_id },
        select: { id: true },
      });
      if (!campus) throw new NotFoundException('校区不存在');
    }
    // 同步更新关联 User 的姓名/电话/邮箱/状态
    if (dto.name !== undefined || dto.phone !== undefined || dto.email !== undefined || dto.isActive !== undefined) {
      const inst = await this.prisma.instructor.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (inst) {
        await this.prisma.user.update({
          where: { id: inst.userId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
            ...(dto.email !== undefined ? { email: dto.email } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        });
      }
    }
    return this.prisma.instructor.update({
      where: { id },
      data: {
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
        ...(dto.specialties !== undefined
          ? { specialties: dto.specialties }
          : {}),
        ...(dto.default_campus_id !== undefined
          ? { defaultCampusId: dto.default_campus_id || null }
          : {}),
        ...(dto.availableWeekdays !== undefined
          ? { availableWeekdays: dto.availableWeekdays }
          : {}),
        ...(dto.defaultGroupRateCents !== undefined
          ? { defaultGroupRateCents: dto.defaultGroupRateCents }
          : {}),
        ...(dto.defaultPrivateRateCents !== undefined
          ? { defaultPrivateRateCents: dto.defaultPrivateRateCents }
          : {}),
        ...(dto.defaultMasterRateCents !== undefined
          ? { defaultMasterRateCents: dto.defaultMasterRateCents }
          : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        defaultCampus: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * POST /admin/course-sessions/:id/assign-instructor：
   * 将教师分配/重新分配到某个班级，并发 INSTRUCTOR_ASSIGNMENT 通知。
   */
  async assignInstructor(sessionId: string, dto: AssignInstructorDto) {
    const session = await this.prisma.classSession.findUnique({
      where: { id: sessionId },
      include: { course: { select: { id: true, title: true } } },
    });
    if (!session) throw new NotFoundException('班级不存在');
    const instructor = await this.prisma.instructor.findUnique({
      where: { id: dto.instructor_id },
      select: { id: true, userId: true },
    });
    if (!instructor) throw new NotFoundException('教师不存在');
    const updated = await this.prisma.classSession.update({
      where: { id: sessionId },
      data: { instructorId: instructor.id },
    });
    await this.notifications.notify({
      userId: instructor.userId,
      type: NotificationType.INSTRUCTOR_ASSIGNMENT,
      title: '课程分配更新',
      body: `你被分配到《${session.course.title}》任教。`,
      sourceType: NotificationSourceType.COURSE,
      sourceId: session.course.id,
    });
    return updated;
  }

  /**
   * 私教老师浏览（GET /instructors/browse，家长 / 成人学员）：
   * [{ id, name, avatarUrl, bio, specialties, campusName }]，
   * campusName 取 instructor.defaultCampus?.name。
   */
  async browseInstructors() {
    const rows = await this.prisma.instructor.findMany({
      include: {
        user: { select: { name: true, avatarUrl: true } },
        defaultCampus: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((i) => ({
      id: i.id,
      name: i.user.name,
      avatarUrl: i.user.avatarUrl,
      bio: i.bio,
      specialties: i.specialties,
      campusName: i.defaultCampus?.name ?? null,
    }));
  }
}
