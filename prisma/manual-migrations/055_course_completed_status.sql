-- 055: 课程状态新增 COMPLETED（已完课）
-- 已完课的课程保留为历史记录（家长端不可报名、但详情可查），不再用 ARCHIVED 藏起来。
ALTER TYPE "CourseStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
