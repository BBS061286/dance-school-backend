-- 046: 学校假期日历 + 课次停课申请（幂等）

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CancelRequestStatus') THEN
    CREATE TYPE "CancelRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Holiday" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  CONSTRAINT "Holiday_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Holiday_date_key" UNIQUE ("date")
);

CREATE TABLE IF NOT EXISTS "OccurrenceCancelRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "occurrenceId" TEXT NOT NULL,
  "instructorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "postpone" BOOLEAN NOT NULL DEFAULT true,
  "status" "CancelRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OccurrenceCancelRequest_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "SessionOccurrence"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OccurrenceCancelRequest_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OccurrenceCancelRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "OccurrenceCancelRequest_occurrenceId_idx" ON "OccurrenceCancelRequest"("occurrenceId");
CREATE INDEX IF NOT EXISTS "OccurrenceCancelRequest_status_idx" ON "OccurrenceCancelRequest"("status");
