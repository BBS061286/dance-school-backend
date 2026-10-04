import {
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
            course: { select: { id: true, title: true, format: true } },
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
    return instructor;
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
    // 同步更新关联 User 的姓名/电话
    if (dto.name !== undefined || dto.phone !== undefined) {
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
