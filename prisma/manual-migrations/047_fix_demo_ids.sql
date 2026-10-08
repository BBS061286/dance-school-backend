-- 047: 演示数据的可读 ID（demo-*/demo2-*/demo3-*/seed-*）换成合法 UUID，否则报名等接口的 UUID 校验会拦掉
-- 幂等：跑过后 demo ID 已全部替换，再跑就是空操作
-- 2026-10-08 重写版 v2：修复 v1 的两个致命问题：
--   一是 v1 对 CourseCampus、CourseInstructor、EventRegistrationOrder 三张复合主键表 SELECT 了不存在的 id 列，整条语句直接报错回滚；
--   二是 v1 同一张表的同一行可能被 PK 更新和 FK 更新各改一次，PG 只保留其中一个，会留下悬空外键。
-- 本版：单条语句内每表恰好一个 UPDATE（FK 只在语句结束时检查一次），标量相关子查询逐列重映射，无行会被改两次。
WITH
map_AttendanceRecord AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "AttendanceRecord" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Campus AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Campus" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_ClassSession AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "ClassSession" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Course AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Course" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_CourseReview AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "CourseReview" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Document AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Document" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_DocumentSend AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "DocumentSend" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_DocumentSendRecipient AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "DocumentSendRecipient" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_DocumentSignature AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "DocumentSignature" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Enrollment AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Enrollment" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Event AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Event" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_EventRegistration AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "EventRegistration" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_ExtraLessonRequest AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "ExtraLessonRequest" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_ExtraLessonSlot AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "ExtraLessonSlot" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Holiday AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Holiday" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Instructor AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Instructor" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_InstructorCheckin AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "InstructorCheckin" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_MakeupBooking AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "MakeupBooking" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_MakeupEligibility AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "MakeupEligibility" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Message AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Message" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_MessageTemplate AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "MessageTemplate" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_MessageThread AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "MessageThread" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Notice AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Notice" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Notification AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Notification" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_OccurrenceCancelRequest AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "OccurrenceCancelRequest" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Order AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Order" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_OrderItem AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "OrderItem" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_ParentStudentLink AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "ParentStudentLink" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Payment AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Payment" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_RefundRecord AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "RefundRecord" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_ReminderLog AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "ReminderLog" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_ReminderRule AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "ReminderRule" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_SessionOccurrence AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "SessionOccurrence" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Student AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Student" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_StudentReview AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "StudentReview" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_Term AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "Term" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
map_User AS (SELECT "id" AS old_id, gen_random_uuid()::text AS new_id FROM "User" WHERE "id" LIKE 'demo-%' OR "id" LIKE 'demo2-%' OR "id" LIKE 'demo3-%' OR "id" LIKE 'seed-%'),
u_AttendanceRecord AS (
  UPDATE "AttendanceRecord" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_AttendanceRecord x WHERE x.old_id = t."id"), t."id"),
    "sessionOccurrenceId" = COALESCE((SELECT x.new_id FROM map_SessionOccurrence x WHERE x.old_id = t."sessionOccurrenceId"), t."sessionOccurrenceId"),
    "enrollmentId" = COALESCE((SELECT x.new_id FROM map_Enrollment x WHERE x.old_id = t."enrollmentId"), t."enrollmentId"),
    "confirmedById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."confirmedById"), t."confirmedById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."sessionOccurrenceId" LIKE 'demo-%' OR t."sessionOccurrenceId" LIKE 'demo2-%' OR t."sessionOccurrenceId" LIKE 'demo3-%' OR t."sessionOccurrenceId" LIKE 'seed-%')
     OR (t."enrollmentId" LIKE 'demo-%' OR t."enrollmentId" LIKE 'demo2-%' OR t."enrollmentId" LIKE 'demo3-%' OR t."enrollmentId" LIKE 'seed-%')
     OR (t."confirmedById" LIKE 'demo-%' OR t."confirmedById" LIKE 'demo2-%' OR t."confirmedById" LIKE 'demo3-%' OR t."confirmedById" LIKE 'seed-%')
),
u_Campus AS (
  UPDATE "Campus" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Campus x WHERE x.old_id = t."id"), t."id")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
),
u_ClassSession AS (
  UPDATE "ClassSession" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_ClassSession x WHERE x.old_id = t."id"), t."id"),
    "courseId" = COALESCE((SELECT x.new_id FROM map_Course x WHERE x.old_id = t."courseId"), t."courseId"),
    "campusId" = COALESCE((SELECT x.new_id FROM map_Campus x WHERE x.old_id = t."campusId"), t."campusId"),
    "instructorId" = COALESCE((SELECT x.new_id FROM map_Instructor x WHERE x.old_id = t."instructorId"), t."instructorId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."courseId" LIKE 'demo-%' OR t."courseId" LIKE 'demo2-%' OR t."courseId" LIKE 'demo3-%' OR t."courseId" LIKE 'seed-%')
     OR (t."campusId" LIKE 'demo-%' OR t."campusId" LIKE 'demo2-%' OR t."campusId" LIKE 'demo3-%' OR t."campusId" LIKE 'seed-%')
     OR (t."instructorId" LIKE 'demo-%' OR t."instructorId" LIKE 'demo2-%' OR t."instructorId" LIKE 'demo3-%' OR t."instructorId" LIKE 'seed-%')
),
u_Course AS (
  UPDATE "Course" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Course x WHERE x.old_id = t."id"), t."id"),
    "termId" = COALESCE((SELECT x.new_id FROM map_Term x WHERE x.old_id = t."termId"), t."termId"),
    "sourceCourseId" = COALESCE((SELECT x.new_id FROM map_Course x WHERE x.old_id = t."sourceCourseId"), t."sourceCourseId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."termId" LIKE 'demo-%' OR t."termId" LIKE 'demo2-%' OR t."termId" LIKE 'demo3-%' OR t."termId" LIKE 'seed-%')
     OR (t."sourceCourseId" LIKE 'demo-%' OR t."sourceCourseId" LIKE 'demo2-%' OR t."sourceCourseId" LIKE 'demo3-%' OR t."sourceCourseId" LIKE 'seed-%')
),
u_CourseCampus AS (
  UPDATE "CourseCampus" AS t SET
    "courseId" = COALESCE((SELECT x.new_id FROM map_Course x WHERE x.old_id = t."courseId"), t."courseId"),
    "campusId" = COALESCE((SELECT x.new_id FROM map_Campus x WHERE x.old_id = t."campusId"), t."campusId")
  WHERE (t."courseId" LIKE 'demo-%' OR t."courseId" LIKE 'demo2-%' OR t."courseId" LIKE 'demo3-%' OR t."courseId" LIKE 'seed-%')
     OR (t."campusId" LIKE 'demo-%' OR t."campusId" LIKE 'demo2-%' OR t."campusId" LIKE 'demo3-%' OR t."campusId" LIKE 'seed-%')
),
u_CourseInstructor AS (
  UPDATE "CourseInstructor" AS t SET
    "courseId" = COALESCE((SELECT x.new_id FROM map_Course x WHERE x.old_id = t."courseId"), t."courseId"),
    "instructorId" = COALESCE((SELECT x.new_id FROM map_Instructor x WHERE x.old_id = t."instructorId"), t."instructorId")
  WHERE (t."courseId" LIKE 'demo-%' OR t."courseId" LIKE 'demo2-%' OR t."courseId" LIKE 'demo3-%' OR t."courseId" LIKE 'seed-%')
     OR (t."instructorId" LIKE 'demo-%' OR t."instructorId" LIKE 'demo2-%' OR t."instructorId" LIKE 'demo3-%' OR t."instructorId" LIKE 'seed-%')
),
u_CourseReview AS (
  UPDATE "CourseReview" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_CourseReview x WHERE x.old_id = t."id"), t."id"),
    "courseId" = COALESCE((SELECT x.new_id FROM map_Course x WHERE x.old_id = t."courseId"), t."courseId"),
    "createdById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."createdById"), t."createdById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."courseId" LIKE 'demo-%' OR t."courseId" LIKE 'demo2-%' OR t."courseId" LIKE 'demo3-%' OR t."courseId" LIKE 'seed-%')
     OR (t."createdById" LIKE 'demo-%' OR t."createdById" LIKE 'demo2-%' OR t."createdById" LIKE 'demo3-%' OR t."createdById" LIKE 'seed-%')
),
u_Document AS (
  UPDATE "Document" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Document x WHERE x.old_id = t."id"), t."id"),
    "supersedesDocumentId" = COALESCE((SELECT x.new_id FROM map_Document x WHERE x.old_id = t."supersedesDocumentId"), t."supersedesDocumentId"),
    "createdById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."createdById"), t."createdById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."supersedesDocumentId" LIKE 'demo-%' OR t."supersedesDocumentId" LIKE 'demo2-%' OR t."supersedesDocumentId" LIKE 'demo3-%' OR t."supersedesDocumentId" LIKE 'seed-%')
     OR (t."createdById" LIKE 'demo-%' OR t."createdById" LIKE 'demo2-%' OR t."createdById" LIKE 'demo3-%' OR t."createdById" LIKE 'seed-%')
),
u_DocumentSend AS (
  UPDATE "DocumentSend" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_DocumentSend x WHERE x.old_id = t."id"), t."id"),
    "documentId" = COALESCE((SELECT x.new_id FROM map_Document x WHERE x.old_id = t."documentId"), t."documentId"),
    "createdById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."createdById"), t."createdById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."documentId" LIKE 'demo-%' OR t."documentId" LIKE 'demo2-%' OR t."documentId" LIKE 'demo3-%' OR t."documentId" LIKE 'seed-%')
     OR (t."createdById" LIKE 'demo-%' OR t."createdById" LIKE 'demo2-%' OR t."createdById" LIKE 'demo3-%' OR t."createdById" LIKE 'seed-%')
),
u_DocumentSendRecipient AS (
  UPDATE "DocumentSendRecipient" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_DocumentSendRecipient x WHERE x.old_id = t."id"), t."id"),
    "sendId" = COALESCE((SELECT x.new_id FROM map_DocumentSend x WHERE x.old_id = t."sendId"), t."sendId"),
    "studentId" = COALESCE((SELECT x.new_id FROM map_Student x WHERE x.old_id = t."studentId"), t."studentId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."sendId" LIKE 'demo-%' OR t."sendId" LIKE 'demo2-%' OR t."sendId" LIKE 'demo3-%' OR t."sendId" LIKE 'seed-%')
     OR (t."studentId" LIKE 'demo-%' OR t."studentId" LIKE 'demo2-%' OR t."studentId" LIKE 'demo3-%' OR t."studentId" LIKE 'seed-%')
),
u_DocumentSignature AS (
  UPDATE "DocumentSignature" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_DocumentSignature x WHERE x.old_id = t."id"), t."id"),
    "documentId" = COALESCE((SELECT x.new_id FROM map_Document x WHERE x.old_id = t."documentId"), t."documentId"),
    "studentId" = COALESCE((SELECT x.new_id FROM map_Student x WHERE x.old_id = t."studentId"), t."studentId"),
    "signedById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."signedById"), t."signedById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."documentId" LIKE 'demo-%' OR t."documentId" LIKE 'demo2-%' OR t."documentId" LIKE 'demo3-%' OR t."documentId" LIKE 'seed-%')
     OR (t."studentId" LIKE 'demo-%' OR t."studentId" LIKE 'demo2-%' OR t."studentId" LIKE 'demo3-%' OR t."studentId" LIKE 'seed-%')
     OR (t."signedById" LIKE 'demo-%' OR t."signedById" LIKE 'demo2-%' OR t."signedById" LIKE 'demo3-%' OR t."signedById" LIKE 'seed-%')
),
u_Enrollment AS (
  UPDATE "Enrollment" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Enrollment x WHERE x.old_id = t."id"), t."id"),
    "classSessionId" = COALESCE((SELECT x.new_id FROM map_ClassSession x WHERE x.old_id = t."classSessionId"), t."classSessionId"),
    "studentId" = COALESCE((SELECT x.new_id FROM map_Student x WHERE x.old_id = t."studentId"), t."studentId"),
    "enrolledByParentId" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."enrolledByParentId"), t."enrolledByParentId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."classSessionId" LIKE 'demo-%' OR t."classSessionId" LIKE 'demo2-%' OR t."classSessionId" LIKE 'demo3-%' OR t."classSessionId" LIKE 'seed-%')
     OR (t."studentId" LIKE 'demo-%' OR t."studentId" LIKE 'demo2-%' OR t."studentId" LIKE 'demo3-%' OR t."studentId" LIKE 'seed-%')
     OR (t."enrolledByParentId" LIKE 'demo-%' OR t."enrolledByParentId" LIKE 'demo2-%' OR t."enrolledByParentId" LIKE 'demo3-%' OR t."enrolledByParentId" LIKE 'seed-%')
),
u_Event AS (
  UPDATE "Event" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Event x WHERE x.old_id = t."id"), t."id"),
    "campusId" = COALESCE((SELECT x.new_id FROM map_Campus x WHERE x.old_id = t."campusId"), t."campusId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."campusId" LIKE 'demo-%' OR t."campusId" LIKE 'demo2-%' OR t."campusId" LIKE 'demo3-%' OR t."campusId" LIKE 'seed-%')
),
u_EventRegistration AS (
  UPDATE "EventRegistration" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_EventRegistration x WHERE x.old_id = t."id"), t."id"),
    "eventId" = COALESCE((SELECT x.new_id FROM map_Event x WHERE x.old_id = t."eventId"), t."eventId"),
    "studentId" = COALESCE((SELECT x.new_id FROM map_Student x WHERE x.old_id = t."studentId"), t."studentId"),
    "parentId" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."parentId"), t."parentId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."eventId" LIKE 'demo-%' OR t."eventId" LIKE 'demo2-%' OR t."eventId" LIKE 'demo3-%' OR t."eventId" LIKE 'seed-%')
     OR (t."studentId" LIKE 'demo-%' OR t."studentId" LIKE 'demo2-%' OR t."studentId" LIKE 'demo3-%' OR t."studentId" LIKE 'seed-%')
     OR (t."parentId" LIKE 'demo-%' OR t."parentId" LIKE 'demo2-%' OR t."parentId" LIKE 'demo3-%' OR t."parentId" LIKE 'seed-%')
),
u_EventRegistrationOrder AS (
  UPDATE "EventRegistrationOrder" AS t SET
    "eventRegistrationId" = COALESCE((SELECT x.new_id FROM map_EventRegistration x WHERE x.old_id = t."eventRegistrationId"), t."eventRegistrationId"),
    "orderId" = COALESCE((SELECT x.new_id FROM map_Order x WHERE x.old_id = t."orderId"), t."orderId")
  WHERE (t."eventRegistrationId" LIKE 'demo-%' OR t."eventRegistrationId" LIKE 'demo2-%' OR t."eventRegistrationId" LIKE 'demo3-%' OR t."eventRegistrationId" LIKE 'seed-%')
     OR (t."orderId" LIKE 'demo-%' OR t."orderId" LIKE 'demo2-%' OR t."orderId" LIKE 'demo3-%' OR t."orderId" LIKE 'seed-%')
),
u_ExtraLessonRequest AS (
  UPDATE "ExtraLessonRequest" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_ExtraLessonRequest x WHERE x.old_id = t."id"), t."id"),
    "studentId" = COALESCE((SELECT x.new_id FROM map_Student x WHERE x.old_id = t."studentId"), t."studentId"),
    "sourceCourseId" = COALESCE((SELECT x.new_id FROM map_Course x WHERE x.old_id = t."sourceCourseId"), t."sourceCourseId"),
    "sourceEnrollmentId" = COALESCE((SELECT x.new_id FROM map_Enrollment x WHERE x.old_id = t."sourceEnrollmentId"), t."sourceEnrollmentId"),
    "instructorId" = COALESCE((SELECT x.new_id FROM map_Instructor x WHERE x.old_id = t."instructorId"), t."instructorId"),
    "createdById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."createdById"), t."createdById"),
    "campusId" = COALESCE((SELECT x.new_id FROM map_Campus x WHERE x.old_id = t."campusId"), t."campusId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."studentId" LIKE 'demo-%' OR t."studentId" LIKE 'demo2-%' OR t."studentId" LIKE 'demo3-%' OR t."studentId" LIKE 'seed-%')
     OR (t."sourceCourseId" LIKE 'demo-%' OR t."sourceCourseId" LIKE 'demo2-%' OR t."sourceCourseId" LIKE 'demo3-%' OR t."sourceCourseId" LIKE 'seed-%')
     OR (t."sourceEnrollmentId" LIKE 'demo-%' OR t."sourceEnrollmentId" LIKE 'demo2-%' OR t."sourceEnrollmentId" LIKE 'demo3-%' OR t."sourceEnrollmentId" LIKE 'seed-%')
     OR (t."instructorId" LIKE 'demo-%' OR t."instructorId" LIKE 'demo2-%' OR t."instructorId" LIKE 'demo3-%' OR t."instructorId" LIKE 'seed-%')
     OR (t."createdById" LIKE 'demo-%' OR t."createdById" LIKE 'demo2-%' OR t."createdById" LIKE 'demo3-%' OR t."createdById" LIKE 'seed-%')
     OR (t."campusId" LIKE 'demo-%' OR t."campusId" LIKE 'demo2-%' OR t."campusId" LIKE 'demo3-%' OR t."campusId" LIKE 'seed-%')
),
u_ExtraLessonSlot AS (
  UPDATE "ExtraLessonSlot" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_ExtraLessonSlot x WHERE x.old_id = t."id"), t."id"),
    "requestId" = COALESCE((SELECT x.new_id FROM map_ExtraLessonRequest x WHERE x.old_id = t."requestId"), t."requestId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."requestId" LIKE 'demo-%' OR t."requestId" LIKE 'demo2-%' OR t."requestId" LIKE 'demo3-%' OR t."requestId" LIKE 'seed-%')
),
u_Holiday AS (
  UPDATE "Holiday" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Holiday x WHERE x.old_id = t."id"), t."id"),
    "createdById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."createdById"), t."createdById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."createdById" LIKE 'demo-%' OR t."createdById" LIKE 'demo2-%' OR t."createdById" LIKE 'demo3-%' OR t."createdById" LIKE 'seed-%')
),
u_Instructor AS (
  UPDATE "Instructor" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Instructor x WHERE x.old_id = t."id"), t."id"),
    "userId" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."userId"), t."userId"),
    "defaultCampusId" = COALESCE((SELECT x.new_id FROM map_Campus x WHERE x.old_id = t."defaultCampusId"), t."defaultCampusId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."userId" LIKE 'demo-%' OR t."userId" LIKE 'demo2-%' OR t."userId" LIKE 'demo3-%' OR t."userId" LIKE 'seed-%')
     OR (t."defaultCampusId" LIKE 'demo-%' OR t."defaultCampusId" LIKE 'demo2-%' OR t."defaultCampusId" LIKE 'demo3-%' OR t."defaultCampusId" LIKE 'seed-%')
),
u_InstructorCheckin AS (
  UPDATE "InstructorCheckin" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_InstructorCheckin x WHERE x.old_id = t."id"), t."id"),
    "instructorId" = COALESCE((SELECT x.new_id FROM map_Instructor x WHERE x.old_id = t."instructorId"), t."instructorId"),
    "classSessionId" = COALESCE((SELECT x.new_id FROM map_ClassSession x WHERE x.old_id = t."classSessionId"), t."classSessionId"),
    "sessionOccurrenceId" = COALESCE((SELECT x.new_id FROM map_SessionOccurrence x WHERE x.old_id = t."sessionOccurrenceId"), t."sessionOccurrenceId"),
    "extraLessonSlotId" = COALESCE((SELECT x.new_id FROM map_ExtraLessonSlot x WHERE x.old_id = t."extraLessonSlotId"), t."extraLessonSlotId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."instructorId" LIKE 'demo-%' OR t."instructorId" LIKE 'demo2-%' OR t."instructorId" LIKE 'demo3-%' OR t."instructorId" LIKE 'seed-%')
     OR (t."classSessionId" LIKE 'demo-%' OR t."classSessionId" LIKE 'demo2-%' OR t."classSessionId" LIKE 'demo3-%' OR t."classSessionId" LIKE 'seed-%')
     OR (t."sessionOccurrenceId" LIKE 'demo-%' OR t."sessionOccurrenceId" LIKE 'demo2-%' OR t."sessionOccurrenceId" LIKE 'demo3-%' OR t."sessionOccurrenceId" LIKE 'seed-%')
     OR (t."extraLessonSlotId" LIKE 'demo-%' OR t."extraLessonSlotId" LIKE 'demo2-%' OR t."extraLessonSlotId" LIKE 'demo3-%' OR t."extraLessonSlotId" LIKE 'seed-%')
),
u_MakeupBooking AS (
  UPDATE "MakeupBooking" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_MakeupBooking x WHERE x.old_id = t."id"), t."id"),
    "enrollmentId" = COALESCE((SELECT x.new_id FROM map_Enrollment x WHERE x.old_id = t."enrollmentId"), t."enrollmentId"),
    "missedOccurrenceId" = COALESCE((SELECT x.new_id FROM map_SessionOccurrence x WHERE x.old_id = t."missedOccurrenceId"), t."missedOccurrenceId"),
    "makeupOccurrenceId" = COALESCE((SELECT x.new_id FROM map_SessionOccurrence x WHERE x.old_id = t."makeupOccurrenceId"), t."makeupOccurrenceId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."enrollmentId" LIKE 'demo-%' OR t."enrollmentId" LIKE 'demo2-%' OR t."enrollmentId" LIKE 'demo3-%' OR t."enrollmentId" LIKE 'seed-%')
     OR (t."missedOccurrenceId" LIKE 'demo-%' OR t."missedOccurrenceId" LIKE 'demo2-%' OR t."missedOccurrenceId" LIKE 'demo3-%' OR t."missedOccurrenceId" LIKE 'seed-%')
     OR (t."makeupOccurrenceId" LIKE 'demo-%' OR t."makeupOccurrenceId" LIKE 'demo2-%' OR t."makeupOccurrenceId" LIKE 'demo3-%' OR t."makeupOccurrenceId" LIKE 'seed-%')
),
u_MakeupEligibility AS (
  UPDATE "MakeupEligibility" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_MakeupEligibility x WHERE x.old_id = t."id"), t."id"),
    "sourceClassSessionId" = COALESCE((SELECT x.new_id FROM map_ClassSession x WHERE x.old_id = t."sourceClassSessionId"), t."sourceClassSessionId"),
    "eligibleClassSessionId" = COALESCE((SELECT x.new_id FROM map_ClassSession x WHERE x.old_id = t."eligibleClassSessionId"), t."eligibleClassSessionId"),
    "createdById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."createdById"), t."createdById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."sourceClassSessionId" LIKE 'demo-%' OR t."sourceClassSessionId" LIKE 'demo2-%' OR t."sourceClassSessionId" LIKE 'demo3-%' OR t."sourceClassSessionId" LIKE 'seed-%')
     OR (t."eligibleClassSessionId" LIKE 'demo-%' OR t."eligibleClassSessionId" LIKE 'demo2-%' OR t."eligibleClassSessionId" LIKE 'demo3-%' OR t."eligibleClassSessionId" LIKE 'seed-%')
     OR (t."createdById" LIKE 'demo-%' OR t."createdById" LIKE 'demo2-%' OR t."createdById" LIKE 'demo3-%' OR t."createdById" LIKE 'seed-%')
),
u_Message AS (
  UPDATE "Message" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Message x WHERE x.old_id = t."id"), t."id"),
    "threadId" = COALESCE((SELECT x.new_id FROM map_MessageThread x WHERE x.old_id = t."threadId"), t."threadId"),
    "senderId" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."senderId"), t."senderId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."threadId" LIKE 'demo-%' OR t."threadId" LIKE 'demo2-%' OR t."threadId" LIKE 'demo3-%' OR t."threadId" LIKE 'seed-%')
     OR (t."senderId" LIKE 'demo-%' OR t."senderId" LIKE 'demo2-%' OR t."senderId" LIKE 'demo3-%' OR t."senderId" LIKE 'seed-%')
),
u_MessageTemplate AS (
  UPDATE "MessageTemplate" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_MessageTemplate x WHERE x.old_id = t."id"), t."id"),
    "createdById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."createdById"), t."createdById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."createdById" LIKE 'demo-%' OR t."createdById" LIKE 'demo2-%' OR t."createdById" LIKE 'demo3-%' OR t."createdById" LIKE 'seed-%')
),
u_MessageThread AS (
  UPDATE "MessageThread" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_MessageThread x WHERE x.old_id = t."id"), t."id"),
    "participantId" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."participantId"), t."participantId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."participantId" LIKE 'demo-%' OR t."participantId" LIKE 'demo2-%' OR t."participantId" LIKE 'demo3-%' OR t."participantId" LIKE 'seed-%')
),
u_Notice AS (
  UPDATE "Notice" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Notice x WHERE x.old_id = t."id"), t."id"),
    "createdById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."createdById"), t."createdById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."createdById" LIKE 'demo-%' OR t."createdById" LIKE 'demo2-%' OR t."createdById" LIKE 'demo3-%' OR t."createdById" LIKE 'seed-%')
),
u_Notification AS (
  UPDATE "Notification" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Notification x WHERE x.old_id = t."id"), t."id"),
    "userId" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."userId"), t."userId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."userId" LIKE 'demo-%' OR t."userId" LIKE 'demo2-%' OR t."userId" LIKE 'demo3-%' OR t."userId" LIKE 'seed-%')
),
u_OccurrenceCancelRequest AS (
  UPDATE "OccurrenceCancelRequest" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_OccurrenceCancelRequest x WHERE x.old_id = t."id"), t."id"),
    "occurrenceId" = COALESCE((SELECT x.new_id FROM map_SessionOccurrence x WHERE x.old_id = t."occurrenceId"), t."occurrenceId"),
    "instructorId" = COALESCE((SELECT x.new_id FROM map_Instructor x WHERE x.old_id = t."instructorId"), t."instructorId"),
    "reviewedById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."reviewedById"), t."reviewedById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."occurrenceId" LIKE 'demo-%' OR t."occurrenceId" LIKE 'demo2-%' OR t."occurrenceId" LIKE 'demo3-%' OR t."occurrenceId" LIKE 'seed-%')
     OR (t."instructorId" LIKE 'demo-%' OR t."instructorId" LIKE 'demo2-%' OR t."instructorId" LIKE 'demo3-%' OR t."instructorId" LIKE 'seed-%')
     OR (t."reviewedById" LIKE 'demo-%' OR t."reviewedById" LIKE 'demo2-%' OR t."reviewedById" LIKE 'demo3-%' OR t."reviewedById" LIKE 'seed-%')
),
u_Order AS (
  UPDATE "Order" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Order x WHERE x.old_id = t."id"), t."id"),
    "parentId" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."parentId"), t."parentId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."parentId" LIKE 'demo-%' OR t."parentId" LIKE 'demo2-%' OR t."parentId" LIKE 'demo3-%' OR t."parentId" LIKE 'seed-%')
),
u_OrderItem AS (
  UPDATE "OrderItem" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_OrderItem x WHERE x.old_id = t."id"), t."id"),
    "orderId" = COALESCE((SELECT x.new_id FROM map_Order x WHERE x.old_id = t."orderId"), t."orderId"),
    "enrollmentId" = COALESCE((SELECT x.new_id FROM map_Enrollment x WHERE x.old_id = t."enrollmentId"), t."enrollmentId"),
    "eventRegistrationId" = COALESCE((SELECT x.new_id FROM map_EventRegistration x WHERE x.old_id = t."eventRegistrationId"), t."eventRegistrationId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."orderId" LIKE 'demo-%' OR t."orderId" LIKE 'demo2-%' OR t."orderId" LIKE 'demo3-%' OR t."orderId" LIKE 'seed-%')
     OR (t."enrollmentId" LIKE 'demo-%' OR t."enrollmentId" LIKE 'demo2-%' OR t."enrollmentId" LIKE 'demo3-%' OR t."enrollmentId" LIKE 'seed-%')
     OR (t."eventRegistrationId" LIKE 'demo-%' OR t."eventRegistrationId" LIKE 'demo2-%' OR t."eventRegistrationId" LIKE 'demo3-%' OR t."eventRegistrationId" LIKE 'seed-%')
),
u_ParentStudentLink AS (
  UPDATE "ParentStudentLink" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_ParentStudentLink x WHERE x.old_id = t."id"), t."id"),
    "parentId" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."parentId"), t."parentId"),
    "studentId" = COALESCE((SELECT x.new_id FROM map_Student x WHERE x.old_id = t."studentId"), t."studentId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."parentId" LIKE 'demo-%' OR t."parentId" LIKE 'demo2-%' OR t."parentId" LIKE 'demo3-%' OR t."parentId" LIKE 'seed-%')
     OR (t."studentId" LIKE 'demo-%' OR t."studentId" LIKE 'demo2-%' OR t."studentId" LIKE 'demo3-%' OR t."studentId" LIKE 'seed-%')
),
u_Payment AS (
  UPDATE "Payment" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Payment x WHERE x.old_id = t."id"), t."id"),
    "orderId" = COALESCE((SELECT x.new_id FROM map_Order x WHERE x.old_id = t."orderId"), t."orderId"),
    "recordedById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."recordedById"), t."recordedById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."orderId" LIKE 'demo-%' OR t."orderId" LIKE 'demo2-%' OR t."orderId" LIKE 'demo3-%' OR t."orderId" LIKE 'seed-%')
     OR (t."recordedById" LIKE 'demo-%' OR t."recordedById" LIKE 'demo2-%' OR t."recordedById" LIKE 'demo3-%' OR t."recordedById" LIKE 'seed-%')
),
u_RefundRecord AS (
  UPDATE "RefundRecord" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_RefundRecord x WHERE x.old_id = t."id"), t."id"),
    "orderId" = COALESCE((SELECT x.new_id FROM map_Order x WHERE x.old_id = t."orderId"), t."orderId"),
    "orderItemId" = COALESCE((SELECT x.new_id FROM map_OrderItem x WHERE x.old_id = t."orderItemId"), t."orderItemId"),
    "refundedById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."refundedById"), t."refundedById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."orderId" LIKE 'demo-%' OR t."orderId" LIKE 'demo2-%' OR t."orderId" LIKE 'demo3-%' OR t."orderId" LIKE 'seed-%')
     OR (t."orderItemId" LIKE 'demo-%' OR t."orderItemId" LIKE 'demo2-%' OR t."orderItemId" LIKE 'demo3-%' OR t."orderItemId" LIKE 'seed-%')
     OR (t."refundedById" LIKE 'demo-%' OR t."refundedById" LIKE 'demo2-%' OR t."refundedById" LIKE 'demo3-%' OR t."refundedById" LIKE 'seed-%')
),
u_ReminderLog AS (
  UPDATE "ReminderLog" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_ReminderLog x WHERE x.old_id = t."id"), t."id"),
    "ruleId" = COALESCE((SELECT x.new_id FROM map_ReminderRule x WHERE x.old_id = t."ruleId"), t."ruleId"),
    "recipientId" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."recipientId"), t."recipientId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."ruleId" LIKE 'demo-%' OR t."ruleId" LIKE 'demo2-%' OR t."ruleId" LIKE 'demo3-%' OR t."ruleId" LIKE 'seed-%')
     OR (t."recipientId" LIKE 'demo-%' OR t."recipientId" LIKE 'demo2-%' OR t."recipientId" LIKE 'demo3-%' OR t."recipientId" LIKE 'seed-%')
),
u_ReminderRule AS (
  UPDATE "ReminderRule" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_ReminderRule x WHERE x.old_id = t."id"), t."id")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
),
u_SessionOccurrence AS (
  UPDATE "SessionOccurrence" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_SessionOccurrence x WHERE x.old_id = t."id"), t."id"),
    "classSessionId" = COALESCE((SELECT x.new_id FROM map_ClassSession x WHERE x.old_id = t."classSessionId"), t."classSessionId"),
    "postponedToOccurrenceId" = COALESCE((SELECT x.new_id FROM map_SessionOccurrence x WHERE x.old_id = t."postponedToOccurrenceId"), t."postponedToOccurrenceId"),
    "substituteInstructorId" = COALESCE((SELECT x.new_id FROM map_Instructor x WHERE x.old_id = t."substituteInstructorId"), t."substituteInstructorId")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."classSessionId" LIKE 'demo-%' OR t."classSessionId" LIKE 'demo2-%' OR t."classSessionId" LIKE 'demo3-%' OR t."classSessionId" LIKE 'seed-%')
     OR (t."postponedToOccurrenceId" LIKE 'demo-%' OR t."postponedToOccurrenceId" LIKE 'demo2-%' OR t."postponedToOccurrenceId" LIKE 'demo3-%' OR t."postponedToOccurrenceId" LIKE 'seed-%')
     OR (t."substituteInstructorId" LIKE 'demo-%' OR t."substituteInstructorId" LIKE 'demo2-%' OR t."substituteInstructorId" LIKE 'demo3-%' OR t."substituteInstructorId" LIKE 'seed-%')
),
u_Student AS (
  UPDATE "Student" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Student x WHERE x.old_id = t."id"), t."id")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
),
u_StudentReview AS (
  UPDATE "StudentReview" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_StudentReview x WHERE x.old_id = t."id"), t."id"),
    "classSessionId" = COALESCE((SELECT x.new_id FROM map_ClassSession x WHERE x.old_id = t."classSessionId"), t."classSessionId"),
    "studentId" = COALESCE((SELECT x.new_id FROM map_Student x WHERE x.old_id = t."studentId"), t."studentId"),
    "createdById" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."createdById"), t."createdById")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
     OR (t."classSessionId" LIKE 'demo-%' OR t."classSessionId" LIKE 'demo2-%' OR t."classSessionId" LIKE 'demo3-%' OR t."classSessionId" LIKE 'seed-%')
     OR (t."studentId" LIKE 'demo-%' OR t."studentId" LIKE 'demo2-%' OR t."studentId" LIKE 'demo3-%' OR t."studentId" LIKE 'seed-%')
     OR (t."createdById" LIKE 'demo-%' OR t."createdById" LIKE 'demo2-%' OR t."createdById" LIKE 'demo3-%' OR t."createdById" LIKE 'seed-%')
),
u_Term AS (
  UPDATE "Term" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_Term x WHERE x.old_id = t."id"), t."id")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
),
u_User AS (
  UPDATE "User" AS t SET
    "id" = COALESCE((SELECT x.new_id FROM map_User x WHERE x.old_id = t."id"), t."id")
  WHERE (t."id" LIKE 'demo-%' OR t."id" LIKE 'demo2-%' OR t."id" LIKE 'demo3-%' OR t."id" LIKE 'seed-%')
)
SELECT 1;