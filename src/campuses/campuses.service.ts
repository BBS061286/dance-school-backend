import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampusDto, UpdateCampusDto } from './dto/campus.dto';

/**
 * 校区管理服务（管理端统一管控）：
 * 校区列表/详情（含关联班级、活动、教师计数）、新建、编辑、
 * 停用（isActive=false，软下线）、删除（真删除，仅无关联数据时允许）。
 */
@Injectable()
export class CampusesService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /admin/campuses：校区列表（含关联计数） */
  async list() {
    return this.prisma.campus.findMany({
      include: {
        _count: {
          select: {
            classSessions: true,
            events: true,
            residentInstructors: true,
            courseLinks: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /** GET /campuses：公开校区列表（仅启用中的，供家长端缴费/报名下拉） */
  async publicList() {
    return this.prisma.campus.findMany({
      where: { isActive: true },
      select: { id: true, name: true, city: true, address: true },
      orderBy: { name: 'asc' },
    });
  }

  /** GET /admin/campuses/:id：校区详情 */
  async detail(id: string) {    const campus = await this.prisma.campus.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            classSessions: true,
            events: true,
            residentInstructors: true,
            courseLinks: true,
          },
        },
      },
    });
    if (!campus) throw new NotFoundException('校区不存在');
    return campus;
  }

  /**
   * GET /admin/campuses/:id/courses：该校区的所有课程。
   * 课程来源 = 课程关联（CourseCampus）∪ 已有班次（ClassSession），按课程聚合：
   * 每门课程含上课时间（周几+时间段）、老师（课程老师+各班次老师去重）、
   * 各班次报名人数/名额及合计。可选 term 按学期过滤。
   */
  async campusCourses(id: string, term?: string) {
    await this.ensureExists(id);
    const sessions = await this.prisma.classSession.findMany({
      where: { campusId: id, ...(term ? { course: { termId: term } } : {}) },
      include: {
        course: {
          include: {
            instructors: { include: { instructor: { include: { user: true } } } },
          },
        },
        instructor: { include: { user: true } },
      },
      orderBy: { startTime: 'asc' },
    });
    const links = await this.prisma.courseCampus.findMany({
      where: {
        campusId: id,
        ...(term ? { course: { termId: term } } : {}),
      },
      include: {
        course: {
          include: {
            instructors: { include: { instructor: { include: { user: true } } } },
          },
        },
      },
    });

    const byCourse = new Map<string, {
      id: string; title: string; weekdays: number[]; timeRange: string | null;
      teachers: Set<string>; sessions: Array<{
        id: string; startTime: Date; endTime: Date; room: string | null;
        instructor: string | null; enrolled: number; capacity: number | null; status: string;
      }>;
    }>();
    const ensure = (course: {
      id: string; title: string; weekdays: number[]; timeRange: string | null;
      instructors: Array<{ instructor: { user: { name: string } | null } | null }>;
    }) => {
      let g = byCourse.get(course.id);
      if (!g) {
        g = {
          id: course.id,
          title: course.title,
          weekdays: course.weekdays ?? [],
          timeRange: course.timeRange ?? null,
          teachers: new Set<string>(),
          sessions: [],
        };
        byCourse.set(course.id, g);
      }
      for (const ci of course.instructors ?? []) {
        const n = ci.instructor?.user?.name;
        if (n) g.teachers.add(n);
      }
      return g;
    };

    for (const l of links) ensure(l.course as any);
    for (const s of sessions) {
      const g = ensure(s.course as any);
      const sn = s.instructor?.user?.name;
      if (sn) g.teachers.add(sn);
      g.sessions.push({
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        room: s.room,
        instructor: sn ?? null,
        enrolled: s.enrolledCount,
        capacity: s.capacity ?? (s.course as any).capacity ?? null,
        status: s.status,
      });
    }

    return [...byCourse.values()].map((g) => ({
      id: g.id,
      title: g.title,
      weekdays: g.weekdays,
      timeRange: g.timeRange,
      teachers: [...g.teachers],
      totalEnrolled: g.sessions.reduce((a, s) => a + (s.enrolled || 0), 0),
      totalCapacity: g.sessions.reduce((a, s) => a + (s.capacity || 0), 0),
      sessions: g.sessions,
    }));
  }

  /** POST /admin/campuses：新建校区 */
  async create(dto: CreateCampusDto) {
    return this.prisma.campus.create({ data: dto });
  }

  /** PATCH /admin/campuses/:id：编辑校区（含启用/停用） */
  async update(id: string, dto: UpdateCampusDto) {
    await this.ensureExists(id);
    return this.prisma.campus.update({ where: { id }, data: dto });
  }

  /**
   * DELETE /admin/campuses/:id：彻底删除校区。
   * 仅当校区下没有任何关联数据（班级/活动/常驻教师/课程关联）时允许；
   * 否则抛 409，提示改用停用（PATCH isActive=false）下线。
   */
  async remove(id: string) {
    await this.ensureExists(id);
    const counts = await this.prisma.campus.findUniqueOrThrow({
      where: { id },
      select: {
        _count: {
          select: {
            classSessions: true,
            events: true,
            residentInstructors: true,
            courseLinks: true,
          },
        },
      },
    });
    const c = counts._count;
    const total = c.classSessions + c.events + c.residentInstructors + c.courseLinks;
    if (total > 0) {
      throw new ConflictException(
        `该校区下还有 ${c.classSessions} 个班级、${c.events} 个活动、` +
          `${c.residentInstructors} 位常驻教师、${c.courseLinks} 个课程关联，无法删除；` +
          `如需下线请使用停用功能`,
      );
    }
    await this.prisma.campus.delete({ where: { id } });
    return { id, deleted: true };
  }

  private async ensureExists(id: string) {
    const campus = await this.prisma.campus.findUnique({ where: { id } });
    if (!campus) throw new NotFoundException('校区不存在');
    return campus;
  }
}
