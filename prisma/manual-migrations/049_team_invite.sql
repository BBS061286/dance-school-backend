-- 049: 管理员组队邀请（EventTeamInvite）
-- 管理员选定学员发起组队邀请，家长接受后自动创建带 groupKey 的报名
-- 幂等：IF NOT EXISTS

-- 通知类型加 TEAM_INVITE（组队邀请）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'TEAM_INVITE' AND enumtypid = 'NotificationType'::regtype) THEN
    ALTER TYPE "NotificationType" ADD VALUE 'TEAM_INVITE';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "EventTeamInvite" (
  "id" TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE,
  "groupKey" TEXT NOT NULL,
  "groupName" TEXT NOT NULL,
  "studentId" TEXT NOT NULL REFERENCES "Student"("id") ON DELETE CASCADE,
  "invitedById" TEXT NOT NULL REFERENCES "User"("id"),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "respondedAt" TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS "EventTeamInvite_event_group_student_unique"
  ON "EventTeamInvite" ("eventId", "groupKey", "studentId");
CREATE INDEX IF NOT EXISTS "EventTeamInvite_student_idx"
  ON "EventTeamInvite" ("studentId");
CREATE INDEX IF NOT EXISTS "EventTeamInvite_event_idx"
  ON "EventTeamInvite" ("eventId");
