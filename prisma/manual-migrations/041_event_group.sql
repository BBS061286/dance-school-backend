-- 041: 比赛组队：Event.groupSize + EventRegistration.groupName（幂等）
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "groupSize" INTEGER;
ALTER TABLE "EventRegistration" ADD COLUMN IF NOT EXISTS "groupName" TEXT;
