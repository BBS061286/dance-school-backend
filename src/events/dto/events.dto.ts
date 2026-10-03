import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import {
  EventCategory,
  EventRegistrationItemType,
  NoticeScopeType,
} from '@prisma/client';

/** 创建活动/比赛（ADMIN） */
export class CreateEventDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** 校区 id（线上活动可空） */
  @IsOptional()
  @IsUUID('4')
  campus_id?: string;

  /** 仅 campus_id 为空（线上活动）时使用，IANA 时区名 */
  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsString()
  start_time: string;

  @IsString()
  end_time: string;

  @IsOptional()
  @IsBoolean()
  requires_registration?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  /** EVENT=活动 / COMPETITION=比赛 */
  @IsOptional()
  @IsEnum(EventCategory)
  category?: EventCategory;

  /** 是否需要购票 */
  @IsOptional()
  @IsBoolean()
  requires_ticket?: boolean;

  /** 票单价（分），requires_ticket=true 时必填 */
  @IsOptional()
  @IsInt()
  @Min(0)
  ticket_price_cents?: number;

  /** 每次报名最多购票数 */
  @IsOptional()
  @IsInt()
  @Min(1)
  max_tickets_per_registration?: number;
}

/** 报名活动/比赛：{ ticket_quantity? } */
export class RegisterEventDto {
  /** 购票数量（requires_ticket 时必填，缺省 1） */
  @IsOptional()
  @IsInt()
  @Min(1)
  ticket_quantity?: number;

  /** 参赛学员（可选；成人学员缺省取 SELF 绑定） */
  @IsOptional()
  @IsUUID('4')
  student_id?: string;
}

/** 管理员发放参赛/参与费用 */
export class IssueFeeDto {
  @IsInt()
  @Min(0)
  participation_fee_cents: number;
}

/** 学员缴费：门票款或参赛费 */
export class PayEventRegistrationDto {
  @IsEnum(EventRegistrationItemType)
  item_type: EventRegistrationItemType;
}

/** 发布通知（ADMIN） */
export class CreateNoticeDto {
  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsEnum(NoticeScopeType)
  scope_type: NoticeScopeType;

  /** ALL 时为空；其余为 Campus / Course / ClassSession / Parent 的 id */
  @IsOptional()
  @IsString()
  scope_id?: string;

  /** 发送渠道，缺省 ['app_push'] */
  @IsOptional()
  @IsString({ each: true })
  channels?: string[];
}
