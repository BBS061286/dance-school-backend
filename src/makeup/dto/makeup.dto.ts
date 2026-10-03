import { IsOptional, IsUUID } from 'class-validator';

/** 配置补课资格：把 eligible 班级加入 source 班级的"可补课去向"列表 */
export class CreateMakeupEligibilityDto {
  /** 允许去补课的班级档期 id */
  @IsUUID('4')
  eligible_class_session_id: string;
}

/** 预约补课 */
export class CreateMakeupBookingDto {
  /** 缺课学员的报名 id */
  @IsUUID('4')
  enrollment_id: string;

  /** 原本缺席的场次（可空，表示提前请假预约） */
  @IsOptional()
  @IsUUID('4')
  missed_occurrence_id?: string;

  /** 实际去补课的场次 */
  @IsUUID('4')
  makeup_occurrence_id: string;
}
