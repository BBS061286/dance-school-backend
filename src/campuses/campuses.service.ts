import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampusDto, UpdateCampusDto } from './dto/campus.dto';

/**
 * 校区管理服务（管理端统一管控）：
 * 校区列表/详情（含关联班级、活动、教师计数）、新建、编辑、
 * 删除采用软删除（isActive=false），避免破坏已有班级与活动的外键关联。
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
   * DELETE /admin/campuses/:id：停用校区（软删除）。
   * 校区下可能仍有班级/活动/教师关联，硬删除会破坏外键，
   * 故仅置 isActive=false；前端据此展示"已停用"并可重新启用。
   */
  async remove(id: string) {
    const campus = await this.ensureExists(id);
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
    const updated = await this.prisma.campus.update({
      where: { id },
      data: { isActive: false },
    });
    return {
      ...updated,
      _count: counts._count,
      hadRelations:
        counts._count.classSessions +
          counts._count.events +
          counts._count.residentInstructors +
          counts._count.courseLinks >
        0,
      note: campus.isActive ? undefined : '该校区原本就已停用',
    };
  }

  private async ensureExists(id: string) {
    const campus = await this.prisma.campus.findUnique({ where: { id } });
    if (!campus) throw new NotFoundException('校区不存在');
    return campus;
  }
}
