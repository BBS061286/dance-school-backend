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
 * 私信服务（§6.22/6.23）：一个用户（家长/成人学员/教师）与管理端之间只有一条 thread。
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

  /** POST /me/messages：追加到"我与管理端"的 thread，不存在则自动创建 */
  async postMessage(user: RequestUser, body: string) {
    const participantRole = this.participantRoleFor(user.role);
    let thread = await this.prisma.messageThread.findUnique({
      where: { participantId: user.id },
    });
    if (!thread) {
      thread = await this.prisma.messageThread.create({
        data: { participantId: user.id, participantRole },
      });
    }
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
    // 通知所有管理员有新私信（失败不影响发送）
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN, isActive: true, id: { not: user.id } },
        select: { id: true },
      });
      const preview = body.length > 80 ? `${body.slice(0, 80)}…` : body;
      for (const a of admins) {
        await this.notifications.notify({
          userId: a.id,
          type: NotificationType.MESSAGE_RECEIVED,
          title: '收到一条新私信',
          body: preview,
          sourceType: NotificationSourceType.MESSAGE,
          sourceId: message.id,
        });
      }
    } catch (e) {
      // 通知失败不阻塞
    }
    return { thread, message };
  }

  /** GET /me/messages：查看我与管理端的私信记录 */
  async myMessages(userId: string) {
    const thread = await this.prisma.messageThread.findUnique({
      where: { participantId: userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    return { thread, messages: thread?.messages ?? [] };
  }

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
    // 未读数：senderRole != ADMIN 且 readAt 为 null（一次 groupBy 查全量）
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
    return threads.map((t) => ({ ...t, unreadCount: unreadMap.get(t.id) ?? 0 }));
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

    let thread = await this.prisma.messageThread.findUnique({
      where: { participantId: targetUserId! },
    });
    if (!thread) {
      thread = await this.prisma.messageThread.create({
        data: { participantId: targetUserId!, participantRole },
      });
    }

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
