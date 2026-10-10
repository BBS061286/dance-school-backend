-- 052: 私教课/加课学员出勤记录表 ExtraLessonAttendance
-- 幂等：CREATE TABLE IF NOT EXISTS；列/约束用 DO 块补齐

CREATE TABLE IF NOT EXISTS "ExtraLessonAttendance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slotId" TEXT NOT NULL REFERENCES "ExtraLessonSlot"("id") ON DELETE CASCADE,
  "studentId" TEXT NOT NULL REFERENCES "Student"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL,
  "checkedInAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "checkedInBy" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ExtraLessonAttendance_slotId_studentId_key'
  ) THEN
    ALTER TABLE "ExtraLessonAttendance"
      ADD CONSTRAINT "ExtraLessonAttendance_slotId_studentId_key" UNIQUE ("slotId", "studentId");
  END IF;
END $$;
