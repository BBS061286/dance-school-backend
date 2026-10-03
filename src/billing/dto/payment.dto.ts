import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/** 学员自助提交付款 / 管理员线下代收录入（允许的 method 取值由 service 层按场景校验） */
export class RecordPaymentDto {
  /** 付款方式：学员端 ZELLE / PAYPAL / CASH / CHECK / OTHER；管理员端 CASH / CHECK / ZELLE / PAYPAL */
  @IsString()
  method: string;

  /** 付款金额（分），必须为正整数 */
  @IsInt()
  @Min(1)
  amount_cents: number;

  /** 交易备注 / 参考号（Zelle 备注、PayPal 交易号等），可选 */
  @IsOptional()
  @IsString()
  external_ref?: string;
}

/** 退款请求：金额缺省时按退款预览的建议金额（通常为可退全额）执行 */
export class RefundDto {
  /** 退款金额（分），缺省为预览建议金额 */
  @IsOptional()
  @IsInt()
  @Min(1)
  amount_cents?: number;

  /** 退款原因，可选 */
  @IsOptional()
  @IsString()
  reason?: string;
}
