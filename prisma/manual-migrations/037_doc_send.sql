-- 037: 文件定向发送 + 文件库状态（幂等，可重复执行）
DO $$ BEGIN
  CREATE TYPE "DocumentStatus" AS ENUM ('LIBRARY', 'ACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE IF NOT EXISTS "DocumentSend" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "documentId" TEXT NOT NULL REFERENCES "Document"("id") ON DELETE CASCADE,
  "createdById" TEXT NOT NULL REFERENCES "User"("id"),
  "note" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "DocumentSendRecipient" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sendId" TEXT NOT NULL REFERENCES "DocumentSend"("id") ON DELETE CASCADE,
  "studentId" TEXT NOT NULL REFERENCES "Student"("id") ON DELETE CASCADE,
  "sentAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE("sendId", "studentId")
);

CREATE INDEX IF NOT EXISTS "DocumentSend_documentId_idx" ON "DocumentSend"("documentId");
CREATE INDEX IF NOT EXISTS "DocumentSendRecipient_sendId_idx" ON "DocumentSendRecipient"("sendId");
CREATE INDEX IF NOT EXISTS "DocumentSendRecipient_studentId_idx" ON "DocumentSendRecipient"("studentId");
