import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
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

  /** 比赛报名费（分）。仅 COMPETITION 生效 */
  @IsOptional()
  @IsInt()
  @Min(0)
  participation_fee_cents?: number;

  /** 收费模式：PER_PERSON=按人收全额，SPLIT=总费用按组均摊 */
  @IsOptional()
  @IsIn(['PER_PERSON', 'SPLIT'])
  fee_mode?: string;

  /** 多票种（可选）；为空则只用 ticket_price_cents 单一票价 */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TicketTierDto)
  ticket_tiers?: TicketTierDto[];
}

/** 票种定义 */
export class TicketTierDto {
  @IsString()
  name: string;

  @IsInt()
  @Min(0)
  price_cents: number;

  /** 该票种单次最少购买数（如团体票 5 张起） */
  @IsOptional()
  @IsInt()
  @Min(1)
  min_quantity?: number;

  /** 早鸟截止（ISO 时间），过期后不可买 */
  @IsOptional()
  @IsDateString()
  valid_until?: string;
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

  /** 票种名（多票种活动可选；不传用默认票价） */
  @IsOptional()
  @IsString()
  tier_name?: string;
}

/** 管理员代报名活动/比赛：{ student_id, ticket_quantity?, group_key? } */
export class AdminRegisterEventDto {
  @IsUUID('4')
  student_id: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  ticket_quantity?: number;

  /** SPLIT 均摊模式下指定加入的组；不传则自动新建一组 */
  @IsOptional()
  @IsString()
  group_key?: string;

  /** 票种名（多票种活动可选） */
  @IsOptional()
  @IsString()
  tier_name?: string;
}

/** 管理员发放参赛/参与费用 */
export class IssueFeeDto {
  @IsInt()
  @Min(0)
  participation_fee_cents: number;
}

/** 加购门票：{ quantity, tier_name? } */
export class AddTicketsDto {
  @IsInt()
  @Min(1)
  quantity: number;

  /** 票种名（多票种活动可选） */
  @IsOptional()
  @IsString()
  tier_name?: string;
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
