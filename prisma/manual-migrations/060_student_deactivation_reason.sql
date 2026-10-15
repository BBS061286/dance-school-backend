-- 060: 学员停用原因（2026-10-15 Bin 定：学期内不退款，除非不可抗力如生病）
-- 停用时记录原因/时间/备注/操作人，启用时清空

CREATE TYPE "DeactivationReason" AS ENUM (
  'ILLNESS_INJURY',
  'RELOCATION',
  'SCHEDULE_CONFLICT',
  'DISSATISFIED',
  'FINANCIAL',
  'OTHER'
);

ALTER TABLE "Student" ADD COLUMN "deactivationReason" "DeactivationReason";
ALTER TABLE "Student" ADD COLUMN "deactivatedAt" TIMESTAMPTZ;
ALTER TABLE "Student" ADD COLUMN "deactivationNote" TEXT;
ALTER TABLE "Student" ADD COLUMN "deactivatedById" TEXT;
