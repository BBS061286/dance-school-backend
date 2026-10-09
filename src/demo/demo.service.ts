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
    const enrollment = await this.prisma.enrollment.create({
      data: {
        studentId,
        classSessionId: session.id,
        enrolledByParentId: parentLink?.parentId ?? '',
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



  /** 给演示班次批量加报名（成人+少儿） */
  async seedRoster() {
    const sessions = await this.prisma.classSession.findMany({
      where: { course: { title: { in: ['少儿街舞进阶', '成人爵士舞', '少年芭蕾', '成人现代舞'] } } },
      include: { course: { select: { title: true } } },
      take: 8,
    });
    const students = await this.prisma.student.findMany({ take: 20 });
    const admin = await this.prisma.user.findFirst({ where: { email: 'admin@danceschool.local' } });
    if (!admin) throw new Error('admin not found');
    let created = 0;
    const results: string[] = [];
    for (const se of sessions) {
      const isYouth = /少儿|少年|儿童/.test(se.course.title);
      let added = 0;
      for (const st of students) {
        if (added >= 5) break;
        const isYouthName = /小/.test(st.name);
        if (isYouth !== isYouthName) continue;
        const existing = await this.prisma.enrollment.findFirst({
          where: { classSessionId: se.id, studentId: st.id },
        });
        if (existing) continue;
        const isWaitlist = added === 4;
        await this.prisma.enrollment.create({
          data: {
            classSessionId: se.id,
            studentId: st.id,
            enrolledByParentId: admin.id,
            status: isWaitlist ? 'WAITLISTED' : 'CONFIRMED',
            waitlistPosition: isWaitlist ? 1 : null,
          },
        });
        created++;
        added++;
      }
      results.push(`${se.course.title}: +${added}`);
    }
    return { created, results };
  }
}