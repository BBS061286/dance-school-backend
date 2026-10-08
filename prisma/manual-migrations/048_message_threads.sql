-- 048: 私信支持多会话（一用户可分别与管理员、各老师私信）
-- MessageThread 加 peerType（ADMIN/INSTRUCTOR）+ peerId（老师会话时为老师的 userId）
-- 幂等：IF NOT EXISTS
ALTER TABLE "MessageThread" ADD COLUMN IF NOT EXISTS "peerType" TEXT NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "MessageThread" ADD COLUMN IF NOT EXISTS "peerId" TEXT;

-- 旧唯一约束（一用户仅一条 thread）改掉
ALTER TABLE "MessageThread" DROP CONSTRAINT IF EXISTS "MessageThread_participantId_key";

-- 新唯一：同一用户 + 同一对象仅一条会话（peerId 为 NULL 时按空串处理，保证管理员会话也唯一）
CREATE UNIQUE INDEX IF NOT EXISTS "MessageThread_participant_peer_unique"
  ON "MessageThread" ("participantId", "peerType", COALESCE("peerId", ''));
