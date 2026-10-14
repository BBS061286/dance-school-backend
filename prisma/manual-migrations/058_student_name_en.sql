-- 058: 学员英文名（幂等）
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "nameEn" TEXT;
