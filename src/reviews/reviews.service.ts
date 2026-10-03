import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationSourceType,
  NotificationType,
} from '@prisma/client';
import { RequestUser } from '../common/types';
import { resolveStudentRecipientUserIds } from '../common/student-recipients';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCourseReviewDto,
  CreateStudentReviewDto,
} from './dto/review.dto';

interface ReviewNotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  sourceType: NotificationSourceType;
  sourceId: string;
}

/**
 * 评价服务（§6.13–6.16）：课程整体要求评价 + 学员个人私密评价。
 * 发布评价后发 REVIEW_PUBLISHED 通知（sourceType=REVIEW）：
 * 课程评价 → 该课已确认学员的家长；个人评价 → 该学员家长/本人。
 * 管理端与教师端共用本 service；教师调用时传入 instructorId 做任教范围校验。
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 向一批学员的首选收件人发送通知（去重） */
  private async notifyStudents(
    studentIds: string[],
    input: ReviewNotifyInput,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const studentId of new Set(studentIds)) {
      const recipientIds = await resolveStudentRecipientUserIds(
        this.prisma,
        studentId,
      );
      for (const userId of recipientIds) {
        if (seen.has(userId)) continue;
        seen.add(userId);
        await this.notifications.notify({ userId, ...input });
      }
    }
  }

  // ------------------------------------------------------------ 课程评价

  /**
   * 发布课程整体要求评价（§6.13）。instructorId 非空时为教师端调用，
   * 仅允许给自己任教的课程（ClassSession.instructorId 或 CourseInstructor）写评价。
   */
  async createCourseReview(
    requester: RequestUser,
    courseId: string,
    dto: CreateCourseReviewDto,
    instructorId?: string,
  ) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('课程不存在');
    if (instructorId) {
      const teaches =
        (await this.prisma.classSession.findFirst({
          where: { courseId, instructorId },
          select: { id: true },
        })) ??
        (await this.prisma.courseInstructor.findUnique({
          where: { courseId_instructorId: { courseId, instructorId } },
        }));
      if (!teaches) throw new ForbiddenException('只能为自己任教的课程发布评价');
    }
    const review = await this.prisma.courseReview.create({
      data: {
        courseId,
        content: dto.content,
        createdById: requester.id,
      },
    });
    // 该课程下所有已确认报名的学员 → 家长
    const enrollments = await this.prisma.enrollment.findMany({
      where: { status: 'CONFIRMED', classSession: { courseId } },
      select: { studentId: true },
    });
    await this.notifyStudents(
      enrollments.map((e) => e.studentId),
      {
        type: NotificationType.REVIEW_PUBLISHED,
        title: '课程评价更新',
        body: `《${course.title}》发布了新的课程整体要求评价，请查看。`,
        sourceType: NotificationSourceType.REVIEW,
        sourceId: review.id,
      },
    );
    return review;
  }

  /**
   * 查看课程评价流（§6.16 GET /courses/:id/reviews）：
   * 该课程下有已确认报名的学员/家长可见；管理员与任教教师可见。
   */
  async listCourseReviews(requester: RequestUser, courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) throw new NotFoundException('课程不存在');
    if (requester.role !== 'ADMIN') {
      const links = await this.prisma.parentStudentLink.findMany({
        where: { parentId: requester.id },
        select: { studentId: true },
      });
      const studentIds = links.map((l) => l.studentId);
      const enrolled =
        studentIds.length > 0
          ? await this.prisma.enrollment.findFirst({
              where: {
                studentId: { in: studentIds },
                status: 'CONFIRMED',
                classSession: { courseId },
              },
              select: { id: true },
            })
          : null;
      let teaches = false;
      if (!enrolled && requester.role === 'INSTRUCTOR') {
        const instructor = await this.prisma.instructor.findUnique({
          where: { userId: requester.id },
          select: { id: true },
        });
        if (instructor) {
          teaches = !!(
            (await this.prisma.classSession.findFirst({
              where: { courseId, instructorId: instructor.id },
              select: { id: true },
            })) ??
            (await this.prisma.courseInstructor.findUnique({
              where: {
                courseId_instructorId: {
                  courseId,
                  instructorId: instructor.id,
                },
              },
            }))
          );
        }
      }
      if (!enrolled && !teaches) {
        throw new ForbiddenException('无权查看该课程的评价');
      }
    }
    return this.prisma.courseReview.findMany({
      where: { courseId },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ------------------------------------------------------------ 个人评价

  /**
   * 发布学员个人评价（§6.14，私密）。instructorId 非空时为教师端调用，
   * 仅允许给自己班级（SessionOccurrence→ClassSession.instructorId 即自己）的学生写。
   */
  async createStudentReview(
    requester: RequestUser,
    studentId: string,
    dto: CreateStudentReviewDto,
    instructorId?: string,
  ) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (!student) throw new NotFoundException('学员不存在');
    const session = await this.prisma.classSession.findUnique({
      where: { id: dto.class_session_id },
      include: { course: { select: { title: true } } },
    });
    if (!session) throw new NotFoundException('班级不存在');
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        classSessionId: session.id,
        studentId,
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
      select: { id: true },
    });
    if (!enrollment) {
      throw new BadRequestException('该学员未报名此班级，无法评价');
    }
    if (instructorId && session.instructorId !== instructorId) {
      throw new ForbiddenException('只能为自己任教班级的学生写评价');
    }
    const review = await this.prisma.studentReview.create({
      data: {
        classSessionId: session.id,
        studentId,
        content: dto.content,
        createdById: requester.id,
      },
    });
    await this.notifyStudents(
      [studentId],
      {
        type: NotificationType.REVIEW_PUBLISHED,
        title: '新的学员评价',
        body: `${student.name} 在《${session.course.title}》有一条新的个人评价，请查看。`,
        sourceType: NotificationSourceType.REVIEW,
        sourceId: review.id,
      },
    );
    return review;
  }

  /**
   * 学员/家长查看自己（孩子）的个人评价（§6.16）：
   * 仅该学员本人（或其监护家长）可见；course_id 可选过滤。
   */
  async myStudentReviews(
    requester: RequestUser,
    studentId: string,
    courseId?: string,
  ) {
    if (requester.role !== 'ADMIN') {
      const link = await this.prisma.parentStudentLink.findFirst({
        where: { parentId: requester.id, studentId },
        select: { id: true },
      });
      if (!link) throw new ForbiddenException('无权查看该学员的评价');
    }
    return this.prisma.studentReview.findMany({
      where: {
        studentId,
        ...(courseId ? { classSession: { courseId } } : {}),
      },
      include: {
        classSession: {
          select: {
            id: true,
            course: { select: { id: true, title: true } },
          },
        },
        createdBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
