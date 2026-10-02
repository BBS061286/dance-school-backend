/**
 * D1 种子数据（开发环境用）
 * 运行：npm run seed（需先配置 DATABASE_URL 并执行 migrate）
 *
 * 内容：
 * - Burlington 校区
 * - 管理员 / 教师 / 家长各 1 个账号（密码见 README，仅开发用）
 * - 课程《中国古典舞身韵》（v2 §6.27 示例）
 * - 1 个 ClassSession + 按规则生成的 12 个 SessionOccurrence（每周四）
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // ---- 校区 ----
  const campus = await prisma.campus.upsert({
    where: { id: 'seed-campus-burlington' },
    update: {},
    create: {
      id: 'seed-campus-burlington',
      name: 'Burlington',
      address: '141 Middlesex Turnpike, suite 202, Burlington, MA, 01803',
      city: 'Burlington',
      phone: '781-000-0000',
      timezone: 'America/New_York',
    },
  });
  console.log('校区:', campus.name);

  const hash = (pw: string) => bcrypt.hash(pw, 10);

  // ---- 管理员 ----
  const admin = await prisma.user.upsert({
    where: { email: 'admin@danceschool.local' },
    update: {},
    create: {
      email: 'admin@danceschool.local',
      name: '管理员',
      role: 'ADMIN',
      passwordHash: await hash('Admin1234!'),
    },
  });

  // ---- 教师 ----
  const teacherUser = await prisma.user.upsert({
    where: { email: 'teacher@danceschool.local' },
    update: {},
    create: {
      email: 'teacher@danceschool.local',
      name: '李老师',
      role: 'INSTRUCTOR',
      passwordHash: await hash('Teacher1234!'),
    },
  });
  const instructor = await prisma.instructor.upsert({
    where: { userId: teacherUser.id },
    update: {},
    create: {
      userId: teacherUser.id,
      bio: '中国古典舞教师',
      specialties: ['中国古典舞'],
      defaultCampusId: campus.id,
    },
  });

  // ---- 家长 ----
  const parent = await prisma.user.upsert({
    where: { email: 'parent@danceschool.local' },
    update: {},
    create: {
      email: 'parent@danceschool.local',
      name: '王家长',
      phone: '617-000-0000',
      role: 'PARENT',
      passwordHash: await hash('Parent1234!'),
    },
  });
  console.log('账号:', admin.email, teacherUser.email, parent.email);

  // ---- 课程《中国古典舞身韵》（v2 §6.27 示例） ----
  const course = await prisma.course.upsert({
    where: { id: 'seed-course-gudianwu' },
    update: {},
    create: {
      id: 'seed-course-gudianwu',
      title: '中国古典舞身韵',
      description: '中国古典舞身韵课程，12 周，每周四 17:00-18:00',
      format: 'GROUP',
      audience: 'YOUTH',
      skillLevel: 'BEGINNER',
      minAge: 11,
      danceStyle: '中国古典舞',
      weekdays: [4],
      timeRange: '17:00-18:00',
      pricingType: 'TERM',
      totalSessions: 12,
      startDate: new Date('2026-09-10'),
      capacity: 15,
      priceCents: 40000,
      currency: 'usd',
      requiresPayment: true,
      status: 'PUBLISHED',
      address: '141 Middlesex Turnpike, suite 202, Burlington, MA, 01803',
    },
  });
  await prisma.courseCampus.upsert({
    where: {
      courseId_campusId: { courseId: course.id, campusId: campus.id },
    },
    update: {},
    create: { courseId: course.id, campusId: campus.id },
  });
  await prisma.courseInstructor.upsert({
    where: {
      courseId_instructorId: { courseId: course.id, instructorId: instructor.id },
    },
    update: {},
    create: { courseId: course.id, instructorId: instructor.id },
  });
  console.log('课程:', course.title);

  // ---- 班级档期（Burlington 周四班） ----
  // 第一节 2026-09-10 17:00-18:00（美东 EDT = UTC-4），UTC 存储
  const session = await prisma.classSession.upsert({
    where: { id: 'seed-session-gudianwu-thu' },
    update: {},
    create: {
      id: 'seed-session-gudianwu-thu',
      courseId: course.id,
      campusId: campus.id,
      instructorId: instructor.id,
      room: 'Studio A',
      startTime: new Date('2026-09-10T21:00:00Z'),
      endTime: new Date('2026-09-10T22:00:00Z'),
      capacity: null, // 继承 Course.capacity = 15
      waitlistCapacity: 5,
      status: 'SCHEDULED',
    },
  });

  // ---- 12 个 SessionOccurrence：从 2026-09-10 起每周四 ----
  for (let i = 0; i < 12; i++) {
    const d = new Date('2026-09-10T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i * 7);
    await prisma.sessionOccurrence.upsert({
      where: { id: `seed-occurrence-gudianwu-${i + 1}` },
      update: {},
      create: {
        id: `seed-occurrence-gudianwu-${i + 1}`,
        classSessionId: session.id,
        sessionNumber: i + 1,
        date: d,
        timeRange: '17:00-18:00',
        status: 'SCHEDULED',
      },
    });
  }
  console.log('课次: 12 节已生成（每周四）');
  console.log('种子数据写入完成');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
