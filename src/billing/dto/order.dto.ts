import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { OrderPaymentMethod, OrderStatus } from '@prisma/client';

/** 下单请求：一个订单可包含多个报名明细 + 多个活动参赛费 */
export class CreateOrderDto {
  /** 报名 id 列表（至少 1 个） */
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  enrollment_ids: string[];

  /** 活动报名 id 列表（参赛费/参与费），可选 */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  event_registration_ids?: string[];

  /** 下单时选择的收款渠道，缺省 STRIPE（仅用于展示与引导，实际以各条 Payment.method 为准） */
  @IsOptional()
  @IsEnum(OrderPaymentMethod)
  payment_method?: OrderPaymentMethod;
}

/** 管理员订单列表查询条件 */
export class AdminOrdersQuery {
  /** 按订单状态过滤 */
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  /** 校区 id：按订单明细中报名的班级所属校区过滤 */
  @IsOptional()
  @IsString()
  campus?: string;
}
