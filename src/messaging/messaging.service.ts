import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationSourceType,
  NotificationType,
  ParticipantRole,
  Relationship,
  SenderRole,
  UserRole,
} from '@prisma/client';
import { CreateTemplateDto, InitiateMessageDto } from './dto/message.dto';
import { RequestUser } from '../common/types';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 私信服务（§6.22/6.23）：一用户可有多条 thread——与管理员一条、与每位老师各一条。
 * peerType=ADMIN（peerId 为空）| INSTRUCTOR（peerId 为老师的 userId）。
 * 管理端回复后向发起方发 MESSAGE_REPLY 通知（sourceType=MESSAGE）。
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 用户角色 → 私信参与方角色；管理员走管理端回复接口 */
  private participantRoleFor(role: UserRole): ParticipantRole {
    switch (role) {
      case UserRole.PARENT:
        return ParticipantRole.PARENT;
      case UserRole.ADULT_STUDENT:
        return ParticipantRole.ADULT_STUDENT;
      case UserRole.INSTRUCTOR:
        return ParticipantRole.INSTRUCTOR;
      default:
        throw new ForbiddenException('管理员请使用管理端回复接口');
    }
  }

  /** 找或建会话（participantId + peerType + peerId 唯一） */
  private async findOrCreateThread(
    participantId: string,
    participantRole: ParticipantRole,
    peerType: string,
    peerId: string | null,
  ) {
    let thread = await this.prisma.messageThread.findFirst({
      where: {
        participantId,
        peerType,
        peerId,
      },
    });
    if (!thread) {
      try {
        thread = await this.prisma.messageThread.create({
          data: { participantId, participantRole, peerType, peerId },
        });
      } catch {
        // 并发建会话时唯一索引冲突，重查一次
        thread = await this.prisma.messageThread.findFirst({
          where: { participantId, peerType, peerId },
        });
        if (!thread) throw new BadRequestException('创建私信会话失败，请重试');
      }
    }
    return thread;
  }

  /**
   * POST /me/messages：发私信。
   * peerType=ADMIN（默认，给管理员）| INSTRUCTOR（给老师，需传 peerId=老师 userId）
   */
  async postMessage(
    user: RequestUser,
    body: string,
    peerType = 'ADMIN',
    peerId: string | null = null,
  ) {
    const participantRole = this.participantRoleFor(user.role);
    if (peerType !== 'ADMIN' && peerType !== 'INSTRUCTOR') {
      throw new BadRequestException('peerType 只能是 ADMIN 或 INSTRUCTOR');
    }
    let notifyUserIds: string[] = [];
    let notifyTitle = '收到一条新私信';

    if (peerType === 'INSTRUCTOR') {
      if (!peerId) throw new BadRequestException('给老师发私信需要指定老师');
      // 只能给自己孩子的任课老师发
      const teachers = await this.messageableTeachers(user.id);
      const target = teachers.find((t) => t.userId === peerId);
      if (!target) throw new ForbiddenException('只能给自己孩子的任课老师发私信');
      notifyUserIds = [peerId];
      const sender = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { name: true },
      });
      notifyTitle = `${sender?.name ?? '家长'}给你发了一条私信`;
    } else {
      peerId = null;
      // 通知所有在职管理员（失败不影响发送）
      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN, isActive: true, id: { not: user.id } },
        select: { id: true },
      });
      notifyUserIds = admins.map((a) => a.id);
    }

    const thread = await this.findOrCreateThread(
      user.id,
      participantRole,
      peerType,
      peerId,
    );
    const message = await this.prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: user.id,
        senderRole: participantRole,
        body,
      },
    });
    await this.prisma.messageThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: message.createdAt },
    });
    try {
      const preview = body.length > 80 ? `${body.slice(0, 80)}…` : body;
      for (const uid of notifyUserIds) {
        await this.notifications.notify({
          userId: uid,
          type: NotificationType.MESSAGE_RECEIVED,
          title: notifyTitle,
          body: preview,
          sourceType: NotificationSourceType.MESSAGE,
          sourceId: message.id,
        });
      }
    } catch {
      // 通知失败不阻塞
    }
    return { thread, message };
  }

  /** 我可联系的老师：孩子已确认报名课程的任课老师（去重） */
  async messageableTeachers(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    // 找到该用户关联的学员 id 列表
    let studentIds: string[] = [];
    if (user.role === UserRole.PARENT) {
      const links = await this.prisma.parentStudentLink.findMany({
        where: { parentId: userId },
        select: { studentId: true },
      });
      studentIds = links.map((l) => l.studentId);
    } else if (user.role === UserRole.ADULT_STUDENT) {
      const links = await this.prisma.parentStudentLink.findMany({
        where: { parentId: userId, relationship: Relationship.SELF },
        select: { studentId: true },
      });
      studentIds = links.map((l) => l.studentId);
    } else {
      return [];
    }
    if (studentIds.length === 0) return [];

    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId: { in: studentIds }, status: 'CONFIRMED' },
      include: {
        classSession: {
          include: {
            course: {
              include: {
                instructors: {
                  include: {
                    instructor: {
                      select: {
                        userId: true,
                        user: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const map = new Map<string, { userId: string; name: string }>();
    for (const e of enrollments) {
      for (const ci of e.classSession?.course?.instructors ?? []) {
        const u = ci.instructor?.user;
        if (u && !map.has(u.id)) {
          map.set(u.id, { userId: u.id, name: u.name ?? '老师' });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  /** GET /me/message-threads：我的会话列表（带对方信息、最后一条、未读数） */
  async myThreads(userId: string) {
    const threads = await this.prisma.messageThread.findMany({
      where: { participantId: userId },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { lastMessageAt: 'desc' },
    });
    // 老师会话补老师姓名
    const teacherIds = threads
      .filter((t) => t.peerType === 'INSTRUCTOR' && t.peerId)
      .map((t) => t.peerId as string);
    const teacherUsers =
      teacherIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: teacherIds } },
            select: { id: true, name: true },
          })
        : [];
    const teacherName = new Map(teacherUsers.map((u) => [u.id, u.name ?? '老师']));

    const threadIds = threads.map((t) => t.id);
    const unreadRows =
      threadIds.length > 0
        ? await this.prisma.message.groupBy({
            by: ['threadId'],
            where: { threadId: { in: threadIds }, senderId: { not: userId }, readAt: null },
            _count: { _all: true },
          })
        : [];
    const unreadMap = new Map(unreadRows.map((r) => [r.threadId, r._count._all]));

    return threads.map((t) => ({
      id: t.id,
      peerType: t.peerType,
      peerId: t.peerId,
      peerName: t.peerType === 'INSTRUCTOR' ? (teacherName.get(t.peerId ?? '') ?? '老师') : '学校',
      lastMessageAt: t.lastMessageAt,
      lastMessage: t.messages[0]?.body ?? '',
      lastMessageTime: t.messages[0]?.createdAt ?? t.lastMessageAt,
      unreadCount: unreadMap.get(t.id) ?? 0,
    }));
  }

  /** GET /me/messages?threadId=：查看指定会话的消息（不传则看与管理员的） */
  async myMessages(userId: string, threadId?: string) {
    let thread;
    if (threadId) {
      thread = await this.prisma.messageThread.findFirst({
        where: { id: threadId, participantId: userId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      if (!thread) throw new NotFoundException('私信会话不存在');
    } else {
      thread = await this.prisma.messageThread.findFirst({
        where: { participantId: userId, peerType: 'ADMIN' },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
    }
    return { thread, messages: thread?.messages ?? [] };
  }

  /** POST /me/message-threads/:id/read：标已读（对方发的） */
  async markThreadRead(userId: string, threadId: string) {
    const thread = await this.prisma.messageThread.findFirst({
      where: { id: threadId, participantId: userId },
    });
    if (!thread) throw new NotFoundException('私信会话不存在');
    const result = await this.prisma.message.updateMany({
      where: { threadId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }

  // ------------------- 教师端 -------------------

  /** GET /me/instructor/message-threads：老师收到的私信会话（家长/学员发给我的） */
  async instructorThreads(instructorUserId: string) {
    const threads = await this.prisma.messageThread.findMany({
      where: { peerType: 'INSTRUCTOR', peerId: instructorUserId },
      include: {
        participant: { select: { id: true, name: true, role: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    const threadIds = threads.map((t) => t.id);
    const unreadRows =
      threadIds.length > 0
        ? await this.prisma.message.groupBy({
            by: ['threadId'],
            where: {
              threadId: { in: threadIds },
              senderId: { not: instructorUserId },
              readAt: null,
            },
            _count: { _all: true },
          })
        : [];
    const unreadMap = new Map(unreadRows.map((r) => [r.threadId, r._count._all]));
    return threads.map((t) => ({
      id: t.id,
      participant: t.participant,
      lastMessageAt: t.lastMessageAt,
      lastMessage: t.messages[0]?.body ?? '',
      lastMessageTime: t.messages[0]?.createdAt ?? t.lastMessageAt,
      unreadCount: unreadMap.get(t.id) ?? 0,
    }));
  }

  /** GET /me/instructor/message-threads/:id：老师看某个会话 */
  async instructorThread(instructorUserId: string, threadId: string) {
    const thread = await this.prisma.messageThread.findFirst({
      where: { id: threadId, peerType: 'INSTRUCTOR', peerId: instructorUserId },
      include: {
        participant: { select: { id: true, name: true, role: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!thread) throw new NotFoundException('私信会话不存在');
    return thread;
  }

  /** POST /me/instructor/message-threads/:id/reply：老师回复家长/学员 */
  async instructorReply(instructor: RequestUser, threadId: string, body: string) {
    const thread = await this.prisma.messageThread.findFirst({
      where: { id: threadId, peerType: 'INSTRUCTOR', peerId: instructor.id },
    });
    if (!thread) throw new NotFoundException('私信会话不存在');
    const message = await this.prisma.message.create({
      data: {
        threadId,
        senderId: instructor.id,
        senderRole: SenderRole.INSTRUCTOR,
        body,
      },
    });
    await this.prisma.messageThread.update({
      where: { id: threadId },
      data: { lastMessageAt: message.createdAt },
    });
    try {
      const sender = await this.prisma.user.findUnique({
        where: { id: instructor.id },
        select: { name: true },
      });
      await this.notifications.notify({
        userId: thread.participantId,
        type: NotificationType.MESSAGE_REPLY,
        title: `${sender?.name ?? '老师'}回复了你的私信`,
        body: body.length > 120 ? `${body.slice(0, 120)}…` : body,
        sourceType: NotificationSourceType.MESSAGE,
        sourceId: message.id,
      });
    } catch {
      // 通知失败不影响发送
    }
    return message;
  }

  /** POST /me/instructor/message-threads/:id/read：老师标已读 */
  async instructorMarkRead(instructorUserId: string, threadId: string) {
    const thread = await this.prisma.messageThread.findFirst({
      where: { id: threadId, peerType: 'INSTRUCTOR', peerId: instructorUserId },
    });
    if (!thread) throw new NotFoundException('私信会话不存在');
    const result = await this.prisma.message.updateMany({
      where: { threadId, senderId: { not: instructorUserId }, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }

  /**
   * POST /me/instructor/messages/initiate：老师主动给所教学员的家长发起私信。
   * 校验：parentId 必须是该老师任教学员的家长
   * （classSession.instructorId → enrollments → student → parentLinks），否则 403。
   * 会话复用家长视角的同一 thread（participant=家长，peerType=INSTRUCTOR，peerId=老师 userId），
   * 找到已有则返回，没有则创建；并给家长发一条通知。通知失败不影响发起。
   */
  async instructorInitiate(instructor: RequestUser, parentId: string) {
    const profile = await this.prisma.instructor.findUnique({
      where: { userId: instructor.id },
    });
    if (!profile) throw new NotFoundException('未找到教师档案');

    const target = await this.prisma.user.findUnique({
      where: { id: parentId },
      select: { id: true, role: true, isActive: true },
    });
    if (!target || !target.isActive) throw new NotFoundException('目标用户不存在或已停用');
    if (target.role !== UserRole.PARENT) {
      throw new BadRequestException('只能给家长发起私信');
    }

    const allowed = await this.prisma.parentStudentLink.count({
      where: {
        parentId,
        student: {
          enrollments: { some: { classSession: { instructorId: profile.id } } },
        },
      },
    });
    if (allowed === 0) {
      throw new ForbiddenException('只能给自己所教学员的家长发起私信');
    }

    const thread = await this.findOrCreateThread(
      parentId,
      ParticipantRole.PARENT,
      'INSTRUCTOR',
      instructor.id,
    );

    try {
      const sender = await this.prisma.user.findUnique({
        where: { id: instructor.id },
        select: { name: true },
      });
      const teacherName = sender?.name ?? '老师';
      await this.notifications.notify({
        userId: parentId,
        type: NotificationType.MESSAGE_REPLY,
        title: `${teacherName}发起了与你的私信会话`,
        body: '点击查看并回复',
        sourceType: NotificationSourceType.MESSAGE,
        sourceId: thread.id,
      });
    } catch {
      // 通知失败不影响发起
    }
    return { thread };
  }

  // ------------------- 管理端（保持兼容，多会话） -------------------

  /** GET /admin/messages/threads?role=&search=：管理端收件箱，可按身份筛选、按姓名/电话搜索，带未读数 */
  async listThreads(role?: ParticipantRole, search?: string) {
    const threads = await this.prisma.messageThread.findMany({
      where: {
        ...(role ? { participantRole: role } : {}),
        ...(search
          ? {
              participant: {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { phone: { contains: search } },
                ],
              },
            }
          : {}),
      },
      include: {
        participant: {
          select: { id: true, name: true, email: true, phone: true, role: true },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    // 老师会话补老师姓名
    const teacherIds = threads
      .filter((t) => t.peerType === 'INSTRUCTOR' && t.peerId)
      .map((t) => t.peerId as string);
    const teacherUsers =
      teacherIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: teacherIds } },
            select: { id: true, name: true },
          })
        : [];
    const teacherName = new Map(teacherUsers.map((u) => [u.id, u.name ?? '老师']));

    // 未读数：非 ADMIN 发的且 readAt 为 null（一次 groupBy 查全量）
    const threadIds = threads.map((t) => t.id);
    const unreadRows =
      threadIds.length > 0
        ? await this.prisma.message.groupBy({
            by: ['threadId'],
            where: {
              threadId: { in: threadIds },
              senderRole: { not: SenderRole.ADMIN },
              readAt: null,
            },
            _count: { _all: true },
          })
        : [];
    const unreadMap = new Map(unreadRows.map((r) => [r.threadId, r._count._all]));
    return threads.map((t) => ({
      ...t,
      peerName:
        t.peerType === 'INSTRUCTOR' ? (teacherName.get(t.peerId ?? '') ?? '老师') : '学校',
      unreadCount: unreadMap.get(t.id) ?? 0,
    }));
  }

  /** GET /admin/messages/threads/:id */
  async getThread(id: string) {
    const thread = await this.prisma.messageThread.findUnique({
      where: { id },
      include: {
        participant: {
          select: { id: true, name: true, email: true, role: true },
        },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!thread) throw new NotFoundException('私信会话不存在');
    return thread;
  }

  /** POST /admin/messages/threads/:id/reply：管理端回复，并通知发起方 */
  async reply(admin: RequestUser, threadId: string, body: string) {
    const thread = await this.prisma.messageThread.findUnique({
      where: { id: threadId },
    });
    if (!thread) throw new NotFoundException('私信会话不存在');
    const message = await this.prisma.message.create({
      data: {
        threadId,
        senderId: admin.id,
        senderRole: SenderRole.ADMIN,
        body,
      },
    });
    await this.prisma.messageThread.update({
      where: { id: threadId },
      data: { lastMessageAt: message.createdAt },
    });
    await this.notifications.notify({
      userId: thread.participantId,
      type: NotificationType.MESSAGE_REPLY,
      title: '管理端回复了你的私信',
      body: body.length > 120 ? `${body.slice(0, 120)}…` : body,
      sourceType: NotificationSourceType.MESSAGE,
      sourceId: message.id,
    });
    return message;
  }

  /**
   * POST /admin/messages/initiate：管理员主动发起私信。
   * userId 与 studentId 二选一；studentId 取其首选家长（成人学员取 SELF 绑定账号）。
   */
  async initiate(admin: RequestUser, dto: InitiateMessageDto) {
    if (!dto.userId && !dto.studentId) {
      throw new BadRequestException('userId 与 studentId 二选一必填');
    }
    let targetUserId = dto.userId ?? null;
    let participantRole: ParticipantRole;

    if (dto.studentId) {
      const student = await this.prisma.student.findUnique({
        where: { id: dto.studentId },
        include: {
          parentLinks: {
            include: { parent: { select: { id: true, role: true } } },
          },
        },
      });
      if (!student) throw new NotFoundException('学员不存在');
      if (student.parentLinks.length === 0) {
        throw new BadRequestException('该学员未绑定账号（无家长关联），请先绑定后再发起私信');
      }
      // 优先：成人学员自己（SELF）> 首选联系人 > 第一个
      const link =
        student.parentLinks.find((l) => l.relationship === Relationship.SELF) ??
        student.parentLinks.find((l) => l.isPrimaryContact) ??
        student.parentLinks[0];
      targetUserId = link.parent.id;
      participantRole = this.participantRoleFor(link.parent.role);
    } else {
      const target = await this.prisma.user.findUnique({
        where: { id: targetUserId! },
        select: { id: true, role: true, isActive: true },
      });
      if (!target || !target.isActive) throw new NotFoundException('目标用户不存在或已停用');
      if (target.role === UserRole.ADMIN) {
        throw new BadRequestException('不能给管理员账号发起私信');
      }
      participantRole = this.participantRoleFor(target.role);
    }

    const thread = await this.findOrCreateThread(
      targetUserId!,
      participantRole,
      'ADMIN',
      null,
    );

    const finalBody = dto.contextStudentName
      ? `（关于学员：${dto.contextStudentName}）\n${dto.body}`
      : dto.body;
    const message = await this.prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: admin.id,
        senderRole: SenderRole.ADMIN,
        body: finalBody,
      },
    });
    await this.prisma.messageThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: message.createdAt },
    });
    try {
      await this.notifications.notify({
        userId: targetUserId!,
        type: NotificationType.MESSAGE_REPLY,
        title: '管理员给你发了一条私信',
        body: finalBody.length > 120 ? `${finalBody.slice(0, 120)}…` : finalBody,
        sourceType: NotificationSourceType.MESSAGE,
        sourceId: message.id,
      });
    } catch {
      // 通知失败不影响发送
    }
    return { thread, message };
  }

  /** POST /admin/messages/threads/:id/read：标已读（对方发的未读消息） */
  async markRead(threadId: string) {
    const thread = await this.prisma.messageThread.findUnique({
      where: { id: threadId },
    });
    if (!thread) throw new NotFoundException('私信会话不存在');
    const result = await this.prisma.message.updateMany({
      where: {
        threadId,
        senderRole: { not: SenderRole.ADMIN },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }

  /** GET /admin/message-templates：快捷回复模板列表 */
  async listTemplates() {
    return this.prisma.messageTemplate.findMany({
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** POST /admin/message-templates：新建模板 */
  async createTemplate(adminId: string, dto: CreateTemplateDto) {
    return this.prisma.messageTemplate.create({
      data: { title: dto.title, body: dto.body, createdById: adminId },
    });
  }

  /** DELETE /admin/message-templates/:id：删除模板 */
  async deleteTemplate(id: string) {
    const tpl = await this.prisma.messageTemplate.findUnique({ where: { id } });
    if (!tpl) throw new NotFoundException('模板不存在');
    await this.prisma.messageTemplate.delete({ where: { id } });
    return { deleted: true };
  }
}
