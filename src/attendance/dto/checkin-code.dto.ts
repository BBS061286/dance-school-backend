import { IsOptional, IsString, IsUUID } from 'class-validator';

/** 扫码打卡：POST /check-in/by-code */
export class CheckInByCodeDto {
  /** 签到码（POST /admin/occurrences/:id/checkin-code 生成，15 分钟有效） */
  @IsString()
  code: string;

  /**
   * 报名 id；兼容传学员 id：
   * service 先按 enrollment id 查（须属于该课次所在班级），查不到再按
   * student id 查该学员在本班最新一条未取消的报名。
   */
  @IsUUID('4')
  enrollment_id: string;

  /** 手写签名（图片 URL 或 dataURL），可选；存入 AttendanceRecord.signatureUrl */
  @IsOptional()
  @IsString()
  signature?: string;
}
