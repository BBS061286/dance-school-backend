-- 056: 系统设置 key-value 表（幂等）
CREATE TABLE IF NOT EXISTS "SystemSetting" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
