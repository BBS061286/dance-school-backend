import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
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

  /** 课程 id：按订单明细中报名的班级所属课程过滤 */
  @IsOptional()
  @IsString()
  course?: string;

  /** 学期 id：按订单明细中报名的班级所属课程的学期过滤（可查历史学期缴款） */
  @IsOptional()
  @IsString()
  term?: string;

  /** 学员类型：YOUTH 小孩 / ADULT 成人（按订单中所有学员判定，含混合订单） */
  @IsOptional()
  @IsIn(['YOUTH', 'ADULT'])
  student_type?: string;

  /** 缴费类型：GROUP 大课 / PRIVATE 私教课 / MASTER 大师课 / EVENT 活动 / COMPETITION 比赛 */
  @IsOptional()
  @IsIn(['GROUP', 'PRIVATE', 'MASTER', 'EVENT', 'COMPETITION'])
  kind?: string;
}

/** 退款中心-课程报名查询条件 */
export class RefundEnrollmentQuery {
  /** 学期 id */
  @IsOptional()
  @IsString()
  term?: string;

  /** 课程类型：大课 GROUP / 大师课 MASTER / 私教课 PRIVATE */
  @IsOptional()
  @IsString()
  format?: string;

  /** 校区 id */
  @IsOptional()
  @IsString()
  campus?: string;

  /** 课程 id */
  @IsOptional()
  @IsString()
  course?: string;

  /** 学员姓名关键字 */
  @IsOptional()
  @IsString()
  student?: string;
}

/** 退款中心-活动报名查询条件 */
export class RefundEventRegistrationQuery {
  /** 活动 id */
  @IsOptional()
  @IsString()
  event?: string;

  /** 年份，如 2025 / 2026：按活动开始时间过滤 */
  @IsOptional()
  @IsString()
  year?: string;
}

/** 退款记录查询条件 */
export class RefundRecordQuery {
  /** 学期 id（仅课程报名类退款） */
  @IsOptional()
  @IsString()
  term?: string;
}
