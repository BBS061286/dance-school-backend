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
}
