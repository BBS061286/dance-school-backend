-- 054: Instructor 私信功能开关（管理员控制，防私单）
ALTER TABLE "Instructor" ADD COLUMN IF NOT EXISTS "messagingEnabled" BOOLEAN NOT NULL DEFAULT true;
