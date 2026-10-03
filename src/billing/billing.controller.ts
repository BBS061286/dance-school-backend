import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../common/types';
import { BillingService } from './billing.service';
import { AdminOrdersQuery, CreateOrderDto } from './dto/order.dto';
import { RecordPaymentDto, RefundDto } from './dto/payment.dto';

/**
 * 账单路由：全局前缀 /api/v1 已在 main.ts 设置，此处用空前缀 + 相对路径。
 * 默认全部需要登录（JWT 全局守卫）；公开路由需显式 @Public()，本模块无公开路由。
 */
@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  /** 下单：家长 / 成人学员 */
  @Post('orders')
  @Roles('PARENT', 'ADULT_STUDENT')
  createOrder(
    @Request() req: { user: RequestUser },
    @Body() dto: CreateOrderDto,
  ) {
    return this.billingService.createOrder(req.user, dto);
  }

  /** 为订单创建 Stripe Checkout 会话（归属校验在 service） */
  @Post('orders/:id/create-checkout-session')
  createCheckoutSession(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.billingService.createCheckoutSession(req.user, id);
  }

  /** 学员自助提交付款（线下渠道，待管理员确认） */
  @Post('orders/:id/payments')
  recordSelfPayment(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.billingService.recordSelfPayment(req.user, id, dto);
  }

  /** 我的订单列表 */
  @Get('me/orders')
  myOrders(@Request() req: { user: RequestUser }) {
    return this.billingService.myOrders(req.user.id);
  }

  /** 管理员订单列表（可按状态 / 校区过滤） */
  @Get('admin/orders')
  @Roles('ADMIN')
  adminOrders(@Query() query: AdminOrdersQuery) {
    return this.billingService.adminOrders(query);
  }

  /** 管理员线下代收录入 */
  @Post('admin/orders/:id/payments')
  @Roles('ADMIN')
  recordAdminPayment(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.billingService.recordAdminPayment(req.user.id, id, dto);
  }

  /** 管理员确认一笔待核实付款 */
  @Post('admin/payments/:id/confirm')
  @Roles('ADMIN')
  confirmPayment(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.billingService.confirmPayment(req.user.id, id);
  }

  /** 管理员驳回一笔待核实付款 */
  @Post('admin/payments/:id/reject')
  @Roles('ADMIN')
  rejectPayment(@Param('id') id: string) {
    return this.billingService.rejectPayment(id);
  }

  /** 退款预览（按报名） */
  @Get('admin/enrollments/:id/refund-preview')
  @Roles('ADMIN')
  refundPreview(@Param('id') id: string) {
    return this.billingService.getRefundPreview(id);
  }

  /** 按报名退款 */
  @Post('admin/enrollments/:id/refund')
  @Roles('ADMIN')
  createRefund(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: RefundDto,
  ) {
    return this.billingService.createRefundForEnrollment(req.user.id, id, dto);
  }
}
