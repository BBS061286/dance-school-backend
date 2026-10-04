import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTermDto, UpdateTermDto } from './dto/term.dto';

/** 学期管理服务（管理端）：学期列表/新建/编辑/删除（仅无课程关联时）。 */
@Injectable()
export class TermsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 学期排序：当前进行中的学期优先，其余按开始日期倒序 */
  private sortTerms<T extends { startDate: Date | string; endDate: Date | string }>(terms: T[]): T[] {
    // 纯时间倒序：2027春 → 2026秋 → 2026春 → 2025秋
    // 默认选中由前端控制（通用默认当前学期，教师分配默认未来学期）
    return [...terms].sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );
  }

  /** GET /admin/terms：学期列表（含课程数），当前学期优先 */
  async list() {
    const terms = await this.prisma.term.findMany({
      include: { _count: { select: { courses: true } } },
      orderBy: { startDate: 'desc' },
    });
    return this.sortTerms(terms);
  }

  /** GET /terms：仅返回启用中的学期（公开），当前学期优先 */
  async active() {
    const terms = await this.prisma.term.findMany({
      where: { isActive: true },
      select: { id: true, name: true, startDate: true, endDate: true },
      orderBy: { startDate: 'desc' },
    });
    return this.sortTerms(terms);
  }

  /** POST /admin/terms：新建学期 */
  async create(dto: CreateTermDto) {
    if (new Date(dto.startDate) > new Date(dto.endDate)) {
      throw new BadRequestException('开始日期不能晚于结束日期');
    }
    return this.prisma.term.create({
      data: {
        name: dto.name.trim(),
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
    });
  }

  /** PATCH /admin/terms/:id：编辑学期 */
  async update(id: string, dto: UpdateTermDto) {
    const term = await this.prisma.term.findUnique({ where: { id } });
    if (!term) throw new NotFoundException('学期不存在');
    const start = dto.startDate ? new Date(dto.startDate) : term.startDate;
    const end = dto.endDate ? new Date(dto.endDate) : term.endDate;
    if (start > end) throw new BadRequestException('开始日期不能晚于结束日期');
    return this.prisma.term.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.startDate !== undefined ? { startDate: new Date(dto.startDate) } : {}),
        ...(dto.endDate !== undefined ? { endDate: new Date(dto.endDate) } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.makeupQuota !== undefined ? { makeupQuota: dto.makeupQuota } : {}),
      },
    });
  }

  /** DELETE /admin/terms/:id：仅无课程关联时允许删除 */
  async remove(id: string) {
    const term = await this.prisma.term.findUnique({
      where: { id },
      include: { _count: { select: { courses: true } } },
    });
    if (!term) throw new NotFoundException('学期不存在');
    if (term._count.courses > 0) {
      throw new ConflictException(
        `该学期下还有 ${term._count.courses} 门课程，无法删除`,
      );
    }
    await this.prisma.term.delete({ where: { id } });
    return { id, deleted: true };
  }
}
