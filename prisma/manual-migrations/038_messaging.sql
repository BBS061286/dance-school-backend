-- 038: 私信增强：MESSAGE_RECEIVED 通知类型 + 快捷回复模板表（幂等）

-- 1. NotificationType 新增 MESSAGE_RECEIVED（用户发私信时通知所有管理员）
DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE 'MESSAGE_RECEIVED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. 快捷回复模板表
CREATE TABLE IF NOT EXISTS "MessageTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "MessageTemplate_createdById_idx" ON "MessageTemplate"("createdById");

-- 3. 预置 3 条默认模板（按 title 去重，幂等；无 ADMIN 用户时跳过）
INSERT INTO "MessageTemplate" ("id", "title", "body", "createdById")
SELECT 'tpl-tuition-received', '学费已收到',
  '您好，您孩子的学费已收到，感谢您的支持！如有疑问请随时联系我们。',
  (SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "MessageTemplate" WHERE "title" = '学费已收到')
  AND EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ADMIN');

INSERT INTO "MessageTemplate" ("id", "title", "body", "createdById")
SELECT 'tpl-on-time', '请准时上课',
  '您好，提醒您按时参加课程，请提前10分钟到场做好准备。谢谢！',
  (SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "MessageTemplate" WHERE "title" = '请准时上课')
  AND EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ADMIN');

INSERT INTO "MessageTemplate" ("id", "title", "body", "createdById")
SELECT 'tpl-registered', '已帮您登记',
  '您好，您的需求已帮您登记，我们会尽快处理并回复您。谢谢！',
  (SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "MessageTemplate" WHERE "title" = '已帮您登记')
  AND EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ADMIN');
