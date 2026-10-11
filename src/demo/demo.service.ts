import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DemoService {
  constructor(private readonly prisma: PrismaService) {}

  /** 为指定学员创建 2026年春季学期 的完整演示数据 */
  async seedSpringTerm(studentId: string) {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new NotFoundException('学员不存在');

    const term = await this.prisma.term.findFirst({ where: { name: { contains: '2026年春季' } } });
    if (!term) throw new NotFoundException('2026年春季学期不存在');

    const campus = await this.prisma.campus.findFirst();
    const instructor = await this.prisma.instructor.findFirst();
    if (!campus || !instructor) throw new NotFoundException('缺少校区或老师数据');

    const existing = await this.prisma.course.findFirst({
      where: { title: '少儿中国舞初级（2026春·演示）', termId: term.id },
    });
    if (existing) return { message: '演示数据已存在', courseId: existing.id };

    const course = await this.prisma.course.create({
      data: {
        title: '少儿中国舞初级（2026春·演示）',
        description: '2026年春季学期演示课程',
        format: 'GROUP',
        audience: 'YOUTH',
        termId: term.id,
        priceCents: 36000,
        currency: 'usd',
        pricingType: 'TERM',
        capacity: 20,
        totalSessions: 12,
        startDate: new Date('2026-01-10'),
        endDate: new Date('2026-04-05'),
        weekdays: [6],
        timeRange: '10:00-11:00',
        minAge: 4,
        maxAge: 12,
        status: 'PUBLISHED',
        campuses: { create: [{ campusId: campus.id }] },
      },
    });

    const session = await this.prisma.classSession.create({
      data: {
        courseId: course.id,
        campusId: campus.id,
        instructorId: instructor.id,
        startTime: new Date('2026-01-10T10:00:00'),
        endTime: new Date('2026-04-05T11:00:00'),
        capacity: 20,
        status: 'SCHEDULED',
      },
    });

    const occurrences: Array<{ id: string; date: Date }> = [];
    for (let i = 1; i <= 12; i++) {
      const date = new Date('2026-01-10');
      date.setDate(date.getDate() + (i - 1) * 7);
      const occ = await this.prisma.sessionOccurrence.create({
        data: {
          classSessionId: session.id,
          sessionNumber: i,
          date,
          timeRange: '10:00-11:00',
          status: 'SCHEDULED',
        },
      });
      occurrences.push(occ);
    }

    const parentLink = await this.prisma.parentStudentLink.findFirst({ where: { studentId } });
    if (!parentLink) {
      throw new Error(`演示种子：学员 ${studentId} 无家长关联，无法创建报名（enrolledByParentId 不允许为空）`);
    }
    const enrollment = await this.prisma.enrollment.create({
      data: {
        studentId,
        classSessionId: session.id,
        enrolledByParentId: parentLink.parentId,
        status: 'CONFIRMED',
      },
    });

    // 考勤：10节出勤，第3节和第7节缺席
    const absentSessions = [3, 7];
    for (let i = 0; i < 10; i++) {
      const occ = occurrences[i];
      const isAbsent = absentSessions.includes(i + 1);
      await this.prisma.attendanceRecord.create({
        data: {
          sessionOccurrenceId: occ.id,
          enrollmentId: enrollment.id,
          checkInMethod: 'ADMIN',
          status: isAbsent ? 'ABSENT' : 'CONFIRMED',
          checkedInAt: new Date(occ.date),
        },
      });
    }

    return { message: '春季演示数据创建成功', courseId: course.id, sessions: 12, present: 8, absent: 2 };
  }

  /** 给课程补课程介绍（演示用） */
  async seedDescriptions() {
    const descs: Array<[string, string]> = [
      ['少儿中国舞', '从基本站姿、手位、身法学起，系统训练中国古典舞身韵与民族民间舞基本功。课程注重孩子的身体协调性、柔韧性与节奏感，在优美的民族音乐中激发孩子对舞蹈的兴趣与热爱。适合 4–12 岁零基础或有基础的孩子，学期末有汇报演出机会。'],
      ['少儿街舞', '零基础友好！从律动（Groove）、节奏感练起，逐步学习 Hip-hop 基础动作、定点与小组合。课堂氛围轻松活泼，鼓励孩子大胆表现，释放表现力与自信。适合 5–12 岁活泼好动的孩子。'],
      ['儿童街舞', '专为低龄孩子设计的街舞启蒙课，用游戏化的方式带孩子感受音乐节奏，学习简单的律动动作与队形变化。重点培养节奏感、模仿力与课堂专注力，让孩子在玩乐中爱上跳舞。适合 4–7 岁零基础小朋友。'],
      ['少儿芭蕾', '专业芭蕾启蒙，从把杆基础（plié、tendu）到中间组合，训练正确的身体姿态、柔韧性与核心力量。课程循序渐进，培养孩子的优雅气质与舞台表现力，为今后各类舞蹈打下扎实基本功。适合 4–12 岁女孩。'],
      ['私教一对一·古典舞', '一对一专属定制，老师针对学员个人情况强化古典舞水袖、身法身韵组合训练，逐动作精雕细琢。适合有明确目标（如考级、比赛、艺考）的学员，进步速度远超大班课。'],
      ['私教一对一·中国舞', '一对一专属指导，老师根据孩子特点量身定制训练计划，重点突破薄弱环节。无论是基本功强化、剧目打磨还是比赛备赛，都能得到老师全部的注意力，进步看得见。'],
      ['拉丁舞大师课', '特邀拉丁舞名师亲授，浓缩大师多年舞台与教学经验。从伦巴、恰恰基础步伐到身体开发与表演技巧，单节信息量极大。机会难得，名额有限，适合有一定基础想突破瓶颈的学员。'],
      ['成人爵士舞', '专为成人设计的爵士舞课程，零基础可学。从身体隔离、律动基础到完整成品舞，在动感音乐中塑形减压。不用担心跟不上，老师会逐段拆解，找回身体的律动感，越跳越自信。'],
      ['成人瑜伽形体', '结合瑜伽与舞蹈形体训练，改善含胸驼背等体态问题，缓解肩颈腰背压力。每节课包含拉伸、核心训练与呼吸放松，适合久坐办公人群，每周一次给身体充电。'],
      // 注意顺序：'少年芭蕾' 必须在 '少年芭蕾进阶' 之前（contains 会同时命中进阶课，后者再覆盖为进阶专用文案）
      ['少年芭蕾', '从芭蕾基本手位脚位学起，系统训练把杆组合与中间练习，培养挺拔体态、身体控制与优雅气质。课程循序渐进，注重肌肉线条与动作规范，为孩子打下扎实的芭蕾基础。适合 6–12 岁零基础或有基础的孩子。'],
      ['少年芭蕾进阶', '在芭蕾基础之上提升难度，加入旋转、跳跃组合与小型变奏，强化腿部力量、身体协调与舞台表现力。老师针对每个孩子逐一点评纠正，帮助突破技术瓶颈。适合有 1 年以上芭蕾基础的少年。'],
      ['私教一对一·芭蕾', '一对一专属芭蕾私教，老师按学员水平定制训练：把杆基本功、中间组合、剧目片段逐一打磨。课堂节奏完全跟着学员走，纠错细致到每个动作细节。适合考级、比赛或艺考备赛，想快速突破的学员。'],
      ['百老汇大师课', '特邀百老汇一线演员/编导亲授，单次 3 小时高强度集训。从经典剧目选段学起，涵盖爵士舞技巧、舞台表现与试镜实战经验，单节信息量极大。机会难得、名额有限，适合有一定基础想体验专业水准的学员。'],
      ['成人现代舞', '成人现代舞初级班，10 周系统入门。从地面动作、重心转移到即兴表达，在流动的音乐中释放身体、缓解压力。零基础友好，老师逐段拆解。适合想尝试现代舞、改善体态与气质的成年人。'],
      ['中国古典舞身韵', '中国古典舞身韵课程，12 周系统训练。从提沉、冲靠、含腆、移等基本动律入手，结合水袖组合体会古典舞"圆、曲、拧、倾"的独特韵味。适合 8 岁以上有一定基础、想深入学习古典舞的孩子。'],
    ];
    let updated = 0;
    for (const [kw, desc] of descs) {
      const r = await this.prisma.course.updateMany({
        where: { title: { contains: kw } },
        data: { description: desc },
      });
      updated += r.count;
    }
    return { message: `已为 ${updated} 门课程补充介绍`, updated };
  }




  /** 临时：教师端全套演示数据（赵老师=少儿，李老师=成人）。幂等，可重复跑。 */
  async seedTeacherDemo() {
    const P = this.prisma;
    const log: string[] = [];
    const ZHAO_INS = 'c2222222-2222-4222-8222-222222222222';
    const ZHAO_USER = '67eb1d5f-1c9b-4b36-b36d-825eaf169dd2';
    const LI_INS = '8716ef06-c473-4b42-8be9-6009439ff7e3';
    const LI_USER = '69637077-9167-47bb-8713-cdff2f56fe6e';
    const NEEDHAM = 'dd51f3e3-fbc0-41f6-b222-2404a63f604d';
    const JAZZ_COURSE = '358e791c-ed45-4099-9fd1-bf918d84f508';
    const HIPKIDS_COURSE = '3c424583-6c94-4ca7-8e29-4b7699d96338';
    const MODERN_COURSE = '3117a997-1adf-45cc-81e1-bd0336754d55';
    const S1 = '3e6ae989-cc5e-4aad-9f6d-ab5438e98536'; // 少儿街舞进阶 Sat 11:00 赵
    const S2 = 'c0f89683-271f-4279-ba15-3733b66b8653'; // 儿童街舞 Sat 10:00 赵
    const S3 = 'f8fd92c8-13a9-456c-9f8a-66a9b0fba9e9'; // 少年芭蕾 Sat 14:00 -> 赵
    const S4 = '1cf9660e-4b46-408f-a453-fc2fb4b5e789'; // 成人现代舞 Thu 19:00 -> 李
    const S5 = '670ef638-a847-4e82-89de-28505355423d'; // 成人爵士舞 Wed 19:00 -> 李
    const D = (s: string) => new Date(s + 'T00:00:00.000Z');
    const admin = await P.user.findFirst({ where: { email: 'admin@danceschool.local' } });

    // 0. 老师演示密码（验证用）
    const PW = '$2b$10$xnpQUZxKnDIaznrLZlZ7V.K1w8TdmkCe4tutNsKEQh3IBDM7CmV8q'; // Teach1234!
    await P.user.updateMany({ where: { id: { in: [ZHAO_USER, LI_USER] } }, data: { passwordHash: PW, mustChangePassword: false } });
    log.push('teacher passwords set');

    // 1. 班次归属：少年芭蕾->赵；成人现代舞/成人爵士舞->李
    await P.classSession.update({ where: { id: S3 }, data: { instructorId: ZHAO_INS } });
    await P.classSession.update({ where: { id: S4 }, data: { instructorId: LI_INS } });
    await P.classSession.update({ where: { id: S5 }, data: { instructorId: LI_INS } });
    log.push('sessions reassigned');

    // 2. 新建周六晚成人爵士舞班次（李老师 18:00-19:00）
    let s6 = await P.classSession.findFirst({ where: { courseId: JAZZ_COURSE, instructorId: LI_INS, startTime: new Date('2026-10-10T22:00:00.000Z') } });
    if (!s6) {
      s6 = await P.classSession.create({ data: {
        courseId: JAZZ_COURSE, campusId: NEEDHAM, instructorId: LI_INS,
        startTime: new Date('2026-10-10T22:00:00.000Z'), endTime: new Date('2026-10-10T23:00:00.000Z'),
        capacity: 15, status: 'SCHEDULED',
      }});
    }
    const S6 = s6.id;
    // 给 S6 报 8 个成人学员
    const adultNames = ['陈晓雯', '演示成人', '刘洋', '吴刚', '周婷', '林琳', '沈强', '曹阳'];
    const adults = await P.student.findMany({ where: { name: { in: adultNames } } });
    let enr6 = 0;
    for (const st of adults) {
      const ex = await P.enrollment.findFirst({ where: { classSessionId: S6, studentId: st.id } });
      if (ex) continue;
      await P.enrollment.create({ data: { classSessionId: S6, studentId: st.id, enrolledByParentId: admin!.id, status: 'CONFIRMED' } });
      enr6++;
    }
    await P.classSession.update({ where: { id: S6 }, data: { enrolledCount: await P.enrollment.count({ where: { classSessionId: S6, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } } }) } });
    log.push(`S6 created, enrollments +${enr6}`);

    // 3. 课次：按目标日期补齐，缺失才建
    const targets: Record<string, { dates: string[]; timeRange: string }> = {
      [S1]: { dates: ['2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24'], timeRange: '11:00-12:00' },
      [S2]: { dates: ['2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17'], timeRange: '10:00-11:00' },
      [S3]: { dates: ['2026-10-10', '2026-10-17', '2026-10-24'], timeRange: '14:00-15:00' },
      [S4]: { dates: ['2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15'], timeRange: '19:00-20:00' },
      [S5]: { dates: ['2026-09-30', '2026-10-07', '2026-10-14'], timeRange: '19:00-20:00' },
      [S6]: { dates: ['2026-10-03', '2026-10-10', '2026-10-17'], timeRange: '18:00-19:00' },
    };
    const occByDate: Record<string, Record<string, string>> = {};
    for (const [sid, t] of Object.entries(targets)) {
      occByDate[sid] = {};
      for (const ds of t.dates) {
        let occ = await P.sessionOccurrence.findFirst({ where: { classSessionId: sid, date: D(ds) } });
        if (!occ) {
          const maxN = (await P.sessionOccurrence.aggregate({ where: { classSessionId: sid }, _max: { sessionNumber: true } }))._max.sessionNumber ?? 0;
          occ = await P.sessionOccurrence.create({ data: { classSessionId: sid, sessionNumber: maxN + 1, date: D(ds), status: 'SCHEDULED', timeRange: t.timeRange } });
          log.push(`occ created ${sid.slice(0, 8)} ${ds}`);
        }
        occByDate[sid][ds] = occ.id;
      }
      // 按日期重排节次号
      const all = await P.sessionOccurrence.findMany({ where: { classSessionId: sid }, orderBy: { date: 'asc' } });
      for (let i = 0; i < all.length; i++) {
        if (all[i].sessionNumber !== i + 1) await P.sessionOccurrence.update({ where: { id: all[i].id }, data: { sessionNumber: i + 1 } });
      }
    }

    // 4. 过去课次的学员考勤（CONFIRMED/ABSENT 混合）
    let att = 0;
    for (const [sid, t] of Object.entries(targets)) {
      const enrollments = await P.enrollment.findMany({ where: { classSessionId: sid, status: 'CONFIRMED' }, select: { id: true } });
      for (const ds of t.dates) {
        if (ds >= '2026-10-10') continue;
        const occId = occByDate[sid][ds];
        for (let i = 0; i < enrollments.length; i++) {
          const ex = await P.attendanceRecord.findFirst({ where: { sessionOccurrenceId: occId, enrollmentId: enrollments[i].id } });
          if (ex) continue;
          const absent = (i * 7 + ds.length) % 7 === 0; // 约 1/7 缺席
          const [hh] = t.timeRange.split('-')[0].split(':');
          await P.attendanceRecord.create({ data: {
            sessionOccurrenceId: occId, enrollmentId: enrollments[i].id,
            checkInMethod: 'INSTRUCTOR', status: absent ? 'ABSENT' : 'CONFIRMED',
            checkedInAt: new Date(ds + `T${String(Number(hh) + 4).padStart(2, '0')}:05:00.000Z`),
          }});
          att++;
        }
      }
    }
    log.push(`attendance +${att}`);

    // 5. 老师打卡 2-3 条
    const checkins: Array<[string, string, string, string, string]> = [
      [ZHAO_INS, S2, '2026-10-03', '10:00-11:00', '10:00-11:00'],
      [ZHAO_INS, S1, '2026-10-03', '11:00-12:00', '11:00-12:00'],
      [ZHAO_INS, S1, '2026-09-26', '11:00-12:00', '11:00-12:00'],
      [LI_INS, S5, '2026-10-07', '19:00-20:00', '19:00-20:00'],
      [LI_INS, S4, '2026-10-08', '19:00-20:00', '19:00-20:00'],
      [LI_INS, S6, '2026-10-03', '18:00-19:00', '18:00-19:00'],
    ];
    let ci = 0;
    for (const [insId, sid, ds, time] of checkins) {
      const ex = await P.instructorCheckin.findFirst({ where: { instructorId: insId, classSessionId: sid, date: D(ds) } });
      if (ex) continue;
      await P.instructorCheckin.create({ data: {
        instructorId: insId, classSessionId: sid, sessionOccurrenceId: occByDate[sid][ds],
        campus: 'Needham 校区', date: D(ds), time,
      }});
      ci++;
    }
    log.push(`checkins +${ci}`);

    // 家长 userId
    const wParent = await P.parentStudentLink.findFirst({ where: { student: { name: '王小宝' } }, include: { parent: true } });
    const chenSelf = await P.parentStudentLink.findFirst({ where: { student: { name: '陈晓雯' }, parent: { name: '陈晓雯' } } });
    const WPARENT = wParent!.parentId, CHEN = chenSelf!.parentId;
    const wangXiaobao = (await P.student.findFirst({ where: { name: '王小宝' } }))!.id;
    const chenStudent = (await P.student.findFirst({ where: { name: '陈晓雯' } }))!.id;

    // 6. 加课：每人 3 个（待排时段 / 待家长确认 / 已确认+出勤）
    async function extraLesson(studentId: string, createdBy: string, insId: string, audience: 'YOUTH' | 'ADULT', content: string, kind: 'todo' | 'pending' | 'done', slotDate?: string, slotTime?: string, fee?: number) {
      let req = await P.extraLessonRequest.findFirst({ where: { studentId, content } });
      if (!req) {
        req = await P.extraLessonRequest.create({ data: {
          type: 'ONE_ON_ONE', studentId, audience, content, location: 'Needham 校区 Studio B',
          initiatedBy: 'STUDENT', instructorId: insId, createdById: createdBy,
          status: kind === 'done' ? 'IN_PROGRESS' : 'APPROVED', campusId: NEEDHAM,
        }});
      }
      if (kind !== 'todo' && req) {
        let slot = await P.extraLessonSlot.findFirst({ where: { requestId: req.id, date: D(slotDate!) } });
        if (!slot) {
          slot = await P.extraLessonSlot.create({ data: {
            requestId: req.id, date: D(slotDate!), time: slotTime!,
            status: kind === 'pending' ? 'PENDING_STUDENT' : 'CONFIRMED',
            feeCents: fee, feeStatus: kind === 'pending' ? 'ISSUED' : 'PAID',
            confirmedAt: kind === 'done' ? new Date() : null,
          }});
        }
        if (kind === 'done') {
          const exA = await P.extraLessonAttendance.findFirst({ where: { slotId: slot.id, studentId } });
          if (!exA) await P.extraLessonAttendance.create({ data: { slotId: slot.id, studentId, status: 'PRESENT', checkedInBy: insId } });
        }
      }
      return req;
    }
    await extraLesson(wangXiaobao, WPARENT, ZHAO_INS, 'YOUTH', '【演示】少儿街舞基础律动强化', 'todo');
    await extraLesson(wangXiaobao, WPARENT, ZHAO_INS, 'YOUTH', '【演示】街舞小组合成品舞打磨', 'pending', '2026-10-18', '10:00-11:00', 20000);
    await extraLesson(wangXiaobao, WPARENT, ZHAO_INS, 'YOUTH', '【演示】街舞节奏感专项提升', 'done', '2026-10-04', '10:00-11:00', 20000);
    await extraLesson(chenStudent, CHEN, LI_INS, 'ADULT', '【演示】爵士舞身体隔离特训', 'todo');
    await extraLesson(chenStudent, CHEN, LI_INS, 'ADULT', '【演示】现代舞即兴表达提升', 'pending', '2026-10-19', '19:00-20:00', 25000);
    await extraLesson(chenStudent, CHEN, LI_INS, 'ADULT', '【演示】爵士舞成品舞段落精修', 'done', '2026-10-05', '19:00-20:00', 25000);
    log.push('extra lessons done');

    // 7. 评价各 2 条
    async function review(kind: 'student' | 'course', insUser: string, content: string, extra: any) {
      if (kind === 'student') {
        const ex = await P.studentReview.findFirst({ where: { createdById: insUser, content } });
        if (!ex) await P.studentReview.create({ data: { classSessionId: extra.sessionId, studentId: extra.studentId, content, createdById: insUser } });
      } else {
        const ex = await P.courseReview.findFirst({ where: { createdById: insUser, content } });
        if (!ex) await P.courseReview.create({ data: { courseId: extra.courseId, content, createdById: insUser } });
      }
    }
    await review('student', ZHAO_USER, '【演示】王小宝这节课律动进步明显，节奏感比上周稳了很多，继续保持！', { sessionId: S1, studentId: wangXiaobao });
    await review('course', ZHAO_USER, '【演示】少儿街舞进阶本月重点打磨小组合，孩子们整体跟上来了，下周开始加入队形变化。', { courseId: HIPKIDS_COURSE });
    await review('student', LI_USER, '【演示】陈晓雯身体控制进步很大，即兴片段很有表现力，注意跳跃时膝盖放松。', { sessionId: S4, studentId: chenStudent });
    await review('course', LI_USER, '【演示】成人现代舞本月从地面动作过渡到站立流动组合，大家适应得不错，课堂氛围很好。', { courseId: MODERN_COURSE });
    log.push('reviews done');

    // 8. 私信会话
    async function thread(participantId: string, participantRole: 'PARENT' | 'ADULT_STUDENT', peerUser: string, msgs: Array<[string, 'PARENT' | 'ADULT_STUDENT' | 'INSTRUCTOR', string, boolean]>) {
      let th = await P.messageThread.findFirst({ where: { participantId, peerType: 'INSTRUCTOR', peerId: peerUser } });
      if (!th) th = await P.messageThread.create({ data: { participantId, participantRole, peerType: 'INSTRUCTOR', peerId: peerUser } });
      for (const [senderId, senderRole, body, read] of msgs) {
        const ex = await P.message.findFirst({ where: { threadId: th.id, body } });
        if (ex) continue;
        await P.message.create({ data: { threadId: th.id, senderId, senderRole, body, readAt: read ? new Date() : null } });
      }
      await P.messageThread.update({ where: { id: th.id }, data: { lastMessageAt: new Date() } });
      return th;
    }
    await thread(WPARENT, 'PARENT', ZHAO_USER, [
      [WPARENT, 'PARENT', '赵老师您好，王小宝这周六街舞课可能要晚到10分钟，前面有个英语试听课。', true],
      [ZHAO_USER, 'INSTRUCTOR', '好的，没问题，晚到直接进教室就行，我会帮他补上热身部分。', true],
      [WPARENT, 'PARENT', '太感谢了！另外想问下进阶班下个月有汇报演出吗？', false],
    ]);
    await thread(CHEN, 'ADULT_STUDENT', LI_USER, [
      [CHEN, 'ADULT_STUDENT', '李老师，周四现代舞课我可能要请个假，临时加班。', true],
      [LI_USER, 'INSTRUCTOR', '好的，记得在系统里约一下补课，这周六晚上我有爵士舞大课也可以来补。', true],
      [CHEN, 'ADULT_STUDENT', '好的，我看看时间，谢谢老师！', false],
    ]);
    log.push('threads done');

    // 9. 代课：互相代一节
    const sub1 = await P.sessionOccurrence.findFirst({ where: { id: occByDate[S3]['2026-10-17'] } });
    if (sub1 && !sub1.substituteInstructorId) {
      await P.sessionOccurrence.update({ where: { id: sub1.id }, data: { substituteInstructorId: LI_INS, substituteReason: '赵老师外出参加市舞蹈家协会研讨会', substituteAssignedAt: new Date(), substituteAssignedById: admin!.id } });
    }
    const sub2 = await P.sessionOccurrence.findFirst({ where: { id: occByDate[S5]['2026-10-14'] } });
    if (sub2 && !sub2.substituteInstructorId) {
      await P.sessionOccurrence.update({ where: { id: sub2.id }, data: { substituteInstructorId: ZHAO_INS, substituteReason: '李老师请假', substituteAssignedAt: new Date(), substituteAssignedById: admin!.id } });
    }
    log.push('substitutes done');

    // 10. 李老师 PENDING 停课申请（赵老师已有，复用）
    const liCancel = await P.occurrenceCancelRequest.findFirst({ where: { instructorId: LI_INS, status: 'PENDING' } });
    if (!liCancel) {
      await P.occurrenceCancelRequest.create({ data: {
        occurrenceId: occByDate[S4]['2026-10-15'], instructorId: LI_INS,
        reason: '10月15日需参加教学培训，申请停课一次，希望顺延补上', postpone: true, status: 'PENDING',
      }});
    }
    log.push('cancel request done');

    return { ok: true, log };
  }
}
