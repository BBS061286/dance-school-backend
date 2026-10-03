import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 名额计数对账（设计文档 §五"名额计数对账任务"，每天凌晨 3 点）：
 * 逐 ClassSession 统计 status ∈ {CONFIRMED, PENDING_PAYMENT} 的 Enrollment 数，
 * 与 enrolledCount 比对；不一致则对该行加 FOR UPDATE 锁后重算并修正，
 * 以实际数为准，同时 console.warn 告警便于排查漏减/多加的代码路径。
 */
@Injectable()
export class SeatReconcileService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcileSeats(): Promise<{ checked: number; fixed: number }> {
    const sessions = await this.prisma.classSession.findMany({
      select: { id: true, enrolledCount: true },
    });
    let fixed = 0;
    for (const s of sessions) {
      const actual = await this.countOccupied(s.id);
      if (actual === s.enrolledCount) continue;

      await this.prisma.$transaction(async (tx) => {
        // 行锁，避免与并发报名冲突
        await tx.$queryRaw`SELECT id FROM "ClassSession" WHERE id = ${s.id} FOR UPDATE`;
        const recount = await tx.enrollment.count({
          where: {
            classSessionId: s.id,
            status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
          },
        });
        await tx.classSession.update({
          where: { id: s.id },
          data: { enrolledCount: recount },
        });
        // eslint-disable-next-line no-console
        console.warn(
          `[seat-reconcile] ClassSession ${s.id}: enrolledCount ${s.enrolledCount} → ${recount}（已修正）`,
        );
      });
      fixed++;
    }
    return { checked: sessions.length, fixed };
  }

  private countOccupied(classSessionId: string): Promise<number> {
    return this.prisma.enrollment.count({
      where: {
        classSessionId,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
      },
    });
  }
}
