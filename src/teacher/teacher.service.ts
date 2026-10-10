import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceStatus,
  CheckInMethod,
  NotificationType,
  UserRole,
} from '@prisma/client';
import { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCourseReviewDto,
  CreateStudentReviewDto,
} from '../reviews/dto/review.dto';
import { ReviewsService } from '../reviews/reviews.service';

/**
 * 教师端服务（§6.19/6.20/6.21）：教师只能查看/操作自己任教的班级
 * （SessionOccurrence → ClassSession.instructorId 必须等于当前用户的 Instructor.id，否则 403）。
 */
@Injectable()
export class TeacherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: ReviewsService,
  ) {}

  /** 取当前用户的 Instructor 记录；非教师抛 403 */
  private async requireInstructor(userId: string) {
    const instructor = await this.prisma.instructor.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });
    if (!instructor) throw new ForbiddenException('当前用户不是教师');
    return instructor;
  }

  /** 课次归属校验：occurrence → classSession.instructorId 必须是自己，否则 403 */
  private async requireOwnOccurrence(occurrenceId: string, instructorId: string) {
    const occurrence = await this.prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { classSession: true },
    });
    if (!occurrence) throw new NotFoundException('课次不存在');
    if (occurrence.classSession.instructorId !== instructorId) {
      throw new ForbiddenException('只能操作自己任教班级的课次');
    }
    return occurrence;
  }

  // ----------------------------------------------------------------- 资料

  /** GET /me/instructor/profile */
  async profile(userId: string) {
    return this.requireInstructor(userId);
  }

  /** PATCH /me/instructor/profile：{ bio, avatar_url }（头像写 User.avatarUrl） */
  async updateProfile(
    userId: string,
    dto: { bio?: string; avatar_url?: string },
  ) {
    const instructor = await this.requireInstructor(userId);
    const [updated] = await this.prisma.$transaction([
      this.prisma.instructor.update({
        where: { id: instructor.id },
        data: { bio: dto.bio },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl: dto.avatar_url },
      }),
    ]);
    return updated;
  }

  // ----------------------------------------------------------------- 班级

  /** GET /me/instructor/classes：我教的班级（含成员名单） */
  async classes(userId: string) {
    const instructor = await this.requireInstructor(userId);
    return this.prisma.classSession.findMany({
      where: { instructorId: instructor.id },
      include: {
        course: { select: { id: true, title: true, format: true } },
        campus: { select: { id: true, name: true } },
        enrollments: {
          where: { status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
          include: {
            student: {
              select: { id: true, name: true, photoUrl: true },
            },
          },
          orderBy: { enrolledAt: 'asc' },
        },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  /** GET /me/instructor/parents：我任教班级学员的家长（去重，附学员名） */
  async parents(userId: string) {
    const instructor = await this.requireInstructor(userId);
    const sessions = await this.prisma.classSession.findMany({
      where: { instructorId: instructor.id },
      include: {
        enrollments: {
          where: { status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
          include: {
            student: {
              select: {
                id: true,
                name: true,
                parentLinks: {
                  include: {
                    parent: {
                      select: { id: true, name: true, role: true, isActive: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const map = new Map<string, { id: string; name: string; students: string[] }>();
    for (const s of sessions) {
      for (const e of s.enrollments) {
        for (const link of e.student.parentLinks) {
          const p = link.parent;
          if (p.role !== UserRole.PARENT || !p.isActive) continue;
          const entry = map.get(p.id) ?? { id: p.id, name: p.name, students: [] as string[] };
          if (!entry.students.includes(e.student.name)) entry.students.push(e.student.name);
          map.set(p.id, entry);
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  /** GET /me/instructor/substitutes：我代课的课次 */
  async substitutes(userId: string) {
    const instructor = await this.requireInstructor(userId);
    const rows = await this.prisma.sessionOccurrence.findMany({
      where: {
        substituteInstructorId: instructor.id,
        status: { notIn: ['CANCELLED'] },
      },
      include: {
        classSession: {
          include: {
            course: { select: { id: true, title: true, format: true } },
            campus: { select: { id: true, name: true } },
            instructor: {
              include: {
                user: { select: { name: true, phone: true, email: true } },
              },
            },
            enrollments: {
              where: { status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
              include: {
                student: { select: { id: true, name: true, photoUrl: true } },
              },
            },
          },
        },
        substituteInstructor: { include: { user: { select: { name: true } } } },
      },
      orderBy: { date: 'asc' },
    });
    return rows.map((o) => ({
      ...o,
      originalInstructor: o.classSession.instructor
        ? {
            name: o.classSession.instructor.user.name,
            phone: o.classSession.instructor.user.phone,
            email: o.classSession.instructor.user.email,
          }
        : null,
    }));
  }

  /** GET /me/instructor/extra-lessons：我的 1对1/group 私课安排 */
  async extraLessons(userId: string) {
    const instructor = await this.requireInstructor(userId);
    return this.prisma.extraLessonRequest.findMany({
      where: { instructorId: instructor.id },
      include: {
        student: { select: { id: true, name: true, photoUrl: true } },
        slots: { orderBy: { date: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ----------------------------------------------------------------- 点名

  /**
   * POST /me/instructor/occurrences/:id/check-in：教师点名。
   * 生成/更新 checkInMethod=INSTRUCTOR、status=CONFIRMED 的 AttendanceRecord。
   */
  async checkIn(
    userId: string,
    occurrenceId: string,
    enrollmentId: string,
    status?: 'PRESENT' | 'ABSENT',
  ) {
    const instructor = await this.requireInstructor(userId);
    const occurrence = await this.requireOwnOccurrence(
      occurrenceId,
      instructor.id,
    );
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment) {
      throw new BadRequestException('报名记录不存在');
    }
    // 补课放行：本班报名直接过；跨班则需有指向本课次的有效补课预约
    let makeupBookingId: string | null = null;
    if (enrollment.classSessionId !== occurrence.classSessionId) {
      const booking = await this.prisma.makeupBooking.findFirst({
        where: {
          enrollmentId,
          makeupOccurrenceId: occurrenceId,
          status: { in: ['BOOKED', 'ATTENDED'] },
        },
      });
      if (!booking) {
        throw new BadRequestException('报名记录与本节课不匹配');
      }
      makeupBookingId = booking.id;
    }
    const targetStatus =
      status === 'ABSENT' ? AttendanceStatus.ABSENT : AttendanceStatus.CONFIRMED;
    const record = await this.prisma.attendanceRecord.upsert({
      where: {
        sessionOccurrenceId_enrollmentId: {
          sessionOccurrenceId: occurrenceId,
          enrollmentId,
        },
      },
      update: {
        checkInMethod: CheckInMethod.INSTRUCTOR,
        status: targetStatus,
        confirmedById: userId,
        confirmedAt: new Date(),
      },
      create: {
        sessionOccurrenceId: occurrenceId,
        enrollmentId,
        checkInMethod: CheckInMethod.INSTRUCTOR,
        status: targetStatus,
        confirmedById: userId,
        confirmedAt: new Date(),
      },
    });
    // 补课点名成功且到场：BOOKED 的预约顺手标为 ATTENDED
    if (makeupBookingId && targetStatus === AttendanceStatus.CONFIRMED) {
      await this.prisma.makeupBooking.updateMany({
        where: { id: makeupBookingId, status: 'BOOKED' },
        data: { status: 'ATTENDED' },
      });
    }
    return record;
  }

  /**
   * POST /me/instructor/occurrences/:id/check-in/batch：一键全员点名。
   * 复用单个点名逻辑（含补课放行、归属校验），单个失败不影响其他。
   */

  async checkInBatch(
    userId: string,
    occurrenceId: string,
    studentIds: string[],
  ): Promise<{
    success: string[];
    failed: { studentId: string; reason: string }[];
  }> {
    const instructor = await this.requireInstructor(userId);
    const occurrence = await this.requireOwnOccurrence(
      occurrenceId,
      instructor.id,
    );
    const success: string[] = [];
    const failed: { studentId: string; reason: string }[] = [];
    for (const studentId of studentIds) {
      try {
        // 先找本班报名
        let enrollment = await this.prisma.enrollment.findFirst({
          where: {
            studentId,
            classSessionId: occurrence.classSessionId,
            status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
          },
        });
        // 没有则找指向本课次的补课预约，用其 enrollment
        if (!enrollment) {
          const booking = await this.prisma.makeupBooking.findFirst({
            where: {
              makeupOccurrenceId: occurrenceId,
              status: { in: ['BOOKED', 'ATTENDED'] },
              enrollment: { studentId },
            },
          });
          if (booking) {
            enrollment = await this.prisma.enrollment.findUnique({
              where: { id: booking.enrollmentId },
            });
          }
        }
        if (!enrollment) {
          failed.push({ studentId, reason: '该学员不在本班且无补课预约' });
          continue;
        }
        await this.checkIn(userId, occurrenceId, enrollment.id, 'PRESENT');
        success.push(studentId);
      } catch (err) {
        failed.push({
          studentId,
          reason: err instanceof Error ? err.message : '点名失败',
        });
      }
    }
    return { success, failed };
  }

  /**
   * GET /me/instructor/sessions/:id/attendance-summary：本班学员出勤汇总。
   * 每学员：已上/缺席/待确认/未上节数 + 每节明细。
   */
  async attendanceSummary(userId: string, sessionId: string) {
    const instructor = await this.requireInstructor(userId);
    const session = await this.prisma.classSession.findUnique({
      where: { id: sessionId },
      include: {
        course: { select: { id: true, title: true, term: { select: { id: true, name: true } } } },
        campus: { select: { id: true, name: true } },
      },
    });
    if (!session) throw new NotFoundException('班级不存在');
    if (session.instructorId !== instructor.id) {
      throw new ForbiddenException('只能查看自己任教的班级');
    }
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        classSessionId: sessionId,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
      },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { enrolledAt: 'asc' },
    });
    const occurrences = await this.prisma.sessionOccurrence.findMany({
      where: { classSessionId: sessionId },
      orderBy: { sessionNumber: 'asc' },
      select: { id: true, sessionNumber: true, date: true, status: true },
    });
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        sessionOccurrenceId: { in: occurrences.map((o) => o.id) },
        enrollmentId: { in: enrollments.map((e) => e.id) },
      },
    });
    const byKey = new Map(records.map((r) => [`${r.enrollmentId}:${r.sessionOccurrenceId}`, r.status]));
    const students = enrollments.map((e) => {
      let confirmed = 0;
      let absent = 0;
      let pending = 0;
      const detail = occurrences.map((o) => {
        const st = byKey.get(`${e.id}:${o.id}`) ?? null;
        if (st === 'CONFIRMED') confirmed++;
        else if (st === 'ABSENT') absent++;
        else if (st === 'PENDING_CONFIRMATION') pending++;
        return {
          occurrenceId: o.id,
          sessionNumber: o.sessionNumber,
          date: o.date,
          occurrenceStatus: o.status,
          attendance: st,
        };
      });
      return {
        enrollmentId: e.id,
        student: e.student,
        confirmed,
        absent,
        pending,
        upcoming: occurrences.length - confirmed - absent - pending,
        total: occurrences.length,
        detail,
      };
    });
    return {
      session: {
        id: session.id,
        course: session.course,
        campus: session.campus,
      },
      students,
    };
  }

  /**
   * GET /me/instructor/occurrences/:id/attendance：本节课出勤名单
   *（已确认 / 待确认 / 未到，含补课学员）。
   */
  async attendance(userId: string, occurrenceId: string) {
    const instructor = await this.requireInstructor(userId);
    const occurrence = await this.requireOwnOccurrence(
      occurrenceId,
      instructor.id,
    );
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        classSessionId: occurrence.classSessionId,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
      },
      include: {
        student: { select: { id: true, name: true, photoUrl: true } },
      },
      orderBy: { enrolledAt: 'asc' },
    });
    const records = await this.prisma.attendanceRecord.findMany({
      where: { sessionOccurrenceId: occurrenceId },
    });
    const recordByEnrollment = new Map(records.map((r) => [r.enrollmentId, r]));
    const confirmed: unknown[] = [];
    const pending: unknown[] = [];
    const absent: unknown[] = [];
    for (const enrollment of enrollments) {
      const record = recordByEnrollment.get(enrollment.id) ?? null;
      const entry = { enrollment, record };
      if (record?.status === AttendanceStatus.CONFIRMED) confirmed.push(entry);
      else if (record?.status === AttendanceStatus.PENDING_CONFIRMATION)
        pending.push(entry);
      else absent.push(entry); // 含 ABSENT 记录与无记录
    }
    // 补课学员：预约到本节课的 MakeupBooking
    const makeup = await this.prisma.makeupBooking.findMany({
      where: { makeupOccurrenceId: occurrenceId },
      include: {
        enrollment: {
          include: {
            student: { select: { id: true, name: true, photoUrl: true } },
          },
        },
        missedOccurrence: {
          select: { id: true, sessionNumber: true, date: true },
        },
      },
    });
    return {
      occurrence: {
        id: occurrence.id,
        session_number: occurrence.sessionNumber,
        date: occurrence.date,
        status: occurrence.status,
      },
      confirmed,
      pending,
      absent,
      makeup,
    };
  }

  // ----------------------------------------------------------------- 通知

  /** GET /me/instructor/notifications：等价于 type=INSTRUCTOR_ASSIGNMENT 过滤 */
  async notifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId, type: NotificationType.INSTRUCTOR_ASSIGNMENT },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ----------------------------------------------------------------- 评价

  /** POST /me/instructor/courses/:id/reviews（同 6.13，教师只能给自己课写） */
  async createCourseReview(
    requester: RequestUser,
    courseId: string,
    dto: CreateCourseReviewDto,
  ) {
    const instructor = await this.requireInstructor(requester.id);
    return this.reviews.createCourseReview(
      requester,
      courseId,
      dto,
      instructor.id,
    );
  }

  /** POST /me/instructor/students/:id/reviews（同 6.14，教师只能给自己课的学生写） */
  async createStudentReview(
    requester: RequestUser,
    studentId: string,
    dto: CreateStudentReviewDto,
  ) {
    const instructor = await this.requireInstructor(requester.id);
    return this.reviews.createStudentReview(
      requester,
      studentId,
      dto,
      instructor.id,
    );
  }

  /** GET /me/instructor/reviews：当前老师发布过的评价历史（课程评价+学员评价合并，倒序，最多 50 条） */
  async myReviews(userId: string) {
    const [courseReviews, studentReviews] = await Promise.all([
      this.prisma.courseReview.findMany({
        where: { createdById: userId },
        include: { course: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.studentReview.findMany({
        where: { createdById: userId },
        include: {
          student: { select: { id: true, name: true } },
          classSession: {
            include: { course: { select: { id: true, title: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return [
      ...courseReviews.map((r) => ({
        kind: 'COURSE' as const,
        id: r.id,
        content: r.content,
        createdAt: r.createdAt,
        course: r.course,
        student: null,
      })),
      ...studentReviews.map((r) => ({
        kind: 'STUDENT' as const,
        id: r.id,
        content: r.content,
        createdAt: r.createdAt,
        course: r.classSession.course,
        student: r.student,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);
  }

  // ------------------------------------------------------------- 照片上传

  /**
   * POST /me/students/:id/photo（§6.21）：家长为孩子上传照片，写 Student.photoUrl。
   * 校验亲子关系（管理员可代操作）。
   */
  async uploadStudentPhoto(
    requester: RequestUser,
    studentId: string,
    filename: string,
  ) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('学员不存在');
    if (requester.role !== UserRole.ADMIN) {
      const link = await this.prisma.parentStudentLink.findFirst({
        where: { parentId: requester.id, studentId },
        select: { id: true },
      });
      if (!link) throw new ForbiddenException('只能为自己（或孩子）上传照片');
    }
    return this.prisma.student.update({
      where: { id: studentId },
      data: { photoUrl: `uploads/${filename}` },
      select: { id: true, name: true, photoUrl: true },
    });
  }

  /** POST /me/avatar（§6.21）：写 User.avatarUrl */
  async uploadAvatar(userId: string, filename: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: `uploads/${filename}` },
      select: { id: true, name: true, avatarUrl: true },
    });
  }
}
