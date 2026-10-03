import { Injectable } from '@nestjs/common';
import { RequestUser } from '../common/types';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 定时任务用的系统请求者：走 cancelEnrollment 的 ADMIN 角色分支（跳过归属校验）；
 * requester.id 不会写入任何表，仅用于鉴权判断，因此可用合成账号。
 */
const SYSTEM_REQUESTER: RequestUser = {
  id: 'system',
  email: 'system@fjw-dance.local',
  role: 'ADMIN',
};

/**
 * 支付超时扫描（设计文档 §五"支付超时任务"，每 10 分钟）：
 * 扫描 Enrollment.status=PENDING_PAYMENT 且 paymentExpiresAt < now()，
 * 排除关联订单下有 PENDING_CONFIRM Payment 的（超时豁免）：
 * - promotedAt 为空（新报名）→ 调 enrollmentsService.cancelEnrollment（cancelReason="支付超时"，
 *   其内部释放名额并触发候补转正）；
 * - promotedAt 非空（候补转正）→ 事务内调 enrollmentsService.rollbackTimedOutPromotion。
 */
@Injectable()
export class PaymentTimeoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  async scanPaymentTimeouts(): Promise<{
    cancelled: number;
    rolledBack: number;
  }> {
    const now = new Date();
    const expired = await this.prisma.enrollment.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        paymentExpiresAt: { lt: now },
        // 超时豁免：关联订单下存在待管理员核实的线下付款
        NOT: {
          orderItems: {
            some: {
              order: { payments: { some: { status: 'PENDING_CONFIRM' } } },
            },
          },
        },
      },
    });

    let cancelled = 0;
    let rolledBack = 0;
    for (const e of expired) {
      if (!e.promotedAt) {
        await this.enrollments.cancelEnrollment(
          SYSTEM_REQUESTER,
          e.id,
          '支付超时',
        );
        cancelled++;
      } else {
        await this.prisma.$transaction((tx) =>
          this.enrollments.rollbackTimedOutPromotion(tx, e.id),
        );
        rolledBack++;
      }
    }
    return { cancelled, rolledBack };
  }
}
