import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExtraLessonAudience,
  ExtraLessonSlotStatus,
  ExtraLessonType,
  NotificationSourceType,
  NotificationType,
} from '@prisma/client';
import { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AdminCreateExtraLessonRequestDto,
  AdminExtraLessonRequestsQuery,
  AdminExtraLessonSlotsQuery,
  CreateExtraLessonRequestDto,
  ExtraLessonSlotInput,
  ProposeAltDto,
  RescheduleDto,
  ReviewSlotDto,
} from './dto/extra-lessons.dto';

/** §6.9 学员端状态映射文案（每次状态变更通知使用） */
const STATUS_COPY: Record<ExtraLessonSlotStatus, (slot: any) => string> = {
  PENDING_ADMIN: () => '已提交，等待老师/管理员确认',
  ADMIN_PROPOSED_ALT: (slot) =>
    `管理员建议改期到 ${fmtDate(slot.altDate)} ${slot.altTime ?? ''}，请确认是否同意`,
  PENDING_STUDENT: () => '等待你确认新时间',
  CONFIRMED: () => '已确认，请按时到场',
  DECLINED: () => '该时段未通过，请重新选择时间',
};

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

function parseDate(s: string, field: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`日期格式非法：${field}=${s}`);
  }
  return d;
}

@Injectable()
export class ExtraLessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- 申请单

  /**
   * 学员/家长发起加课申请（initiatedBy=STUDENT）。
   * student_id 必填（§6.8），且必须属于当前用户或其孩子。
   */
  async createRequest(user: RequestUser, dto: CreateExtraLessonRequestDto) {
    await this.assertStudentAccessible(user, dto.student_id);
    return this.createRequestCore(
      {
        type: dto.type,
        studentId: dto.student_id,
        instructorId: null,
        content: dto.content,
        location: dto.location,
        slots: dto.slots,
      },
      'STUDENT',
      user.id,
    );
  }

  /**
   * 管理员发起加课邀请（initiatedBy=ADMIN）：student_id 必填，
   * 可按需指定 instructor_id（§6.17）。
   */
  async adminCreateRequest(
    adminId: string,
    dto: AdminCreateExtraLessonRequestDto,
  ) {
    const student = await this.prisma.student.findUnique({
      where: { id: dto.student_id },
    });
    if (!student) throw new NotFoundException(`学员不存在：${dto.student_id}`);
    if (dto.instructor_id) {
      const instructor = await this.prisma.instructor.findUnique({
        where: { id: dto.instructor_id },
      });
      if (!instructor) {
        throw new NotFoundException(`教师不存在：${dto.instructor_id}`);
      }
    }
    return this.createRequestCore(
      {
        type: dto.type,
        studentId: dto.student_id,
        instructorId: dto.instructor_id ?? null,
        content: dto.content,
        location: dto.location,
        slots: dto.slots,
      },
      'ADMIN',
      adminId,
    );
  }

  private async createRequestCore(
    input: {
      type: ExtraLessonType;
      studentId: string;
      instructorId: string | null;
      content?: string;
      location?: string;
      slots: ExtraLessonSlotInput[];
    },
    initiatedBy: 'STUDENT' | 'ADMIN',
    createdById: string,
  ) {
    const audience = await this.deriveAudience(input.studentId);
    return this.prisma.extraLessonRequest.create({
      data: {
        type: input.type,
        studentId: input.studentId,
        audience,
        content: input.content ?? null,
        location: input.location ?? null,
        initiatedBy,
        instructorId: input.instructorId,
        createdById,
        slots: {
          create: input.slots.map((s) => ({
            date: parseDate(s.date, 'date'),
            time: s.time,
            status: 'PENDING_ADMIN',
          })),
        },
      },
      include: { slots: true },
    });
  }

  /** 我的加课申请：我发起的，或针对我（绑定的孩子）的 */
  async myRequests(user: RequestUser) {
    const links = await this.prisma.parentStudentLink.findMany({
      where: { parentId: user.id },
      select: { studentId: true },
    });
    const studentIds = links.map((l) => l.studentId);
    return this.prisma.extraLessonRequest.findMany({
      where: {
        OR: [{ createdById: user.id }, { studentId: { in: studentIds } }],
      },
      include: {
        slots: { orderBy: { date: 'asc' } },
        student: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 管理端加课申请列表：按 audience 过滤；status 按"申请单下有该状态的时段"过滤
   *（申请单本身无整体状态，每个时段独立走审批流程，见 §6.9）。
   */
  async adminListRequests(query: AdminExtraLessonRequestsQuery & { status?: ExtraLessonSlotStatus }) {
    return this.prisma.extraLessonRequest.findMany({
      where: {
        ...(query.audience ? { audience: query.audience } : {}),
        ...(query.status
          ? { slots: { some: { status: query.status } } }
          : {}),
      },
      include: {
        slots: { orderBy: { date: 'asc' } },
        student: { select: { id: true, name: true } },
        instructor: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 私课查询：按 type / status / audience 分开展示（ADMIN） */
  async adminListSlots(query: AdminExtraLessonSlotsQuery) {
    return this.prisma.extraLessonSlot.findMany({
      where: {
        ...(query.type ? { request: { type: query.type } } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.audience ? { request: { audience: query.audience } } : {}),
      },
      include: {
        request: {
          include: {
            student: { select: { id: true, name: true } },
            instructor: {
              include: { user: { select: { id: true, name: true } } },
            },
          },
        },
      },
      orderBy: { date: 'asc' },
    });
  }

  // ---------------------------------------------------------------- 时段审批

  /** 直接批准该时段 → CONFIRMED（ADMIN） */
  async approveSlot(adminId: string, slotId: string) {
    const slot = await this.loadSlot(slotId);
    this.assertTransitionAllowed(slot.status, 'approve');
    const updated = await this.prisma.extraLessonSlot.update({
      where: { id: slotId },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
      include: { request: true },
    });
    await this.notifySlotStatus(updated);
    return updated;
  }

  /**
   * 建议新时间（仅 ONE_ON_ONE）→ ADMIN_PROPOSED_ALT。
   * admin_note 可选，写入申请单的 adminNote。
   */
  async proposeAlt(adminId: string, slotId: string, dto: ProposeAltDto) {
    const slot = await this.loadSlot(slotId);
    if (slot.request.type !== 'ONE_ON_ONE') {
      throw new BadRequestException('建议新时间仅适用于 1 对 1 加课');
    }
    this.assertTransitionAllowed(slot.status, 'propose-alt');
    const updated = await this.prisma.$transaction(async (tx) => {
      const s = await tx.extraLessonSlot.update({
        where: { id: slotId },
        data: {
          status: 'ADMIN_PROPOSED_ALT',
          altDate: parseDate(dto.alt_date, 'alt_date'),
          altTime: dto.alt_time,
        },
        include: { request: true },
      });
      if (dto.admin_note) {
        await tx.extraLessonRequest.update({
          where: { id: s.requestId },
          data: { adminNote: dto.admin_note },
        });
      }
      return s;
    });
    await this.notifySlotStatus(updated);
    return updated;
  }

  /** 直接改期（仅 TEMP_GROUP）：更新日期时间 → CONFIRMED（ADMIN） */
  async reschedule(adminId: string, slotId: string, dto: RescheduleDto) {
    const slot = await this.loadSlot(slotId);
    if (slot.request.type !== 'TEMP_GROUP') {
      throw new BadRequestException('直接改期仅适用于临时 group 加课');
    }
    this.assertTransitionAllowed(slot.status, 'reschedule');
    const updated = await this.prisma.extraLessonSlot.update({
      where: { id: slotId },
      data: {
        status: 'CONFIRMED',
        date: parseDate(dto.new_date, 'new_date'),
        time: dto.new_time,
        altDate: null,
        altTime: null,
        confirmedAt: new Date(),
      },
      include: { request: true },
    });
    await this.notifySlotStatus(updated);
    return updated;
  }

  /** 管理员直接取消该时段 → DECLINED */
  /** 更换临约私教的老师：PATCH /admin/extra-lesson-requests/:id/instructor */
  async reassignInstructor(requestId: string, instructorId: string) {
    const request = await this.prisma.extraLessonRequest.findUnique({
      where: { id: requestId },
      include: { student: { select: { name: true } } },
    });
    if (!request) throw new NotFoundException('私教单不存在');
    const instructor = await this.prisma.instructor.findUnique({
      where: { id: instructorId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!instructor) throw new NotFoundException('老师不存在');
    const updated = await this.prisma.extraLessonRequest.update({
      where: { id: requestId },
      data: { instructorId },
      include: {
        instructor: { include: { user: { select: { name: true } } } },
        student: { select: { name: true } },
      },
    });
    // 通知新老师
    try {
      await this.prisma.notification.create({
        data: {
          userId: instructor.user.id,
          type: 'CLASS_REMINDER',
          title: '私教单转派通知',
          body: `学员 ${request.student.name} 的私教单已转派给您`,
          sourceType: 'COURSE',
          sourceId: requestId,
          channels: ['IN_APP'],
        },
      });
    } catch {
      /* 忽略 */
    }
    return updated;
  }

  /** 通过加课申请 → APPROVED，通知老师去排时段 */
  async approveRequest(requestId: string) {
    const request = await this.prisma.extraLessonRequest.findUnique({
      where: { id: requestId },
      include: {
        student: { select: { name: true } },
        instructor: { include: { user: { select: { id: true, name: true } } } },
      },
    });
    if (!request) throw new NotFoundException('私教单不存在');
    if (request.status !== 'PENDING')
      throw new BadRequestException('该申请已处理，无需重复审批');

    const updated = await this.prisma.extraLessonRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED' },
    });

    // 通知老师去排时段
    if (request.instructor?.user?.id) {
      try {
        await this.prisma.notification.create({
          data: {
            userId: request.instructor.user.id,
            type: 'EXTRA_LESSON_UPDATE',
            title: '加课申请已通过',
            body: `学员 ${request.student.name} 的加课申请已通过，请尽快安排私教时段`,
            sourceType: 'EXTRA_LESSON_SLOT',
            sourceId: requestId,
            channels: ['IN_APP'],
          },
        });
      } catch { /* 忽略 */ }
    }
    return updated;
  }

  /** 拒绝加课申请 → REJECTED，通知家长/学员 */
  async rejectRequest(requestId: string, reason: string) {
    const request = await this.prisma.extraLessonRequest.findUnique({
      where: { id: requestId },
      include: {
        student: {
          select: {
            name: true,
            parentLinks: {
              include: { parent: { select: { id: true } } },
              take: 1,
            },
          },
        },
      },
    });
    if (!request) throw new NotFoundException('私教单不存在');
    if (request.status !== 'PENDING')
      throw new BadRequestException('该申请已处理，无需重复审批');
    if (!reason?.trim()) throw new BadRequestException('请填写拒绝原因');

    const updated = await this.prisma.extraLessonRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', adminNote: reason.trim() },
    });

    // 通知家长（首个关联家长）
    const parentId = request.student.parentLinks[0]?.parent?.id;
    if (parentId) {
      try {
        await this.prisma.notification.create({
          data: {
            userId: parentId,
            type: 'EXTRA_LESSON_UPDATE',
            title: '加课申请未通过',
            body: `学员 ${request.student.name} 的加课申请未通过：${reason.trim()}`,
            sourceType: 'EXTRA_LESSON_SLOT',
            sourceId: requestId,
            channels: ['IN_APP'],
          },
        });
      } catch { /* 忽略 */ }
    }
    return updated;
  }

  /** 管理员直接排课：创建时段 → 请求进入 IN_PROGRESS */
  async adminCreateSlots(
    requestId: string,
    slots: Array<{ date: string; time: string }>,
  ) {
    const request = await this.prisma.extraLessonRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('私教单不存在');
    if (!slots?.length) throw new BadRequestException('请至少添加一个时段');

    await this.prisma.$transaction(
      slots.map((sl) =>
        this.prisma.extraLessonSlot.create({
          data: {
            requestId,
            date: new Date(sl.date),
            time: sl.time,
            status: 'PENDING_ADMIN',
          },
        }),
      ),
    );
    return this.prisma.extraLessonRequest.update({
      where: { id: requestId },
      data: { status: 'IN_PROGRESS' },
    });
  }

  async cancelSlot(adminId: string, slotId: string) {
    const slot = await this.loadSlot(slotId);
    this.assertTransitionAllowed(slot.status, 'cancel');
    const updated = await this.prisma.extraLessonSlot.update({
      where: { id: slotId },
      data: { status: 'DECLINED' },
      include: { request: true },
    });
    await this.notifySlotStatus(updated);
    return updated;
  }

  /**
   * 学员/家长确认时段 → CONFIRMED。
   * 允许状态：ADMIN_PROPOSED_ALT（接受管理员建议的新时间：把 alt 写入正式时间）
   * 或 PENDING_STUDENT。TEMP_GROUP 不会出现这两种状态（管理员单方面决定）。
   */
  async acceptSlot(user: RequestUser, slotId: string) {
    const slot = await this.loadSlot(slotId);
    await this.assertSlotAccessible(user, slot);
    if (
      slot.status !== 'ADMIN_PROPOSED_ALT' &&
      slot.status !== 'PENDING_STUDENT'
    ) {
      throw new ConflictException('该时段当前无需学员确认');
    }
    const updated = await this.prisma.extraLessonSlot.update({
      where: { id: slotId },
      data: {
        status: 'CONFIRMED',
        ...(slot.status === 'ADMIN_PROPOSED_ALT' && slot.altDate
          ? {
              date: slot.altDate,
              time: slot.altTime ?? slot.time,
              altDate: null,
              altTime: null,
            }
          : {}),
        confirmedAt: new Date(),
      },
      include: { request: true },
    });
    await this.notifySlotStatus(updated);
    return updated;
  }

  /** 学员/家长拒绝时段 → DECLINED */
  async declineSlot(user: RequestUser, slotId: string) {
    const slot = await this.loadSlot(slotId);
    await this.assertSlotAccessible(user, slot);
    if (
      slot.status === 'CONFIRMED' ||
      slot.status === 'DECLINED'
    ) {
      throw new ConflictException('该时段已终态，无法拒绝');
    }
    const updated = await this.prisma.extraLessonSlot.update({
      where: { id: slotId },
      data: { status: 'DECLINED' },
      include: { request: true },
    });
    await this.notifySlotStatus(updated);
    return updated;
  }

  /** 写加课评价（§6.15）：reviewContent / reviewedAt，仅该学员可见（ADMIN） */
  async reviewSlot(adminId: string, slotId: string, dto: ReviewSlotDto) {
    const slot = await this.loadSlot(slotId);
    return this.prisma.extraLessonSlot.update({
      where: { id: slot.id },
      data: { reviewContent: dto.content, reviewedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------- 内部工具

  /**
   * audience 由 student 经 SELF 关系派生（§6.8）：学生有 SELF 绑定
   *（成人学员自己绑定自己）→ ADULT，否则 → YOUTH。
   */
  private async deriveAudience(studentId: string): Promise<ExtraLessonAudience> {
    const selfLink = await this.prisma.parentStudentLink.findFirst({
      where: { studentId, relationship: 'SELF' },
    });
    return selfLink ? 'ADULT' : 'YOUTH';
  }

  private async loadSlot(slotId: string) {
    const slot = await this.prisma.extraLessonSlot.findUnique({
      where: { id: slotId },
      include: { request: true },
    });
    if (!slot) throw new NotFoundException(`加课时段不存在：${slotId}`);
    return slot;
  }

  /** 学员/家长只能操作自己（绑定的孩子）的申请单时段；管理员可操作任意 */
  private async assertSlotAccessible(
    user: RequestUser,
    slot: { request: { studentId: string } },
  ) {
    if (user.role === 'ADMIN') return;
    const link = await this.prisma.parentStudentLink.findUnique({
      where: {
        parentId_studentId: {
          parentId: user.id,
          studentId: slot.request.studentId,
        },
      },
    });
    if (!link) throw new ForbiddenException('无权操作该加课时段');
  }

  /** 学员/家长发起申请时，student_id 必须属于自己或绑定的孩子 */
  private async assertStudentAccessible(user: RequestUser, studentId: string) {
    if (user.role === 'ADMIN') return;
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (!student) throw new NotFoundException(`学员不存在：${studentId}`);
    const link = await this.prisma.parentStudentLink.findUnique({
      where: { parentId_studentId: { parentId: user.id, studentId } },
    });
    if (!link) throw new ForbiddenException('只能为自己或自己绑定的孩子发起加课申请');
  }

  /**
   * 审批状态机校验：终态（CONFIRMED/DECLINED）不可再流转。
   * ONE_ON_ONE 的 propose-alt 只允许在待学员确认前，TEMP_GROUP 无
   * ADMIN_PROPOSED_ALT / PENDING_STUDENT 状态（§6.9，管理员单方面决定）。
   */
  private assertTransitionAllowed(
    status: ExtraLessonSlotStatus,
    action: string,
  ) {
    if (status === 'CONFIRMED' || status === 'DECLINED') {
      throw new ConflictException(`该时段已${status === 'CONFIRMED' ? '确认' : '取消'}，无法执行 ${action}`);
    }
  }

  /**
   * 每次状态变更经 NotificationsService 发 EXTRA_LESSON_UPDATE
   *（sourceType=EXTRA_LESSON_SLOT），文案取自 §6.9 学员端映射表。
   * 收件人：该学员的全部监护人 + 申请单创建人。
   */
  private async notifySlotStatus(
    slot: { id: string; status: ExtraLessonSlotStatus; altDate: Date | null; altTime: string | null; request: { type: ExtraLessonType; studentId: string; createdById: string } },
  ) {
    const links = await this.prisma.parentStudentLink.findMany({
      where: { studentId: slot.request.studentId },
      select: { parentId: true },
    });
    const userIds = new Set(links.map((l) => l.parentId));
    userIds.add(slot.request.createdById);

    const typeName = slot.request.type === 'ONE_ON_ONE' ? '1对1加课' : '临时加课';
    const title = `${typeName}时段更新`;
    const body = STATUS_COPY[slot.status](slot);

    for (const userId of userIds) {
      await this.notifications.notify({
        userId,
        type: NotificationType.EXTRA_LESSON_UPDATE,
        title,
        body,
        sourceType: NotificationSourceType.EXTRA_LESSON_SLOT,
        sourceId: slot.id,
      });
    }
  }
}
