-- 040: 活动多票种（幂等）
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "ticketTiers" JSONB;
ALTER TABLE "EventRegistration" ADD COLUMN IF NOT EXISTS "ticketTierBreakdown" JSONB;
