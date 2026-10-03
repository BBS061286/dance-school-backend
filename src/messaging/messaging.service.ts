import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationSourceType,
  NotificationType,
  ParticipantRole,
  SenderRole,
  UserRole,
} from '@prisma/client';
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

  /** GET /admin/messages/threads?role=：管理端收件箱，可按身份筛选 */
  async listThreads(role?: ParticipantRole) {
    return this.prisma.messageThread.findMany({
      where: role ? { participantRole: role } : {},
      include: {
        participant: {
          select: { id: true, name: true, email: true, role: true },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
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
}
