import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Enrollment, NotificationSourceType, NotificationType, Prisma } from '@prisma/client';
import { RequestUser, TxClient } from '../common/types';
import { resolveStudentRecipientUserIds } from '../common/student-recipients';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEnrollmentDto } from './dto/enroll.dto';

/** 含 course 的课次类型（计算有效名额用） */
type SessionWithCourse = Prisma.ClassSessionGetPayload<{
  include: { course: true };
}>;

/** 某笔报名的付款分摊汇总（供 BillingService / 退款预览使用） */
export interface EnrollmentPaymentSummary {
  paidCents: number; // 各明细行分摊的已付金额之和
  refundedCents: number; // 该报名下各明细行已退款金额之和
  netCents: number; // paid - refunded（净实付）
  items: {
    orderItemId: string;
    orderId: string;
    orderAmountCents: number;
    shareCents: number; // 该明细行按金额比例分摊的已付
    refundedCents: number;
  }[];
}

/** 退款金额建议（只读，不落库） */
export interface RefundPreview {
  enrollmentId: string;
  priceCents: number;
  paidCents: number;
  refundedCents: number;
  netCents: number;
  attendedSessions: number | null;
  totalSessions: number | null;
  suggestedCents: number;
  formula: 'TERM' | 'PAID_AMOUNT';
}

/** 报名模块：报名 / 取消 / 候补队列 / 名额并发控制（设计文档 §4.6，v2 R1/R6/R8f） */
@Injectable()
export class EnrollmentsService {
  /** 支付有效期：转正或报名后 24 小时内需完成支付 */
  private static readonly PAYMENT_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ 报名

  /**
   * 报名：事务内完成「归属校验 → 防重 → 方案 B 原子抢名额 → 满员则进候补」。
   * 候补路径先对课次行加 FOR UPDATE 锁，避免并发下候补序号重复。
   */
  async enroll(requester: RequestUser, dto: CreateEnrollmentDto) {
    const enrollment = await this.prisma.$transaction(async (tx) => {
      const session = await tx.classSession.findUnique({
        where: { id: dto.class_session_id },
        include: { course: true },
      });
      if (!session) throw new NotFoundException('班级不存在');
      if (session.status !== 'SCHEDULED') {
        throw new ConflictException('班级不可报名');
      }

      // 归属校验：管理员可代报，其余只能为自己关联的学生报名
      if (requester.role !== 'ADMIN') {
        const link = await tx.parentStudentLink.findFirst({
          where: { parentId: requester.id, studentId: dto.student_id },
        });
        if (!link) throw new ForbiddenException('无权为该学生报名');
      }

      // 防重：不允许同一学生在同一班级存在两条有效报名
      //（schema 按开放问题决议不加唯一约束，防重在代码里做）
      const dup = await tx.enrollment.findFirst({
        where: {
          classSessionId: dto.class_session_id,
          studentId: dto.student_id,
          status: { notIn: ['CANCELLED', 'REFUNDED'] },
        },
      });
      if (dup) throw new ConflictException('该学生已报名此班级');

      const now = new Date();
      const cap = this.effectiveCapacity(session);

      // 方案 B：原子抢名额，影响行数 1 表示抢到
      if (await this.claimSeat(tx, session.id, cap)) {
        const needsPay = session.course.requiresPayment;
        return tx.enrollment.create({
          data: {
            classSessionId: session.id,
            studentId: dto.student_id,
            enrolledByParentId: requester.id,
            status: needsPay ? 'PENDING_PAYMENT' : 'CONFIRMED',
            paymentExpiresAt: needsPay
              ? new Date(now.getTime() + EnrollmentsService.PAYMENT_TTL_MS)
              : null,
          },
        });
      }

      // 候补路径：锁行后检查候补容量、分配序号
      await tx.$queryRaw`SELECT id FROM "ClassSession" WHERE id = ${session.id} FOR UPDATE`;
      const waitlisted = await tx.enrollment.count({
        where: { classSessionId: session.id, status: 'WAITLISTED' },
      });
      if (waitlisted >= session.waitlistCapacity) {
        throw new ConflictException('班级与候补均已满');
      }
      const last = await tx.enrollment.findFirst({
        where: { classSessionId: session.id, status: 'WAITLISTED' },
        orderBy: { waitlistPosition: 'desc' },
        select: { waitlistPosition: true },
      });
      return tx.enrollment.create({
        data: {
          classSessionId: session.id,
          studentId: dto.student_id,
          enrolledByParentId: requester.id,
          status: 'WAITLISTED',
          waitlistPosition: (last?.waitlistPosition ?? 0) + 1,
        },
      });
    });
    // 管理员代报名（含私教课建课自动报名）：通知学员家长 / 成人学员本人
    if (requester.role === 'ADMIN') {
      try {
        await this.notifyEnrollmentCreated(enrollment.id);
      } catch {
        /* 通知失败不影响报名结果 */
      }
    }
    return enrollment;
  }

  /**
   * 管理员代报名成功通知：发给学员的首选家长（成人学员则为本人）。
   * 按报名状态组织文案：待支付→催缴；已确认→准时上课；候补→排队位置。
   */
  private async notifyEnrollmentCreated(enrollmentId: string): Promise<void> {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        student: { select: { name: true } },
        classSession: {
          select: { course: { select: { title: true } } },
        },
      },
    });
    if (!enrollment) return;
    const recipientIds = await resolveStudentRecipientUserIds(
      this.prisma,
      enrollment.studentId,
    );
    if (recipientIds.length === 0) return;
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const who = `【${enrollment.student.name}】`;
    const course = `《${enrollment.classSession.course.title}》`;
    let body: string;
    if (enrollment.status === 'WAITLISTED') {
      body = `管理员已为${who}报名${course}，当前名额已满，已加入候补队列（第 ${enrollment.waitlistPosition} 位），有名额时会自动转正并通知你。`;
    } else if (enrollment.status === 'PENDING_PAYMENT') {
      body = `管理员已为${who}报名${course}，请在 24 小时内完成支付，逾期名额将自动释放。支付入口：${frontendUrl}/me/enrollments`;
    } else {
      body = `管理员已为${who}报名${course}，报名已确认，请准时上课。`;
    }
    for (const userId of recipientIds) {
      await this.notifications.notify({
        userId,
        type: NotificationType.ENROLLMENT_CREATED,
        title: '新报名通知',
        body,
        sourceType: NotificationSourceType.ENROLLMENT,
        sourceId: enrollment.id,
      });
    }
  }

  // ---------------------------------------------------------- 报名详情（含进度）

  /**
   * 我的报名详情（含上课进度）：GET /me/enrollments/:id/progress。
   * 返回报名 + 班次课次列表 + 每节出勤状态。
   */
  async enrollmentProgress(userId: string, enrollmentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        student: { select: { id: true, name: true } },
        classSession: {
          include: {
            course: {
              select: {
                id: true,
                title: true,
                format: true,
                term: { select: { id: true, name: true } },
              },
            },
            campus: { select: { id: true, name: true } },
            instructor: {
              select: { id: true, user: { select: { name: true } } },
            },
            occurrences: {
              select: { id: true, sessionNumber: true, date: true, status: true },
              orderBy: { sessionNumber: 'asc' },
            },
          },
        },
      },
    });
    if (!enrollment) throw new NotFoundException('报名不存在');
    const link = await this.prisma.parentStudentLink.findFirst({
      where: { parentId: userId, studentId: enrollment.studentId },
    });
    if (!link) throw new ForbiddenException('无权查看该报名');
    const records = await this.prisma.attendanceRecord.findMany({
      where: { enrollmentId },
      select: { sessionOccurrenceId: true, status: true },
    });
    const attendanceMap: Record<string, string> = {};
    for (const r of records) attendanceMap[r.sessionOccurrenceId] = r.status;
    return { ...enrollment, attendanceMap };
  }

  // ------------------------------------------------------------------ 取消

  /**
   * 取消报名：候补直接取消并补位；CONFIRMED / PENDING_PAYMENT 释放名额并自动转正首位候补。
   * 返回更新后的报名记录与退款预览（只读）。
   */
  async cancelEnrollment(
    requester: RequestUser,
    enrollmentId: string,
    reason?: string,
  ): Promise<{ enrollment: Enrollment; refundPreview: RefundPreview }> {
    const enrollment = await this.prisma.$transaction(async (tx) => {
      const record = await tx.enrollment.findUnique({
        where: { id: enrollmentId },
      });
      if (!record) throw new NotFoundException('报名记录不存在');

      // 归属校验：报名人本人、学生归属家长、管理员可取消
      const isOwner = record.enrolledByParentId === requester.id;
      if (!isOwner && requester.role !== 'ADMIN') {
        const link = await tx.parentStudentLink.findFirst({
          where: { parentId: requester.id, studentId: record.studentId },
        });
        if (!link) throw new ForbiddenException('无权取消该报名');
      }

      if (record.status === 'CANCELLED' || record.status === 'REFUNDED') {
        throw new ConflictException('该报名已取消或已退款');
      }

      const now = new Date();
      const cancelReason = reason ?? '用户取消';

      // 候补取消：不占名额，只需把后面的候补依次前移一位
      if (record.status === 'WAITLISTED') {
        const oldPos = record.waitlistPosition;
        const updated = await tx.enrollment.update({
          where: { id: record.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: now,
            cancelReason,
            waitlistPosition: null,
          },
        });
        if (oldPos != null) {
          await this.shiftWaitlistDown(tx, record.classSessionId, oldPos);
        }
        return updated;
      }

      // CONFIRMED / PENDING_PAYMENT：释放名额并自动转正
      const updated = await tx.enrollment.update({
        where: { id: record.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReason,
          paymentExpiresAt: null,
        },
      });
      await this.releaseSeatAndPromote(tx, record.classSessionId);
      return updated;
    });

    const refundPreview = await this.refundPreview(enrollment.id);
    return { enrollment, refundPreview };
  }

  // ------------------------------------------------------------ 手动确认/转正

  /** 管理员手动确认：仅 PENDING_PAYMENT → CONFIRMED（覆盖支付状态） */
  async confirmEnrollment(enrollmentId: string): Promise<Enrollment> {
    const record = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!record) throw new NotFoundException('报名记录不存在');
    if (record.status !== 'PENDING_PAYMENT') {
      throw new ConflictException('只有待支付的报名可以手动确认');
    }
    return this.prisma.enrollment.update({
      where: { id: record.id },
      data: { status: 'CONFIRMED', paymentExpiresAt: null },
    });
  }

  /** 管理员手动转正候补（允许转正曾支付超时的记录） */
  async promoteEnrollment(enrollmentId: string): Promise<Enrollment> {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.enrollment.findUnique({
        where: { id: enrollmentId },
      });
      if (!record) throw new NotFoundException('报名记录不存在');
      return this.promoteInTx(tx, record, { manual: true });
    });
  }

  /** 运行候补自动转正：循环 promoteNext 直到无候选或名额满（循环上限 100 次） */
  async runWaitlistPromotion(sessionId: string): Promise<{ promoted: string[] }> {
    const session = await this.prisma.classSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('班级不存在');
    const promoted = await this.prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        const e = await this.promoteNext(tx, sessionId);
        if (!e) break;
        ids.push(e.id);
      }
      return ids;
    });
    return { promoted };
  }

  // ------------------------------------------------------------------ 查询

  /**
   * 班级花名册：CONFIRMED / PENDING_PAYMENT / WAITLISTED。
   * JS 排序：先非候补（按报名时间），后候补（按候补序号）。
   */
  async roster(sessionId: string) {
    const session = await this.prisma.classSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('班级不存在');
    const list = await this.prisma.enrollment.findMany({
      where: {
        classSessionId: sessionId,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT', 'WAITLISTED'] },
      },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { enrolledAt: 'asc' },
    });
    return list.sort((a, b) => {
      const aWait = a.status === 'WAITLISTED';
      const bWait = b.status === 'WAITLISTED';
      if (aWait !== bWait) return aWait ? 1 : -1;
      if (aWait && bWait) {
        return (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0);
      }
      return a.enrolledAt.getTime() - b.enrolledAt.getTime();
    });
  }

  /** 候补队列：按候补序号升序 */
  async waitlist(sessionId: string) {
    const session = await this.prisma.classSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('班级不存在');
    return this.prisma.enrollment.findMany({
      where: { classSessionId: sessionId, status: 'WAITLISTED' },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { waitlistPosition: 'asc' },
    });
  }

  /**
   * 同班学员：调用者在该班有 CONFIRMED / PENDING_PAYMENT 的关联学生才可见；
   * 只返回已确认学员的名字（隐私最小化）。
   */
  async classmates(requester: RequestUser, sessionId: string) {
    const session = await this.prisma.classSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('班级不存在');
    const links = await this.prisma.parentStudentLink.findMany({
      where: { parentId: requester.id },
      select: { studentId: true },
    });
    const studentIds = links.map((l) => l.studentId);
    const mine = await this.prisma.enrollment.count({
      where: {
        classSessionId: sessionId,
        studentId: { in: studentIds },
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
      },
    });
    if (mine === 0) throw new ForbiddenException('您没有学员在该班级上课');
    const confirmed = await this.prisma.enrollment.findMany({
      where: { classSessionId: sessionId, status: 'CONFIRMED' },
      include: { student: { select: { name: true } } },
      orderBy: { enrolledAt: 'asc' },
    });
    return confirmed.map((e) => ({ name: e.student.name }));
  }

  /** 我的报名：关联学生或本人经手的报名，按报名时间倒序 */
  async myEnrollments(userId: string) {
    const links = await this.prisma.parentStudentLink.findMany({
      where: { parentId: userId },
      select: { studentId: true },
    });
    const studentIds = links.map((l) => l.studentId);
    return this.prisma.enrollment.findMany({
      where: {
        OR: [{ studentId: { in: studentIds } }, { enrolledByParentId: userId }],
      },
      include: {
        student: { select: { id: true, name: true } },
        classSession: {
          select: {
            id: true,
            startTime: true,
            endTime: true,
            campus: { select: { id: true, name: true } },
            course: { select: { title: true, priceCents: true } },
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });
  }

  // -------------------------------------------- 供 BillingService 调用的公开方法

  /**
   * 订单支付成功后，把该订单下所有 PENDING_PAYMENT 的报名置为 CONFIRMED。
   *（BillingService 在支付事务内调用）
   */
  async confirmEnrollmentsForPaidOrder(
    tx: TxClient,
    orderId: string,
  ): Promise<void> {
    const items = await tx.orderItem.findMany({
      where: { orderId, enrollmentId: { not: null } },
      include: { enrollment: true },
    });
    for (const item of items) {
      if (item.enrollment && item.enrollment.status === 'PENDING_PAYMENT') {
        await tx.enrollment.update({
          where: { id: item.enrollment.id },
          data: { status: 'CONFIRMED', paymentExpiresAt: null },
        });
      }
    }
  }

  /**
   * 释放一个名额并自动转正候补（循环上限 100 次）。
   * 返回首个被转正的报名 id，无转正返回 null。
   */
  async releaseSeatAndPromote(
    tx: TxClient,
    classSessionId: string,
  ): Promise<{ promotedEnrollmentId: string | null }> {
    await tx.$executeRaw`UPDATE "ClassSession" SET "enrolledCount" = "enrolledCount" - 1 WHERE id = ${classSessionId} AND "enrolledCount" > 0`;
    let first: string | null = null;
    for (let i = 0; i < 100; i++) {
      const promoted = await this.promoteNext(tx, classSessionId);
      if (!promoted) break;
      if (first === null) first = promoted.id;
    }
    return { promotedEnrollmentId: first };
  }

  /**
   * 整笔退款：将 CONFIRMED / PENDING_PAYMENT 的报名置为 REFUNDED，
   * 释放名额并自动转正候补。（BillingService 在退款事务内调用）
   */
  async applyFullRefundForEnrollment(
    tx: TxClient,
    enrollmentId: string,
  ): Promise<void> {
    const record = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!record) throw new NotFoundException('报名记录不存在');
    if (record.status !== 'CONFIRMED' && record.status !== 'PENDING_PAYMENT') {
      return;
    }
    await tx.enrollment.update({
      where: { id: record.id },
      data: { status: 'REFUNDED', paymentExpiresAt: null },
    });
    await this.releaseSeatAndPromote(tx, record.classSessionId);
  }

  /**
   * 转正后支付超时回退（供未来第五章定时任务调用，无 endpoint）：
   * 要求记录为 PENDING_PAYMENT 且 promotedAt 非空。回退到候补首位并标记
   * promotionTimedOut，再对释放名额执行自动转正循环（自动跳过 timedOut 的这条）。
   */
  async rollbackTimedOutPromotion(
    tx: TxClient,
    enrollmentId: string,
  ): Promise<void> {
    const record = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!record) throw new NotFoundException('报名记录不存在');
    if (record.status !== 'PENDING_PAYMENT' || !record.promotedAt) {
      throw new ConflictException('该报名不是待支付的转正记录');
    }

    // 释放名额
    await tx.$executeRaw`UPDATE "ClassSession" SET "enrolledCount" = "enrolledCount" - 1 WHERE id = ${record.classSessionId} AND "enrolledCount" > 0`;

    // 其余候补序号全部 +1（两步 negate 法，避开部分唯一索引逐行检查冲突）
    await tx.$executeRaw`
      UPDATE "Enrollment"
      SET "waitlistPosition" = -("waitlistPosition" + 1)
      WHERE "classSessionId" = ${record.classSessionId}
        AND status = 'WAITLISTED'
        AND "waitlistPosition" >= 1`;
    await tx.$executeRaw`
      UPDATE "Enrollment"
      SET "waitlistPosition" = -"waitlistPosition"
      WHERE "classSessionId" = ${record.classSessionId}
        AND status = 'WAITLISTED'
        AND "waitlistPosition" < 0`;

    // 该记录回退到候补首位并标记超时
    await tx.enrollment.update({
      where: { id: record.id },
      data: {
        status: 'WAITLISTED',
        waitlistPosition: 1,
        promotionTimedOut: true,
        paymentExpiresAt: null,
        promotedAt: null,
      },
    });

    // 释放的名额继续自动转正（promoteNext 会自动跳过 timedOut 的这条）
    for (let i = 0; i < 100; i++) {
      const promoted = await this.promoteNext(tx, record.classSessionId);
      if (!promoted) break;
    }
  }

  /**
   * 某笔报名的付款分摊汇总：查该报名的 OrderItem（含 order → payments / refunds）；
   * 每项分摊 shareCents = order.amountCents > 0
   *   ? round(Σ SUCCEEDED payment × item.amountCents / order.amountCents) : 0；
   * itemRefunded = 该明细行的 Σ RefundRecord。
   */
  async getEnrollmentPaymentSummary(
    enrollmentId: string,
  ): Promise<EnrollmentPaymentSummary> {
    const record = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!record) throw new NotFoundException('报名记录不存在');

    const items = await this.prisma.orderItem.findMany({
      where: { enrollmentId },
      include: {
        order: { include: { payments: true } },
        refunds: true,
      },
    });

    const summary: EnrollmentPaymentSummary = {
      paidCents: 0,
      refundedCents: 0,
      netCents: 0,
      items: [],
    };
    for (const item of items) {
      const orderPaid = item.order.payments
        .filter((p) => p.status === 'SUCCEEDED')
        .reduce((sum, p) => sum + p.amountCents, 0);
      const shareCents =
        item.order.amountCents > 0
          ? Math.round((orderPaid * item.amountCents) / item.order.amountCents)
          : 0;
      const refundedCents = item.refunds.reduce(
        (sum, r) => sum + r.amountCents,
        0,
      );
      summary.items.push({
        orderItemId: item.id,
        orderId: item.orderId,
        orderAmountCents: item.order.amountCents,
        shareCents,
        refundedCents,
      });
      summary.paidCents += shareCents;
      summary.refundedCents += refundedCents;
    }
    summary.netCents = summary.paidCents - summary.refundedCents;
    return summary;
  }

  /**
   * 退款预览（只读）：按期课程按已上课次比例建议退款金额，
   * 其余按净实付全额建议；建议金额钳制在 [0, netCents]。
   */
  async refundPreview(enrollmentId: string): Promise<RefundPreview> {
    const record = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { classSession: { include: { course: true } } },
    });
    if (!record) throw new NotFoundException('报名记录不存在');

    const summary = await this.getEnrollmentPaymentSummary(enrollmentId);
    const course = record.classSession.course;

    let attendedSessions: number | null = null;
    let totalSessions: number | null = null;
    let suggestedCents: number;
    let formula: 'TERM' | 'PAID_AMOUNT';

    if (course.pricingType === 'TERM' && course.totalSessions != null) {
      attendedSessions = await this.prisma.attendanceRecord.count({
        where: { enrollmentId, status: 'CONFIRMED' },
      });
      totalSessions = course.totalSessions;
      const raw = Math.round(
        course.priceCents * (1 - attendedSessions / totalSessions),
      );
      suggestedCents = Math.min(Math.max(raw, 0), summary.netCents);
      formula = 'TERM';
    } else {
      suggestedCents = summary.netCents;
      formula = 'PAID_AMOUNT';
    }

    return {
      enrollmentId,
      priceCents: course.priceCents,
      paidCents: summary.paidCents,
      refundedCents: summary.refundedCents,
      netCents: summary.netCents,
      attendedSessions,
      totalSessions,
      suggestedCents,
      formula,
    };
  }

  // ------------------------------------------------------------------ 私有辅助

  /** 有效名额：课次容量为空时继承课程容量（私教课 1v1/1v3 等按设定名额） */
  private effectiveCapacity(session: SessionWithCourse): number {
    return session.capacity ?? session.course.capacity;
  }

  /** 方案 B 原子抢名额：成功返回 true */
  private async claimSeat(
    tx: TxClient,
    sessionId: string,
    cap: number,
  ): Promise<boolean> {
    const rows = await tx.$executeRaw`UPDATE "ClassSession" SET "enrolledCount" = "enrolledCount" + 1 WHERE id = ${sessionId} AND "enrolledCount" < ${cap}`;
    return Number(rows) === 1;
  }

  /**
   * 取首位有效候补（跳过 promotionTimedOut）并转正；
   * 无候选或抢名额失败返回 null。
   *（D5 已接线：转正落定后在 finalizePromotion 内发送 WAITLIST_PROMOTED 通知）
   */
  private async promoteNext(
    tx: TxClient,
    sessionId: string,
  ): Promise<Enrollment | null> {
    const session = await tx.classSession.findUnique({
      where: { id: sessionId },
      include: { course: true },
    });
    if (!session) return null;
    const candidate = await tx.enrollment.findFirst({
      where: {
        classSessionId: sessionId,
        status: 'WAITLISTED',
        promotionTimedOut: false,
      },
      orderBy: { waitlistPosition: 'asc' },
    });
    if (!candidate) return null;
    if (!(await this.claimSeat(tx, sessionId, this.effectiveCapacity(session)))) {
      return null;
    }
    return this.finalizePromotion(tx, candidate, session);
  }

  /**
   * 事务内转正指定候补：要求 WAITLISTED；非手动模式下曾超时的记录拒绝。
   * 手动模式（管理员特批）：名额满也可转正（允许超员，计数照常累加）；
   * 自动模式：抢名额失败抛 409。
   */
  private async promoteInTx(
    tx: TxClient,
    enrollment: Enrollment,
    opts: { manual: boolean },
  ): Promise<Enrollment> {
    if (enrollment.status !== 'WAITLISTED') {
      throw new ConflictException('只有候补报名可以转正');
    }
    if (!opts.manual && enrollment.promotionTimedOut) {
      throw new ConflictException('该报名曾因支付超时被回退，只能由管理员手动转正');
    }
    const session = await tx.classSession.findUnique({
      where: { id: enrollment.classSessionId },
      include: { course: true },
    });
    if (!session) throw new NotFoundException('班级不存在');
    if (opts.manual) {
      // 管理员手动特批：名额满也可转正，计数照常累加（可超员，如 13/12）
      await tx.$executeRaw`UPDATE "ClassSession" SET "enrolledCount" = "enrolledCount" + 1 WHERE id = ${session.id}`;
    } else if (
      !(await this.claimSeat(tx, session.id, this.effectiveCapacity(session)))
    ) {
      throw new ConflictException('班级名额已满');
    }
    return this.finalizePromotion(tx, enrollment, session);
  }

  /** 执行转正写库：状态切换 + 支付截止 + 候补前移 + WAITLIST_PROMOTED 通知（§6.28） */
  private async finalizePromotion(
    tx: TxClient,
    enrollment: Enrollment,
    session: SessionWithCourse,
  ): Promise<Enrollment> {
    const now = new Date();
    const needsPay = session.course.requiresPayment;
    const oldPos = enrollment.waitlistPosition;
    const promoted = await tx.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status: needsPay ? 'PENDING_PAYMENT' : 'CONFIRMED',
        paymentExpiresAt: needsPay
          ? new Date(now.getTime() + EnrollmentsService.PAYMENT_TTL_MS)
          : null,
        waitlistPosition: null,
        promotedAt: now,
      },
    });
    if (oldPos != null) {
      await this.shiftWaitlistDown(tx, session.id, oldPos);
    }
    await this.notifyPromotion(tx, promoted, session);
    return promoted;
  }

  /**
   * 候补转正通知（§6.28 WAITLIST_PROMOTED，sourceType=ENROLLMENT）：
   * requires_payment=true → 文案含支付链接与 24 小时支付截止；
   * requires_payment=false → 文案为"已为你保留名额"。
   * 收件人：学员家长经 ParentStudentLink（isPrimaryContact 优先）；成人学员本人即 User。
   */
  private async notifyPromotion(
    tx: TxClient,
    enrollment: Enrollment,
    session: SessionWithCourse,
  ): Promise<void> {
    const needsPay = session.course.requiresPayment;
    const recipientIds = await resolveStudentRecipientUserIds(
      tx,
      enrollment.studentId,
    );
    if (recipientIds.length === 0) return;
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const title = '候补转正通知';
    const body = needsPay
      ? `《${session.course.title}》已有空余名额，你的候补已转正！请在 24 小时内完成支付，逾期名额将自动释放。支付入口：${frontendUrl}/me/enrollments`
      : `《${session.course.title}》已为你保留名额，候补转正成功，无需支付，请准时上课。`;
    for (const userId of recipientIds) {
      await this.notifications.notify({
        userId,
        type: NotificationType.WAITLIST_PROMOTED,
        title,
        body,
        sourceType: NotificationSourceType.ENROLLMENT,
        sourceId: enrollment.id,
      });
    }
  }

  /**
   * 候补前移：把序号 > fromPos 的候补依次 -1。
   * PostgreSQL 部分唯一索引逐行检查，不能直接 -1，需两步 negate 法。
   */
  private async shiftWaitlistDown(
    tx: TxClient,
    sessionId: string,
    fromPos: number,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE "Enrollment"
      SET "waitlistPosition" = -("waitlistPosition" - 1)
      WHERE "classSessionId" = ${sessionId}
        AND status = 'WAITLISTED'
        AND "waitlistPosition" > ${fromPos}`;
    await tx.$executeRaw`
      UPDATE "Enrollment"
      SET "waitlistPosition" = -"waitlistPosition"
      WHERE "classSessionId" = ${sessionId}
        AND status = 'WAITLISTED'
        AND "waitlistPosition" < 0`;
  }
}
