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

  /** GET /admin/campuses/:id：校区详情 */
  async detail(id: string) {
    const campus = await this.prisma.campus.findUnique({
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
