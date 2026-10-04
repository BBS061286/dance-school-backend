import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Document,
  DocumentAudience,
  DocumentStatus,
  NotificationSourceType,
  NotificationType,
  UserRole,
} from '@prisma/client';
import { RequestUser } from '../common/types';
import { isUniqueViolation } from '../common/prisma-errors';
import { resolveStudentRecipientUserIds } from '../common/student-recipients';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto, SignDocumentDto } from './dto/document.dto';

/**
 * 文件上传与电子签署服务（§6.24/6.26）。
 * 版本链：新版本是独立 Document（version+1，supersedesDocumentId 指向上版）；
 * requiresResignOnUpdate=true 时向旧版签署人发 DOCUMENT_SIGN_REQUEST 通知。
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ 管理端

  /** POST /admin/documents：上传文件（ADMIN） */
  async create(adminId: string, dto: CreateDocumentDto, filename?: string) {
    if (!filename) throw new BadRequestException('请上传文件');
    return this.prisma.document.create({
      data: {
        title: dto.title,
        fileUrl: `uploads/${filename}`,
        requiresSignature: dto.requires_signature ?? true,
        audience: dto.audience ?? DocumentAudience.ALL,
        status: dto.save_to_library ? DocumentStatus.LIBRARY : DocumentStatus.ACTIVE,
        version: 1,
        createdById: adminId,
      },
    });
  }

  /**
   * POST /admin/documents/:id/new-version：发布新版本。
   * version+1，supersedesDocumentId 指向上版；requiresResignOnUpdate=true 时
   * 向旧版签署人发 DOCUMENT_SIGN_REQUEST 通知（sourceType=DOCUMENT）。
   */
  async newVersion(adminId: string, docId: string, filename?: string) {
    const old = await this.prisma.document.findUnique({
      where: { id: docId },
    });
    if (!old) throw new NotFoundException('文件不存在');
    if (!filename) throw new BadRequestException('请上传新版本文件');
    const next = await this.prisma.document.create({
      data: {
        title: old.title,
        fileUrl: `uploads/${filename}`,
        requiresSignature: old.requiresSignature,
        audience: old.audience,
        version: old.version + 1,
        supersedesDocumentId: old.id,
        requiresResignOnUpdate: old.requiresResignOnUpdate,
        createdById: adminId,
      },
    });
    if (next.requiresResignOnUpdate) {
      const signers = await this.prisma.documentSignature.findMany({
        where: { documentId: old.id },
        select: { studentId: true },
      });
      const seen = new Set<string>();
      for (const { studentId } of signers) {
        const recipientIds = await resolveStudentRecipientUserIds(
          this.prisma,
          studentId,
        );
        for (const userId of recipientIds) {
          if (seen.has(userId)) continue;
          seen.add(userId);
          await this.notifications.notify({
            userId,
            type: NotificationType.DOCUMENT_SIGN_REQUEST,
            title: '文件更新，请重新签署',
            body: `《${next.title}》已更新至第 ${next.version} 版，条款有变更，请重新签署。`,
            sourceType: NotificationSourceType.DOCUMENT,
            sourceId: next.id,
          });
        }
      }
    }
    return next;
  }

  /** GET /admin/documents */
  async list() {
    return this.prisma.document.findMany({
      include: {
        _count: { select: { signatures: true, sends: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * POST /admin/documents/:id/send：定向发送签署请求。
   * student_ids 去重；已有该文档签名的跳过；发通知给学员家长/本人。
   */
  async sendDocument(
    adminId: string,
    docId: string,
    studentIds: string[],
    note?: string,
  ) {
    const doc = await this.prisma.document.findUnique({
      where: { id: docId },
    });
    if (!doc) throw new NotFoundException('文件不存在');
    if (!doc.requiresSignature) {
      throw new BadRequestException('该文件无需签署');
    }
    const uniqueIds = [...new Set((studentIds ?? []).filter(Boolean))];
    if (uniqueIds.length === 0) {
      throw new BadRequestException('请选择至少一名学员');
    }
    // 已签过当前版本的跳过
    const signed = await this.prisma.documentSignature.findMany({
      where: { documentId: docId, studentId: { in: uniqueIds } },
      select: { studentId: true },
    });
    const signedSet = new Set(signed.map((x) => x.studentId));
    const targets = uniqueIds.filter((id) => !signedSet.has(id));
    if (targets.length === 0) {
      throw new BadRequestException('所选学员均已签署，无需重复发送');
    }
    const send = await this.prisma.documentSend.create({
      data: {
        documentId: docId,
        createdById: adminId,
        note: note?.trim() || null,
        recipients: {
          create: targets.map((studentId) => ({ studentId })),
        },
      },
      include: { recipients: true },
    });
    // 文件出库：LIBRARY -> ACTIVE
    if (doc.status !== 'ACTIVE') {
      await this.prisma.document.update({
        where: { id: docId },
        data: { status: 'ACTIVE' },
      });
    }
    // 通知
    const seen = new Set<string>();
    for (const studentId of targets) {
      const recipientIds = await resolveStudentRecipientUserIds(
        this.prisma,
        studentId,
      );
      for (const userId of recipientIds) {
        if (seen.has(userId)) continue;
        seen.add(userId);
        try {
          await this.notifications.notify({
            userId,
            type: NotificationType.DOCUMENT_SIGN_REQUEST,
            title: '有文件需要签署',
            body: `《${doc.title}》需要签署${note?.trim() ? `（${note.trim()}）` : ''}，请及时处理。`,
            sourceType: NotificationSourceType.DOCUMENT,
            sourceId: doc.id,
          });
        } catch {
          /* 通知失败不影响发送 */
        }
      }
    }
    return {
      sendId: send.id,
      sent: targets.length,
      skipped: uniqueIds.length - targets.length,
    };
  }

  /** GET /admin/documents/:id/sends：发送记录 + 每人签署状态 */
  async sends(docId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: docId },
      select: { id: true, title: true },
    });
    if (!doc) throw new NotFoundException('文件不存在');
    const sends = await this.prisma.documentSend.findMany({
      where: { documentId: docId },
      include: {
        createdBy: { select: { id: true, name: true } },
        recipients: {
          include: { student: { select: { id: true, name: true } } },
          orderBy: { sentAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const signed = await this.prisma.documentSignature.findMany({
      where: { documentId: docId },
      select: { studentId: true, signedAt: true },
    });
    const signedMap = new Map(signed.map((x) => [x.studentId, x.signedAt]));
    return sends.map((sd) => ({
      id: sd.id,
      note: sd.note,
      createdAt: sd.createdAt,
      createdBy: sd.createdBy,
      recipients: sd.recipients.map((r) => ({
        student: r.student,
        sentAt: r.sentAt,
        signedAt: signedMap.get(r.student.id) ?? null,
      })),
    }));
  }

  /**
   * GET /admin/documents/:id/signatures：谁签了 / 谁没签。
   * 按 audience 圈定学生范围（ALL=全部在读学员；YOUTH=有家长关联的学员；
   * ADULT=成人学员本人），减去已签当前版本的人。
   */
  async signatures(docId: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id: docId },
    });
    if (!doc) throw new NotFoundException('文件不存在');
    const signed = await this.prisma.documentSignature.findMany({
      where: { documentId: docId },
      include: {
        student: { select: { id: true, name: true } },
        signedBy: { select: { id: true, name: true } },
      },
      orderBy: { signedAt: 'desc' },
    });
    const scoped = await this.scopedStudents(doc.audience);
    const signedIds = new Set(signed.map((s) => s.studentId));
    return {
      document: { id: doc.id, title: doc.title, version: doc.version },
      signed,
      unsigned: scoped.filter((s) => !signedIds.has(s.id)),
    };
  }

  /** audience → 学生范围 */
  private async scopedStudents(audience: DocumentAudience) {
    const base = { isActive: true };
    if (audience === DocumentAudience.ALL) {
      return this.prisma.student.findMany({
        where: base,
        select: { id: true, name: true },
      });
    }
    if (audience === DocumentAudience.YOUTH) {
      return this.prisma.student.findMany({
        where: {
          ...base,
          parentLinks: { some: { relationship: { not: 'SELF' } } },
        },
        select: { id: true, name: true },
      });
    }
    return this.prisma.student.findMany({
      where: {
        ...base,
        parentLinks: { some: { relationship: 'SELF' } },
      },
      select: { id: true, name: true },
    });
  }

  // ------------------------------------------------------------------ 学员端

  /**
   * GET /me/documents：待我/孩子签的。
   * 仅看各文件的最新版本（supersededBy 为空），audience 匹配且未签当前版本；
   * 若旧版已签且 requiresResignOnUpdate=false，旧签名继续有效，不再出现。
   */
  async pendingFor(userId: string) {
    const links = await this.prisma.parentStudentLink.findMany({
      where: { parentId: userId },
      include: { student: { select: { id: true, name: true } } },
    });
    const studentIds = links.map((l) => l.studentId);
    // 定向发送的（未签）
    const targeted = studentIds.length
      ? await this.prisma.documentSendRecipient.findMany({
          where: { studentId: { in: studentIds } },
          include: {
            send: {
              include: {
                document: {
                  include: { supersededBy: { select: { id: true } } },
                },
              },
            },
            student: { select: { id: true, name: true } },
          },
        })
      : [];
    const signedDocIds = await this.prisma.documentSignature.findMany({
      where: { studentId: { in: studentIds } },
      select: { documentId: true, studentId: true },
    });
    const signedSet = new Set(
      signedDocIds.map((x) => `${x.documentId}:${x.studentId}`),
    );
    const pending: { student: { id: string; name: string }; document: Document; sendNote?: string | null }[] = [];
    const seen = new Set<string>();
    for (const r of targeted) {
      const doc = r.send.document;
      if (!doc || doc.supersededBy !== null || !doc.requiresSignature) continue;
      const key = `${doc.id}:${r.studentId}`;
      if (signedSet.has(key) || seen.has(key)) continue;
      seen.add(key);
      pending.push({
        student: r.student,
        document: doc,
        sendNote: r.send.note,
      });
    }
    // audience 广播的（仅 ACTIVE）
    const docs = await this.prisma.document.findMany({
      where: { supersededBy: null, requiresSignature: true, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    for (const link of links) {
      const isAdult = link.relationship === 'SELF';
      for (const doc of docs) {
        const key = `${doc.id}:${link.studentId}`;
        if (seen.has(key)) continue;
        if (doc.audience !== DocumentAudience.ALL) {
          const forYouth = doc.audience === DocumentAudience.YOUTH;
          if (forYouth === isAdult) continue;
        }
        if (signedSet.has(key)) continue;
        if (doc.supersedesDocumentId && !doc.requiresResignOnUpdate) {
          const oldSigned = await this.prisma.documentSignature.findUnique({
            where: {
              documentId_studentId: {
                documentId: doc.supersedesDocumentId,
                studentId: link.studentId,
              },
            },
            select: { id: true },
          });
          if (oldSigned) continue; // 旧签名继续有效
        }
        seen.add(key);
        pending.push({ student: link.student, document: doc });
      }
    }
    return pending;
  }

  /**
   * POST /me/documents/:id/sign：电子签署，校验代签关系
   *（parentId=requester.id 的 ParentStudentLink；成人学员 SELF 关系即本人）。
   */
  async sign(requester: RequestUser, docId: string, dto: SignDocumentDto) {
    const doc = await this.prisma.document.findUnique({
      where: { id: docId },
    });
    if (!doc) throw new NotFoundException('文件不存在');
    if (!doc.requiresSignature) {
      throw new BadRequestException('该文件无需签署');
    }
    if (requester.role !== UserRole.ADMIN) {
      const link = await this.prisma.parentStudentLink.findFirst({
        where: { parentId: requester.id, studentId: dto.student_id },
        select: { id: true },
      });
      if (!link) throw new ForbiddenException('只能为自己（或孩子）签署');
    }
    try {
      return await this.prisma.documentSignature.create({
        data: {
          documentId: doc.id,
          documentVersion: doc.version,
          studentId: dto.student_id,
          signedById: requester.id,
          signatureImage: dto.signature_image,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('该学员已签署过此版本');
      }
      throw e;
    }
  }

  /** GET /me/documents/:id/signature：查看已签署的记录（签名副本） */
  async mySignature(requester: RequestUser, docId: string, studentId: string) {
    if (requester.role !== UserRole.ADMIN) {
      const link = await this.prisma.parentStudentLink.findFirst({
        where: { parentId: requester.id, studentId },
        select: { id: true },
      });
      if (!link) throw new ForbiddenException('只能查看自己（或孩子）的签署记录');
    }
    const signature = await this.prisma.documentSignature.findUnique({
      where: { documentId_studentId: { documentId: docId, studentId } },
      include: {
        student: { select: { id: true, name: true } },
        signedBy: { select: { id: true, name: true } },
      },
    });
    if (!signature) throw new NotFoundException('尚未签署');
    return signature;
  }
}
