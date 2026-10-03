import { ReminderTargetType } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/** 更新提醒规则：全部字段可选（设计文档 §4.8 PATCH /admin/reminder-rules/:id） */
export class UpdateReminderRuleDto {
  @IsEnum(ReminderTargetType, { message: 'targetType 必须是 SESSION_OCCURRENCE 或 EVENT' })
  @IsOptional()
  targetType?: ReminderTargetType;

  @IsInt({ message: 'offsetHoursBefore 必须是整数' })
  @Min(0, { message: 'offsetHoursBefore 不能为负数' })
  @IsOptional()
  offsetHoursBefore?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'channels 至少包含一个渠道' })
  @IsString({ each: true })
  @IsIn(['sms', 'email', 'push'], {
    each: true,
    message: 'channel 仅支持 sms / email / push',
  })
  @IsOptional()
  channels?: string[];

  @IsString()
  @IsOptional()
  templateKey?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
