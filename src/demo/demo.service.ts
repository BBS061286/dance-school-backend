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

  /** 临时：给演示老师（demo-teacher@example.com）补教师端演示数据。幂等，可重复跑。 */
  async seedDemoTeacher() {
    const P = this.prisma;
    const log: string[] = [];
    const INS = '238622f4-745f-42fa-b6d9-40fa106d24f0';
    const HIPKIDS = '3c424583-6c94-4ca7-8e29-4b7699d96338'; // 少儿街舞进阶
    const KIDHIP = 'feed731c-6db8-4a4f-a2cb-8563322f68ad'; // 儿童街舞
    const NEEDHAM = 'dd51f3e3-fbc0-41f6-b222-2404a63f604d';
    const PW = '$2b$10$xnpQUZxKnDIaznrLZlZ7V.K1w8TdmkCe4tutNsKEQh3IBDM7CmV8q'; // Teach1234!
    const D = (s: string) => new Date(s + 'T00:00:00.000Z');
    const admin = await P.user.findFirst({ where: { email: 'admin@danceschool.local' } });
    if (!admin) throw new Error('admin not found');

    // 0. 密码重置
    const tUser = await P.user.findFirst({ where: { email: 'demo-teacher@example.com' } });
    if (!tUser) throw new Error('demo teacher user not found');
    await P.user.update({ where: { id: tUser.id }, data: { passwordHash: PW, mustChangePassword: false } });
    log.push('password reset ok');

    // 1. 两个班次（幂等：courseId+instructorId+startTime）
    async function session(courseId: string, start: string, end: string) {
      let s = await P.classSession.findFirst({ where: { courseId, instructorId: INS, startTime: new Date(start) } });
      if (!s) {
        s = await P.classSession.create({ data: {
          courseId, campusId: NEEDHAM, instructorId: INS,
          startTime: new Date(start), endTime: new Date(end),
          capacity: 15, status: 'SCHEDULED',
        }});
        log.push(`session created ${courseId.slice(0, 8)} ${start.slice(0, 10)}`);
      }
      return s;
    }
    const sA = await session(HIPKIDS, '2026-10-03T15:00:00.000Z', '2026-10-03T16:00:00.000Z'); // 周六 11:00 EDT
    const sB = await session(KIDHIP, '2026-10-07T22:00:00.000Z', '2026-10-07T23:00:00.000Z'); // 周三 18:00 EDT

    // 2. 每班 8 名学员（按姓名找，幂等）
    const namesA = ['王小宝', '王小虎', '王小贝', '演示大宝', '演示小宝', '演示二宝', '李梦瑶', '孙浩然'];
    const namesB = ['张小雨', '张小阳', '刘思思', '刘天天', '赵小乐', '郑小宝', '陈小峰', '陈小朵'];
    async function enroll(sessionId: string, names: string[]) {
      let n = 0;
      for (const nm of names) {
        const st = await P.student.findFirst({ where: { name: nm } });
        if (!st) { log.push(`student not found: ${nm}`); continue; }
        const ex = await P.enrollment.findFirst({ where: { classSessionId: sessionId, studentId: st.id } });
        if (ex) continue;
        await P.enrollment.create({ data: { classSessionId: sessionId, studentId: st.id, enrolledByParentId: admin!.id, status: 'CONFIRMED' } });
        n++;
      }
      await P.classSession.update({ where: { id: sessionId }, data: { enrolledCount: await P.enrollment.count({ where: { classSessionId: sessionId, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } } }) } });
      return n;
    }
    log.push(`enroll A +${await enroll(sA.id, namesA)}, B +${await enroll(sB.id, namesB)}`);

    // 3. 课次（覆盖本周，含今天 10/10）
    const targets: Record<string, { dates: string[]; timeRange: string }> = {
      [sA.id]: { dates: ['2026-10-03', '2026-10-10', '2026-10-17'], timeRange: '11:00-12:00' },
      [sB.id]: { dates: ['2026-10-07', '2026-10-14', '2026-10-21'], timeRange: '18:00-19:00' },
    };
    const occByDate: Record<string, Record<string, string>> = {};
    for (const [sid, t] of Object.entries(targets)) {
      occByDate[sid] = {};
      for (const ds of t.dates) {
        let occ = await P.sessionOccurrence.findFirst({ where: { classSessionId: sid, date: D(ds) } });
        if (!occ) {
          const maxN = (await P.sessionOccurrence.aggregate({ where: { classSessionId: sid }, _max: { sessionNumber: true } }))._max.sessionNumber ?? 0;
          occ = await P.sessionOccurrence.create({ data: { classSessionId: sid, sessionNumber: maxN + 1, date: D(ds), status: 'SCHEDULED', timeRange: t.timeRange } });
        }
        occByDate[sid][ds] = occ.id;
      }
      const all = await P.sessionOccurrence.findMany({ where: { classSessionId: sid }, orderBy: { date: 'asc' } });
      for (let i = 0; i < all.length; i++) {
        if (all[i].sessionNumber !== i + 1) await P.sessionOccurrence.update({ where: { id: all[i].id }, data: { sessionNumber: i + 1 } });
      }
    }
    log.push('occurrences ok');

    // 4. 过去课次学员考勤（混合出勤/缺席）
    let att = 0;
    for (const [sid, t] of Object.entries(targets)) {
      const enrollments = await P.enrollment.findMany({ where: { classSessionId: sid, status: 'CONFIRMED' }, select: { id: true } });
      for (const ds of t.dates) {
        if (ds >= '2026-10-10') continue;
        const occId = occByDate[sid][ds];
        for (let i = 0; i < enrollments.length; i++) {
          const ex = await P.attendanceRecord.findFirst({ where: { sessionOccurrenceId: occId, enrollmentId: enrollments[i].id } });
          if (ex) continue;
          const absent = (i * 5 + ds.length) % 6 === 0;
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

    // 5. 老师打卡 2 条
    const checkins: Array<[string, string, string]> = [
      [sA.id, '2026-10-03', '11:00-12:00'],
      [sB.id, '2026-10-07', '18:00-19:00'],
    ];
    let ci = 0;
    for (const [sid, ds, time] of checkins) {
      const ex = await P.instructorCheckin.findFirst({ where: { instructorId: INS, classSessionId: sid, date: D(ds) } });
      if (ex) continue;
      await P.instructorCheckin.create({ data: {
        instructorId: INS, classSessionId: sid, sessionOccurrenceId: occByDate[sid][ds],
        campus: 'Needham 校区', date: D(ds), time,
      }});
      ci++;
    }
    log.push(`checkins +${ci}`);

    // 家长 userId（王小宝的家长）
    const wParent = await P.parentStudentLink.findFirst({ where: { student: { name: '王小宝' } } });
    if (!wParent) throw new Error('王小宝家长关联不存在');
    const WPARENT = wParent.parentId;
    const wangXiaobao = (await P.student.findFirst({ where: { name: '王小宝' } }))!.id;

    // 6. 加课 1 个（待排时段）
    let req = await P.extraLessonRequest.findFirst({ where: { studentId: wangXiaobao, content: '【演示】少儿街舞课堂表现提升（演示老师）' } });
    if (!req) {
      req = await P.extraLessonRequest.create({ data: {
        type: 'ONE_ON_ONE', studentId: wangXiaobao, audience: 'YOUTH',
        content: '【演示】少儿街舞课堂表现提升（演示老师）', location: 'Needham 校区 Studio A',
        initiatedBy: 'STUDENT', instructorId: INS, createdById: WPARENT,
        status: 'APPROVED', campusId: NEEDHAM,
      }});
      log.push('extra lesson created');
    }

    // 7. 评价 1 条（学员评价）
    const revContent = '【演示】王小宝这节课动作记忆进步明显，跟着音乐能完整跳完小组合了，继续加油！';
    const exRev = await P.studentReview.findFirst({ where: { createdById: tUser.id, content: revContent } });
    if (!exRev) {
      await P.studentReview.create({ data: { classSessionId: sA.id, studentId: wangXiaobao, content: revContent, createdById: tUser.id } });
      log.push('review created');
    }

    // 8. 与王家长私信会话（3 条消息）
    let th = await P.messageThread.findFirst({ where: { participantId: WPARENT, peerType: 'INSTRUCTOR', peerId: tUser.id } });
    if (!th) th = await P.messageThread.create({ data: { participantId: WPARENT, participantRole: 'PARENT', peerType: 'INSTRUCTOR', peerId: tUser.id } });
    const msgs: Array<[string, 'PARENT' | 'INSTRUCTOR', string, boolean]> = [
      [WPARENT, 'PARENT', '老师您好，王小宝下周六的街舞课想请个假，家里有事。', true],
      [tUser.id, 'INSTRUCTOR', '好的，收到。缺的这节可以在下周三儿童街舞班补上，我帮他安排。', true],
      [WPARENT, 'PARENT', '太好了，谢谢老师！', false],
    ];
    for (const [senderId, senderRole, body, read] of msgs) {
      const ex = await P.message.findFirst({ where: { threadId: th.id, body } });
      if (ex) continue;
      await P.message.create({ data: { threadId: th.id, senderId, senderRole, body, readAt: read ? new Date() : null } });
    }
    await P.messageThread.update({ where: { id: th.id }, data: { lastMessageAt: new Date() } });
    log.push('thread ok');

    return { ok: true, log };
  }
}
