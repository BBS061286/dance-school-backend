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
                  select: { id: true, title: true, format: true },
                },
                campus: { select: { id: true, name: true } },
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
    return student;
  }
}
