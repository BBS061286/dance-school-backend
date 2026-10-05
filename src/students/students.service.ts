import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Gender, Prisma, Relationship, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AdminCreateStudentDto } from './dto/admin-create-student.dto';
import { ParentCreateStudentDto } from './dto/parent-create-student.dto';

export interface SearchStudentsQuery {
  audience?: 'YOUTH' | 'ADULT';
  campus?: string;
  weekday?: number;
  q?: string;
  term?: string;
  /** 课程类型：GROUP/ PRIVATE/MASTER，逗号分隔表示"同时上"（如 GROUP,PRIVATE） */
  formats?: string;
}

/**
 * 学员查询服务（§6.12，superset 覆盖 §6.11 需求）：
 * 全体学员搜索（端口/校区/上课星期几/姓名）+ 学员详情
 *（基本信息 + 跨校区报名列表 + 缴费 + 补课情况）。
 */
@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 管理端直接建学员：POST /admin/students（ADMIN）。
   * - type=child：parentId（关联已有家长）或 parent（新建家长账号）二选一
   * - type=adult：新建 ADULT_STUDENT 账号 + SELF 关联
   * 新建账号均设 mustChangePassword=true，返回临时密码。
   */
  async adminCreate(dto: AdminCreateStudentDto) {
    const dob = dto.birthdate ? new Date(dto.birthdate) : null;
    const gender = dto.gender ?? null;

    if (dto.type === 'child') {
      if (!dto.parentId && !dto.parent) {
        throw new BadRequestException('少儿学员需提供 parentId 或 parent');
      }
      if (dto.parentId && dto.parent) {
        throw new BadRequestException('parentId 和 parent 只能传一个');
      }

      let parentUserId: string;
      let tempPassword: string | null = null;

      if (dto.parentId) {
        const parent = await this.prisma.user.findUnique({ where: { id: dto.parentId } });
        if (!parent || parent.role !== UserRole.PARENT) {
          throw new BadRequestException('指定的家长不存在或角色不正确');
        }
        parentUserId = parent.id;
      } else {
        const p = dto.parent!;
        // 按 phone 找已有家长
        const existing = await this.prisma.user.findFirst({
          where: { phone: p.phone, role: UserRole.PARENT },
        });
        if (existing) {
          parentUserId = existing.id;
        } else {
          if (p.email) {
            const emailTaken = await this.prisma.user.findUnique({ where: { email: p.email } });
            if (emailTaken) throw new ConflictException('该邮箱已被注册');
          }
          tempPassword = randomBytes(4).toString('hex');
          const passwordHash = await bcrypt.hash(tempPassword, 10);
          const created = await this.prisma.user.create({
            data: {
              email: p.email ?? `parent_${Date.now()}@placeholder.local`,
              name: p.name,
              phone: p.phone,
              role: UserRole.PARENT,
              passwordHash,
              mustChangePassword: true,
            },
          });
          parentUserId = created.id;
        }
      }

      const student = await this.prisma.student.create({
        data: { name: dto.name, dob, gender },
      });
      await this.prisma.parentStudentLink.create({
        data: {
          parentId: parentUserId,
          studentId: student.id,
          relationship: Relationship.GUARDIAN,
          isPrimaryContact: true,
        },
      });
      return { student, parentId: parentUserId, ...(tempPassword ? { tempPassword } : {}) };
    }

    // type=adult
    if (dto.email) {
      const emailTaken = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (emailTaken) throw new ConflictException('该邮箱已被注册');
    }
    const tempPassword = randomBytes(4).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email ?? `adult_${Date.now()}@placeholder.local`,
          name: dto.name,
          phone: dto.phone,
          role: UserRole.ADULT_STUDENT,
          passwordHash,
          mustChangePassword: true,
        },
      });
      const student = await tx.student.create({
        data: { name: dto.name, dob, gender },
      });
      await tx.parentStudentLink.create({
        data: {
          parentId: user.id,
          studentId: student.id,
          relationship: Relationship.SELF,
          isPrimaryContact: true,
        },
      });
      return { user, student };
    });
    return { student: result.student, userId: result.user.id, tempPassword };
  }

  /** 家长自助添加孩子：POST /me/students */
  async parentCreate(parentId: string, dto: ParentCreateStudentDto) {
    const parent = await this.prisma.user.findUnique({ where: { id: parentId } });
    if (!parent || parent.role !== UserRole.PARENT) {
      throw new ForbiddenException('仅家长账号可添加孩子');
    }
    const student = await this.prisma.student.create({
      data: {
        name: dto.name.trim(),
        dob: new Date(dto.birthdate),
        gender: dto.gender ?? null,
        medicalNotes: dto.medicalNotes?.trim() || null,
        parentLinks: {
          create: {
            parentId,
            relationship: dto.relationship ?? 'GUARDIAN',
            isPrimaryContact: true,
            canPay: true,
          },
        },
      },
      include: { parentLinks: true },
    });
    return student;
  }

  /** 家长查看孩子详情：GET /me/students/:id */
  async parentGetStudent(parentId: string, studentId: string) {
    const link = await this.prisma.parentStudentLink.findUnique({
      where: { parentId_studentId: { parentId, studentId } },
      include: { student: true },
    });
    if (!link) throw new ForbiddenException('该学员不属于您');
    const st = link.student;
    // 计算年龄
    let age: number | null = null;
    if (st.dob) {
      const now = new Date();
      const dob = new Date(st.dob);
      age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    }
    // 报名课程（按课程类型分组）
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
      include: {
        classSession: {
          include: {
            course: { select: { id: true, title: true, format: true } },
            campus: { select: { id: true, name: true } },
            instructor: { include: { user: { select: { name: true } } } },
          },
        },
      },
    });

    // 考勤统计
    const attendance = await this.prisma.attendanceRecord.findMany({
      where: { enrollment: { studentId } },
      select: { status: true, enrollmentId: true },
    });
    const presentCount = attendance.filter((a) => a.status === 'CONFIRMED').length;
    const absentCount = attendance.filter((a) => a.status === 'ABSENT').length;

    // 缺席明细
    const absences = await this.prisma.attendanceRecord.findMany({
      where: { enrollment: { studentId }, status: 'ABSENT' },
      include: {
        enrollment: {
          include: {
            classSession: {
              include: {
                course: { select: { title: true, format: true } },
              },
            },
          },
        },
        sessionOccurrence: { select: { date: true, sessionNumber: true } },
      },
      orderBy: { checkedInAt: 'desc' },
      take: 20,
    });

    // 私教课申请
    const extraLessons = await this.prisma.extraLessonRequest.findMany({
      where: { studentId },
      include: {
        slots: { orderBy: { date: 'asc' } },
        instructor: { include: { user: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // 按课程类型分组
    const byFormat: Record<string, typeof enrollments> = { GROUP: [], PRIVATE: [], MASTER: [] };
    for (const en of enrollments) {
      const fmt = en.classSession?.course?.format ?? 'GROUP';
      if (!byFormat[fmt]) byFormat[fmt] = [];
      byFormat[fmt].push(en);
    }

    return {
      id: st.id,
      name: st.name,
      dob: st.dob,
      age,
      gender: st.gender,
      photoUrl: st.photoUrl,
      medicalNotes: st.medicalNotes,
      relationship: link.relationship,
      courses: {
        group: byFormat.GROUP.map((en) => ({
          id: en.id,
          courseTitle: en.classSession?.course?.title ?? '—',
          campus: en.classSession?.campus?.name ?? '—',
          teachers: en.classSession?.instructor?.user?.name ? [en.classSession.instructor.user.name] : [],
          startTime: en.classSession?.startTime,
          endTime: en.classSession?.endTime,
          status: en.status,
        })),
        private: byFormat.PRIVATE.map((en) => ({
          id: en.id,
          courseTitle: en.classSession?.course?.title ?? '—',
          campus: en.classSession?.campus?.name ?? '—',
          teachers: en.classSession?.instructor?.user?.name ? [en.classSession.instructor.user.name] : [],
          status: en.status,
        })),
        master: byFormat.MASTER.map((en) => ({
          id: en.id,
          courseTitle: en.classSession?.course?.title ?? '—',
          campus: en.classSession?.campus?.name ?? '—',
          teachers: en.classSession?.instructor?.user?.name ? [en.classSession.instructor.user.name] : [],
          status: en.status,
        })),
      },
      attendance: { present: presentCount, absent: absentCount },
      absences: absences.map((a) => ({
        courseTitle: a.enrollment?.classSession?.course?.title ?? '—',
        format: a.enrollment?.classSession?.course?.format ?? 'GROUP',
        date: a.sessionOccurrence?.date,
        sessionNumber: a.sessionOccurrence?.sessionNumber,
      })),
      extraLessons: extraLessons.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        teacher: r.instructor?.user?.name ?? '待分配',
        slots: r.slots.map((sl) => ({ date: sl.date, time: sl.time, status: sl.status })),
      })),
    };
  }

  /** 家长给孩子上传照片：POST /me/students/:id/photo */
  async uploadPhoto(parentId: string, studentId: string, filename: string) {
    // 校验该学员属于该家长
    const link = await this.prisma.parentStudentLink.findUnique({
      where: { parentId_studentId: { parentId, studentId } },
    });
    if (!link) throw new ForbiddenException('该学员不属于您');
    return this.prisma.student.update({
      where: { id: studentId },
      data: { photoUrl: `/uploads/${filename}` },
    });
  }

  /** GET /admin/students?audience=&campus=&weekday=&q= */
  /** 学员统计：GET /admin/students/stats — 现役少儿/成人数量 */
  async stats() {
    // 现役 = 有至少一条 CONFIRMED 或 PENDING_PAYMENT 的报名
    const activeEnrollments = await this.prisma.enrollment.findMany({
      where: { status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
      select: {
        studentId: true,
        student: {
          select: {
            id: true,
            dob: true,
            parentLinks: {
              select: { relationship: true },
            },
          },
        },
      },
    });
    // 去重
    const seen = new Map<string, { dob: Date | null; parentLinks: Array<{ relationship: string }> }>();
    for (const e of activeEnrollments) {
      if (!seen.has(e.studentId)) {
        seen.set(e.studentId, {
          dob: e.student.dob,
          parentLinks: e.student.parentLinks,
        });
      }
    }
    let youth = 0;
    let adult = 0;
    const now = new Date();
    for (const [, st] of seen) {
      const hasSelf = st.parentLinks.some((l) => l.relationship === 'SELF');
      const hasNonSelf = st.parentLinks.some((l) => l.relationship !== 'SELF');
      let isAdult: boolean;
      if (hasSelf) {
        isAdult = true;
      } else if (hasNonSelf) {
        isAdult = false;
      } else {
        // 无关联按年龄
        if (!st.dob) {
          isAdult = false;
        } else {
          const age = (now.getTime() - new Date(st.dob).getTime()) / 31557600000;
          isAdult = age >= 18;
        }
      }
      if (isAdult) adult++;
      else youth++;
    }
    return { youth, adult, total: youth + adult };
  }

  async search(query: SearchStudentsQuery) {
    const where: Prisma.StudentWhereInput = {};
    if (query.audience === 'YOUTH' || query.audience === 'ADULT') {
      // 受众筛选：有家长关联的按关联类型；无关联的按年龄兜底（18岁为界）
      const eighteenYearsAgo = new Date();
      eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
      if (query.audience === 'YOUTH') {
        where.OR = [
          { parentLinks: { some: { relationship: { not: 'SELF' } } } },
          {
            parentLinks: { none: {} },
            dob: { gt: eighteenYearsAgo },
          },
        ];
      } else {
        where.OR = [
          { parentLinks: { some: { relationship: 'SELF' } } },
          {
            parentLinks: { none: {} },
            dob: { lte: eighteenYearsAgo },
          },
        ];
      }
    }
    const formatList = (query.formats ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter((f) => ['GROUP', 'PRIVATE', 'MASTER'].includes(f));
    // 构造"某类型报名"过滤器
    const formatEnrollment = (fmt: string): Prisma.EnrollmentWhereInput => ({
      classSession: {
        ...(query.campus ? { campusId: query.campus } : {}),
        course: {
          ...(query.weekday !== undefined ? { weekdays: { has: query.weekday } } : {}),
          ...(query.term ? { termId: query.term } : {}),
          format: fmt as never,
        },
      },
    });
    const plainEnrollment = (): Prisma.EnrollmentWhereInput => ({
      classSession: {
        ...(query.campus ? { campusId: query.campus } : {}),
        course: {
          ...(query.weekday !== undefined ? { weekdays: { has: query.weekday } } : {}),
          ...(query.term ? { termId: query.term } : {}),
        },
      },
    });
    if (query.campus || query.weekday !== undefined || query.term || formatList.length > 0) {
      if (formatList.length === 1) {
        where.enrollments = { some: formatEnrollment(formatList[0]) };
      } else if (formatList.length > 1) {
        // 多类型：每种都要有报名（AND）
        where.AND = formatList.map((f) => ({ enrollments: { some: formatEnrollment(f) } }));
      } else {
        where.enrollments = { some: plainEnrollment() };
      }
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
