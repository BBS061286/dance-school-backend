import { ReminderTargetType } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/** 创建提醒规则（设计文档 §4.8 / §2.14）。channels 与 schema 的 ReminderRule.channels 对齐。 */
export class CreateReminderRuleDto {
  @IsEnum(ReminderTargetType, { message: 'targetType 必须是 SESSION_OCCURRENCE 或 EVENT' })
  targetType: ReminderTargetType;

  @IsInt({ message: 'offsetHoursBefore 必须是整数' })
  @Min(0, { message: 'offsetHoursBefore 不能为负数' })
  offsetHoursBefore: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'channels 至少包含一个渠道' })
  @IsString({ each: true })
  @IsIn(['sms', 'email', 'push'], {
    each: true,
    message: 'channel 仅支持 sms / email / push',
  })
  channels: string[];

  @IsString()
  @IsNotEmpty({ message: 'templateKey 不能为空' })
  templateKey: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
