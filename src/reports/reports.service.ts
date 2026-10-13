import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 经营报表：只读聚合。金额口径与 BillingService 保持一致：
 *   实收 = Σ Payment(status=SUCCEEDED)
 *   退款 = Σ RefundRecord.amountCents
 *   待收 = Σ (order.amountCents - 实收)，仅统计 PENDING / PARTIALLY_PAID 订单
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 解析课时时长，如 "17:00-18:00" = 1 小时；解析失败按 1 小时（与 InstructorsService 保持一致） */
  private parseHours(tr?: string | null): number {
    if (!tr) return 1;
    const m = tr.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (!m) return 1;
    const start = parseInt(m[1]) * 60 + parseInt(m[2]);
    const end = parseInt(m[3]) * 60 + parseInt(m[4]);
    const diff = end - start;
    return diff > 0 ? diff / 60 : 1;
  }

  async summary() {
    // ---- 学期列表（含"未分学期"兜底） ----
    const terms = await this.prisma.term.findMany({
      orderBy: { startDate: 'desc' },
      select: { id: true, name: true, isActive: true },
    });
    const byTerm = new Map<
      string,
      {
        termId: string;
        termName: string;
        collectedCents: number;
        pendingCents: number;
        refundedCents: number;
        enrollments: number;
        waitlisted: number;
      }
    >();
    const termBucket = (id: string, name: string) => {
      if (!byTerm.has(id))
        byTerm.set(id, {
          termId: id,
          termName: name,
          collectedCents: 0,
          pendingCents: 0,
          refundedCents: 0,
          enrollments: 0,
          waitlisted: 0,
        });
      return byTerm.get(id)!;
    };

    // ---- 订单：实收 / 待收 / 退款 ----
    // 一个订单可能包含多门课的报名（跨学期），按明细行归属学期分摊：
    // 先按订单整单归属"首个报名明细的学期"，简化口径（页面标注说明）。
    const orders = await this.prisma.order.findMany({
      where: { status: { notIn: ['FAILED', 'CANCELLED'] } },
      select: {
        amountCents: true,
        status: true,
        payments: { where: { status: 'SUCCEEDED' }, select: { amountCents: true } },
        refunds: { select: { amountCents: true } },
        items: {
          select: {
            amountCents: true,
            enrollment: {
              select: {
                classSession: {
                  select: { course: { select: { term: { select: { id: true, name: true } } } } },
                },
              },
            },
          },
        },
      },
    });
    let totalCollectedCents = 0;
    let totalPendingCents = 0;
    let totalRefundedCents = 0;
    for (const o of orders) {
      const paid = o.payments.reduce((s, p) => s + p.amountCents, 0);
      const refunded = o.refunds.reduce((s, r) => s + r.amountCents, 0);
      totalCollectedCents += paid;
      totalRefundedCents += refunded;
      // 订单归属学期：取首个有课程的报名明细
      let termId = 'no-term';
      let termName = '未分学期';
      for (const it of o.items) {
        const t = it.enrollment?.classSession?.course?.term;
        if (t) {
          termId = t.id;
          termName = t.name;
          break;
        }
      }
      const b = termBucket(termId, termName);
      b.collectedCents += paid;
      b.refundedCents += refunded;
      if (o.status === 'PENDING' || o.status === 'PARTIALLY_PAID') {
        const receivable = Math.max(0, o.amountCents - paid);
        totalPendingCents += receivable;
        b.pendingCents += receivable;
      }
    }

    // ---- 报名数 / 候补数（按学期） ----
    const enrollments = await this.prisma.enrollment.findMany({
      where: { status: { notIn: ['CANCELLED'] } },
      select: {
        status: true,
        classSession: {
          select: { course: { select: { term: { select: { id: true, name: true } } } } },
        },
      },
    });
    let totalEnrollments = 0;
    let totalWaitlisted = 0;
    for (const e of enrollments) {
      const t = e.classSession?.course?.term;
      const b = termBucket(t?.id ?? 'no-term', t?.name ?? '未分学期');
      if (e.status === 'WAITLISTED') {
        totalWaitlisted += 1;
        b.waitlisted += 1;
      } else {
        totalEnrollments += 1;
        b.enrollments += 1;
      }
    }

    // ---- 本学期老师课时 ----
    const now = new Date();
    const currentTerm =
      terms.find((t) => t.isActive) ??
      terms.find((t) => true) ??
      null;
    const instructorHours: {
      instructorId: string;
      name: string;
      sessions: number;
      hours: number;
    }[] = [];
    if (currentTerm && currentTerm.id !== 'no-term') {
      const sessions = await this.prisma.classSession.findMany({
        where: { course: { termId: currentTerm.id } },
        select: {
          instructorId: true,
          instructor: { select: { user: { select: { name: true } } } },
          occurrences: {
            where: { status: { not: 'CANCELLED' } },
            select: { timeRange: true, substituteInstructorId: true },
          },
        },
      });
      const byInstructor = new Map<string, { name: string; sessions: number; hours: number }>();
      for (const s of sessions) {
        const name = s.instructor?.user?.name ?? '未知老师';
        if (!byInstructor.has(s.instructorId))
          byInstructor.set(s.instructorId, { name, sessions: 0, hours: 0 });
        const g = byInstructor.get(s.instructorId)!;
        g.sessions += 1;
        // 有代课老师的课次不计入原老师
        g.hours += s.occurrences
          .filter((o) => !o.substituteInstructorId)
          .reduce((sum, o) => sum + this.parseHours(o.timeRange), 0);
      }
      for (const [instructorId, g] of byInstructor) {
        instructorHours.push({
          instructorId,
          name: g.name,
          sessions: g.sessions,
          hours: Math.round(g.hours * 10) / 10,
        });
      }
      instructorHours.sort((a, b) => b.hours - a.hours);
    }

    return {
      revenue: {
        totalCollectedCents,
        totalPendingCents,
        totalRefundedCents,
      },
      enrollments: { total: totalEnrollments, waitlisted: totalWaitlisted },
      byTerm: [...byTerm.values()].sort((a, b) => b.collectedCents - a.collectedCents),
      currentTerm: currentTerm ? { id: currentTerm.id, name: currentTerm.name } : null,
      instructorHours,
      generatedAt: now.toISOString(),
    };
  }
}
