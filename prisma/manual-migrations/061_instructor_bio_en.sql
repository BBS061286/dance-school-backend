-- 061: 老师英文简介/擅长（幂等）
ALTER TABLE "Instructor" ADD COLUMN IF NOT EXISTS "bioEn" TEXT;
ALTER TABLE "Instructor" ADD COLUMN IF NOT EXISTS "specialtiesEn" TEXT[] DEFAULT '{}';
