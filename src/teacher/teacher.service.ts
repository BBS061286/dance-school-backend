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
  async updateProfile(userId: string, dto: { bio: string; avatar_url: string }) {
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
    if (!enrollment || enrollment.classSessionId !== occurrence.classSessionId) {
      throw new BadRequestException('报名记录与本节课不匹配');
    }
    const targetStatus =
      status === 'ABSENT' ? AttendanceStatus.ABSENT : AttendanceStatus.CONFIRMED;
    return this.prisma.attendanceRecord.upsert({
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
