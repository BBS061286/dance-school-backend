-- 062: 私教/加课申请加"期望老师"字段
ALTER TABLE "ExtraLessonRequest" ADD COLUMN "preferredInstructorId" TEXT;
ALTER TABLE "ExtraLessonRequest" ADD CONSTRAINT "ExtraLessonRequest_preferredInstructorId_fkey" FOREIGN KEY ("preferredInstructorId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
