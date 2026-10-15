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
 * 扫描结束后顺带清理僵尸订单：报名被超时取消后，其上 PENDING 且无成功支付、
 * 所有明细已无可支付对象（报名不在待支付/已确认、活动报名不在待缴费）的订单
 * 置为 CANCELLED，避免学员端出现"0 笔报名待支付 + 1 笔待支付订单"。
 * PARTIALLY_PAID（有部分实付）不自动动，走退款流程。
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
    cancelledOrders: number;
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

    // 僵尸订单清理：报名超时被取消后，其上已建的 PENDING 订单会变成
    // "无报名可付" 的孤儿订单（学员端显示"0 笔报名待支付 + 1 笔待支付订单"）。
    // 规则：PENDING 且无成功支付的订单，若其所有明细都已"死亡"
    //（课程明细的报名不在 PENDING_PAYMENT/CONFIRMED；
    // 活动明细的活动报名 feeStatus 不是 ISSUED 或已取消），则置为 CANCELLED。
    // PARTIALLY_PAID（含部分实付）不自动动——涉及退钱，走退款流程由管理员处理。
    const cancelledOrders = await this.cancelZombiePendingOrders();

    return { cancelled, rolledBack, cancelledOrders };
  }

  /**
   * 取消已无可支付明细的 PENDING 订单。
   * 显式终态 CANCELLED 不参与状态派生（v2 R4/R5 约定），可直接置位。
   */
  private async cancelZombiePendingOrders(): Promise<number> {
    const orders = await this.prisma.order.findMany({
      where: {
        status: 'PENDING',
        payments: { none: { status: 'SUCCEEDED' } },
      },
      include: {
        items: {
          include: {
            enrollment: { select: { status: true } },
            eventRegistration: { select: { feeStatus: true, status: true } },
          },
        },
      },
    });

    let n = 0;
    for (const o of orders) {
      if (o.items.length === 0) continue;
      const hasLiveItem = o.items.some((it) => {
        const en = it.enrollment;
        if (en && (en.status === 'PENDING_PAYMENT' || en.status === 'CONFIRMED'))
          return true;
        const reg = it.eventRegistration;
        if (reg && reg.feeStatus === 'ISSUED' && reg.status !== 'CANCELLED')
          return true;
        return false;
      });
      if (!hasLiveItem) {
        await this.prisma.order.update({
          where: { id: o.id },
          data: { status: 'CANCELLED' },
        });
        n++;
      }
    }
    return n;
  }
}
