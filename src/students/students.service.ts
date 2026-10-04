import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SearchStudentsQuery {
  audience?: 'YOUTH' | 'ADULT';
  campus?: string;
  weekday?: number;
  q?: string;
  term?: string;
}

/**
 * 学员查询服务（§6.12，superset 覆盖 §6.11 需求）：
 * 全体学员搜索（端口/校区/上课星期几/姓名）+ 学员详情
 *（基本信息 + 跨校区报名列表 + 缴费 + 补课情况）。
 */
@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /admin/students?audience=&campus=&weekday=&q= */
  async search(query: SearchStudentsQuery) {
    const where: Prisma.StudentWhereInput = {};
    if (query.audience === 'YOUTH') {
      // 儿童端：有家长（非 SELF）关联的学员
      where.parentLinks = { some: { relationship: { not: 'SELF' } } };
    } else if (query.audience === 'ADULT') {
      // 成人端：学员自己绑定自己（SELF）
      where.parentLinks = { some: { relationship: 'SELF' } };
    }
    if (query.campus || query.weekday !== undefined || query.term) {
      where.enrollments = {
        some: {
          classSession: {
            ...(query.campus ? { campusId: query.campus } : {}),
            course: {
              ...(query.weekday !== undefined
                ? { weekdays: { has: query.weekday } }
                : {}),
              ...(query.term ? { termId: query.term } : {}),
            },
          },
        },
      };
    }
    if (query.q) {
      where.name = { contains: query.q, mode: 'insensitive' };
    }
    return this.prisma.student.findMany({
      where,
      include: {
        parentLinks: {
          include: {
            parent: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        },
        _count: { select: { enrollments: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  /** GET /admin/students/:id/detail：基本信息 + 跨校区报名 + 缴费 + 补课 */
  async detail(id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: {
        parentLinks: {
          include: {
            parent: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        },
        enrollments: {
          include: {
            classSession: {
              include: {
                course: {
                  select: {
                    id: true,
                    title: true,
                    format: true,
                    term: { select: { id: true, name: true } },
                  },
                },
                campus: { select: { id: true, name: true } },
                instructor: {
                  select: { id: true, user: { select: { name: true } } },
                },
                occurrences: {
                  select: {
                    id: true,
                    sessionNumber: true,
                    date: true,
                    status: true,
                  },
                  orderBy: { sessionNumber: 'asc' },
                },
              },
            },
            // 缴费：经 OrderItem → Order → Payment/RefundRecord 流水
            orderItems: {
              include: {
                order: {
                  select: {
                    id: true,
                    amountCents: true,
                    status: true,
                    createdAt: true,
                    payments: {
                      select: {
                        id: true,
                        amountCents: true,
                        method: true,
                        status: true,
                        paidAt: true,
                      },
                    },
                    refunds: {
                      select: { id: true, amountCents: true, createdAt: true },
                    },
                  },
                },
              },
            },
            // 补课情况
            makeupBookings: {
              include: {
                missedOccurrence: {
                  select: { id: true, sessionNumber: true, date: true },
                },
                makeupOccurrence: {
                  select: {
                    id: true,
                    sessionNumber: true,
                    date: true,
                    classSession: {
                      select: {
                        id: true,
                        course: { select: { id: true, title: true } },
                        campus: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { enrolledAt: 'desc' },
        },
      },
    });
    if (!student) throw new NotFoundException('学员不存在');

    const eventRegistrations = await this.prisma.eventRegistration.findMany({
      where: { studentId: id },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            category: true,
            startTime: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 每条报名的出勤记录（按课次）
    const enrollmentIds = student.enrollments.map((e) => e.id);
    const attendanceRecords = await this.prisma.attendanceRecord.findMany({
      where: { enrollmentId: { in: enrollmentIds } },
      select: {
        enrollmentId: true,
        sessionOccurrenceId: true,
        status: true,
        checkInMethod: true,
      },
    });
    const attByKey = new Map(
      attendanceRecords.map((r) => [
        `${r.enrollmentId}:${r.sessionOccurrenceId}`,
        r,
      ]),
    );

    if (!student) throw new NotFoundException('学员不存在');

    // 按学期汇总补课额度：{ termId, termName, quota, used, remaining }
    const termIds = [
      ...new Set(
        (await this.prisma.enrollment.findMany({
          where: { studentId: id },
          include: {
            classSession: { select: { course: { select: { termId: true } } } },
          },
        }))
          .map((e) => e.classSession.course.termId)
          .filter((t): t is string => !!t),
      ),
    ];
    const makeupQuotas: Array<{
      termId: string;
      termName: string;
      quota: number;
      used: number;
      remaining: number;
    }> = [];
    for (const termId of termIds) {
      const term = await this.prisma.term.findUnique({ where: { id: termId } });
      if (!term) continue;
      const used = await this.prisma.makeupBooking.count({
        where: {
          enrollment: {
            studentId: id,
            classSession: { course: { termId } },
          },
          status: { in: ['BOOKED', 'ATTENDED'] },
        },
      });
      makeupQuotas.push({
        termId: term.id,
        termName: term.name,
        quota: term.makeupQuota,
        used,
        remaining: Math.max(0, term.makeupQuota - used),
      });
    }

    return {
      ...student,
      eventRegistrations,
      // 每条报名每节课次的出勤状态，供前端拼上课进度
      attendanceMap: Object.fromEntries(attByKey),
      makeupQuotas,
    };
  }
}
