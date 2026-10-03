import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RequestUser } from '../common/types';
import { isUniqueViolation } from '../common/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMakeupBookingDto, CreateMakeupEligibilityDto } from './dto/makeup.dto';

@Injectable()
export class MakeupService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- 补课资格（§6.3）

  /** 某班级的补课资格列表（ADMIN） */
  async listEligibility(classSessionId: string) {
    await this.assertClassSessionExists(classSessionId);
    return this.prisma.makeupEligibility.findMany({
      where: { sourceClassSessionId: classSessionId },
      include: {
        eligibleClassSession: {
          include: {
            course: { select: { id: true, title: true } },
            campus: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 为班级配置一条补课资格（ADMIN） */
  async createEligibility(
    adminId: string,
    classSessionId: string,
    dto: CreateMakeupEligibilityDto,
  ) {
    await this.assertClassSessionExists(classSessionId);
    await this.assertClassSessionExists(dto.eligible_class_session_id);
    if (classSessionId === dto.eligible_class_session_id) {
      throw new BadRequestException('补课去向不能是本班级自身');
    }
    try {
      return await this.prisma.makeupEligibility.create({
        data: {
          sourceClassSessionId: classSessionId,
          eligibleClassSessionId: dto.eligible_class_session_id,
          createdById: adminId,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('该补课资格已配置，请勿重复添加');
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------- 补课预约（§6.4）

  /**
   * 学员查看可选补课场次：按 MakeupEligibility 列出该报名所在班级的
   * 允许去向，取目标班级下 SCHEDULED 的 SessionOccurrence。
   */
  async makeupOptions(user: RequestUser, enrollmentId: string) {
    const enrollment = await this.assertEnrollmentAccessible(user, enrollmentId);
    const eligibilities = await this.prisma.makeupEligibility.findMany({
      where: { sourceClassSessionId: enrollment.classSessionId },
      include: {
        eligibleClassSession: {
          include: {
            course: { select: { id: true, title: true } },
            campus: { select: { id: true, name: true } },
          },
        },
      },
    });
    const targetIds = eligibilities.map((e) => e.eligibleClassSessionId);
    const occurrences =
      targetIds.length === 0
        ? []
        : await this.prisma.sessionOccurrence.findMany({
            where: {
              classSessionId: { in: targetIds },
              status: 'SCHEDULED',
            },
            include: {
              classSession: {
                include: {
                  course: { select: { id: true, title: true } },
                  campus: { select: { id: true, name: true } },
                },
              },
            },
            orderBy: [{ date: 'asc' }, { sessionNumber: 'asc' }],
          });
    return { eligibilities, occurrences };
  }

  /**
   * 预约补课：校验目标场次在资格范围内；写 MakeupBooking(BOOKED)。
   * 学员在补课场次打卡成功后，AttendanceRecord 置 isMakeup=true、
   * 对应 booking → ATTENDED 的联动在 attendance 模块打卡流程中完成。
   */
  async createBooking(user: RequestUser, dto: CreateMakeupBookingDto) {
    const enrollment = await this.assertEnrollmentAccessible(
      user,
      dto.enrollment_id,
    );
    if (enrollment.status !== 'CONFIRMED') {
      throw new ConflictException('只有已确认的报名才能预约补课');
    }

    // missed 场次（若提供）必须属于该报名所在班级
    if (dto.missed_occurrence_id) {
      const missed = await this.prisma.sessionOccurrence.findUnique({
        where: { id: dto.missed_occurrence_id },
      });
      if (!missed) {
        throw new NotFoundException(`缺席场次不存在：${dto.missed_occurrence_id}`);
      }
      if (missed.classSessionId !== enrollment.classSessionId) {
        throw new BadRequestException('缺席场次不属于该报名所在班级');
      }
    }

    // 补课场次必须 SCHEDULED
    const makeup = await this.prisma.sessionOccurrence.findUnique({
      where: { id: dto.makeup_occurrence_id },
    });
    if (!makeup) {
      throw new NotFoundException(`补课场次不存在：${dto.makeup_occurrence_id}`);
    }
    if (makeup.status !== 'SCHEDULED') {
      throw new ConflictException('补课场次当前不可预约（非 SCHEDULED 状态）');
    }

    // 目标场次所属班级必须在该报名班级的补课资格范围内
    const eligible = await this.prisma.makeupEligibility.findUnique({
      where: {
        sourceClassSessionId_eligibleClassSessionId: {
          sourceClassSessionId: enrollment.classSessionId,
          eligibleClassSessionId: makeup.classSessionId,
        },
      },
    });
    if (!eligible) {
      throw new ForbiddenException('该场次不在本班级的补课资格范围内');
    }

    // 同一报名同一补课场次已有有效预约时，幂等返回
    const existing = await this.prisma.makeupBooking.findFirst({
      where: {
        enrollmentId: enrollment.id,
        makeupOccurrenceId: makeup.id,
        status: { in: ['BOOKED', 'ATTENDED'] },
      },
    });
    if (existing) return existing;

    return this.prisma.makeupBooking.create({
      data: {
        enrollmentId: enrollment.id,
        missedOccurrenceId: dto.missed_occurrence_id ?? null,
        makeupOccurrenceId: makeup.id,
        status: 'BOOKED',
      },
    });
  }

  // ---------------------------------------------------------------- 内部工具

  private async assertClassSessionExists(classSessionId: string) {
    const session = await this.prisma.classSession.findUnique({
      where: { id: classSessionId },
    });
    if (!session) throw new NotFoundException(`班级档期不存在：${classSessionId}`);
    return session;
  }

  /**
   * 报名归属校验：管理员可操作任意；家长 / 成人学员只能操作自己
   *（经 ParentStudentLink 绑定）的学员的报名。
   */
  private async assertEnrollmentAccessible(user: RequestUser, enrollmentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment) throw new NotFoundException(`报名不存在：${enrollmentId}`);
    if (user.role !== 'ADMIN') {
      const link = await this.prisma.parentStudentLink.findUnique({
        where: {
          parentId_studentId: {
            parentId: user.id,
            studentId: enrollment.studentId,
          },
        },
      });
      if (!link) throw new ForbiddenException('无权操作该学员的报名');
    }
    return enrollment;
  }
}
