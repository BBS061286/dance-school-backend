-- 045: 加课申请加 campusId（幂等）

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ExtraLessonRequest' AND column_name = 'campusId'
  ) THEN
    ALTER TABLE "ExtraLessonRequest" ADD COLUMN "campusId" TEXT;
    ALTER TABLE "ExtraLessonRequest"
      ADD CONSTRAINT "ExtraLessonRequest_campusId_fkey"
      FOREIGN KEY ("campusId") REFERENCES "Campus"(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
