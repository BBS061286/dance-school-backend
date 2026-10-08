-- 048: 私信支持多会话（一用户可分别与管理员、各老师私信）
-- MessageThread 加 peerType（ADMIN/INSTRUCTOR）+ peerId（老师会话时为老师的 userId）
-- 幂等：列存在则跳过添加；约束/索引用 IF NOT EXISTS / DROP IF EXISTS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'MessageThread' AND column_name = 'peerType'
  ) THEN
    ALTER TABLE "MessageThread" ADD COLUMN "peerType" TEXT NOT NULL DEFAULT 'ADMIN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'MessageThread' AND column_name = 'peerId'
  ) THEN
    ALTER TABLE "MessageThread" ADD COLUMN "peerId" TEXT;
  END IF;
END $$;

-- 旧唯一约束（一用户仅一条 thread）改掉
ALTER TABLE "MessageThread" DROP CONSTRAINT IF EXISTS "MessageThread_participantId_key";

-- 新唯一：同一用户 + 同一对象仅一条会话（peerId 为 NULL 时按空串处理，保证管理员会话也唯一）
CREATE UNIQUE INDEX IF NOT EXISTS "MessageThread_participant_peer_unique"
  ON "MessageThread" ("participantId", "peerType", COALESCE("peerId", ''));
