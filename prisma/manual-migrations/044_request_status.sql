-- 044: 加课申请加 status 状态字段（幂等）
-- PENDING 待审批 / APPROVED 待排期 / REJECTED 已拒绝 / IN_PROGRESS 排期中 / DONE 已完成

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExtraLessonRequestStatus') THEN
    CREATE TYPE "ExtraLessonRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'DONE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ExtraLessonRequest' AND column_name = 'status'
  ) THEN
    ALTER TABLE "ExtraLessonRequest" ADD COLUMN "status" "ExtraLessonRequestStatus" NOT NULL DEFAULT 'PENDING';
  END IF;
END $$;

-- 已有数据的状态回填：有已确认时段→DONE，有时段→IN_PROGRESS，否则 PENDING
UPDATE "ExtraLessonRequest" r SET "status" = 'DONE'
WHERE r."status" = 'PENDING'
  AND EXISTS (SELECT 1 FROM "ExtraLessonSlot" s WHERE s."requestId" = r.id AND s."status" = 'CONFIRMED');

UPDATE "ExtraLessonRequest" r SET "status" = 'IN_PROGRESS'
WHERE r."status" = 'PENDING'
  AND EXISTS (SELECT 1 FROM "ExtraLessonSlot" s WHERE s."requestId" = r.id);
