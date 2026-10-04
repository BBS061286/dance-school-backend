-- 039: 比赛报名费（Event.participationFeeCents / feeMode）+ EventRegistration.groupKey（SPLIT 均摊分组）
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "participationFeeCents" INTEGER;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "feeMode" TEXT;
ALTER TABLE "EventRegistration" ADD COLUMN IF NOT EXISTS "groupKey" TEXT;
