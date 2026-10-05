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
      ['少儿中国舞', '本课程适合初学者，从基本站姿、手位学起，训练孩子对中国古典舞身韵的基本功，激发孩子对民族舞蹈的兴趣与热爱。'],
      ['少儿街舞', '零基础友好！从律动、节奏感练起，学习 Hip-hop 基础动作，释放孩子的表现力与自信，课堂氛围轻松活泼。'],
      ['少儿芭蕾', '专业芭蕾启蒙，训练正确的身体姿态与柔韧性，从把杆基础到中间组合，培养优雅气质，打好扎实基本功。'],
      ['私教一对一·古典舞', '一对一专属定制，针对学员个人情况强化古典舞水袖、身韵组合训练，快速提升技巧，适合有明确目标的学员。'],
      ['私教一对一·中国舞', '一对一专属指导，老师根据孩子特点量身定制训练计划，重点突破薄弱环节，进步看得见。'],
      ['拉丁舞大师课', '特邀拉丁舞名师亲授，浓缩大师多年舞台经验，从伦巴、恰恰基础到表演技巧，机会难得，名额有限。'],
      ['成人爵士舞', '专为成人设计的爵士舞课程，零基础可学，在动感音乐中塑形减压，找回身体的律动感。'],
      ['成人瑜伽形体', '结合瑜伽与舞蹈形体训练，改善体态、缓解肩颈压力，适合久坐办公人群，每周一次身心放松。'],
    ];
    let updated = 0;
    for (const [kw, desc] of descs) {
      const r = await this.prisma.course.updateMany({
        where: { title: { contains: kw }, description: null },
        data: { description: desc },
      });
      updated += r.count;
    }
    return { message: `已为 ${updated} 门课程补充介绍`, updated };
  }
}
