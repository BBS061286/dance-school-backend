import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto } from './dto/staff.dto';

/**
 * 员工（管理员账号）管理服务。
 * 现有管理员可在此创建新的管理员账号：生成随机临时密码一次返回，
 * 新账号首次登录须强制改密（mustChangePassword=true，复用老师账号同模式）。
 */
@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /admin/staff：创建管理员账号 */
  async create(dto: CreateStaffDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException('该邮箱已被注册');

    const tempPassword = randomBytes(4).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        nameEn: dto.nameEn?.trim() || null,
        phone: dto.phone,
        role: UserRole.ADMIN,
        passwordHash,
        mustChangePassword: true,
      },
      select: { id: true, email: true },
    });
    return { ...user, tempPassword };
  }

  /** PATCH /admin/staff/:id：改员工姓名/英文名/电话 */
  async update(id: string, dto: { name?: string; nameEn?: string; phone?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.role !== UserRole.ADMIN) throw new ConflictException('员工不存在');
    const data: { name?: string; nameEn?: string | null; phone?: string | null } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.nameEn !== undefined) data.nameEn = dto.nameEn?.trim() || null;
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, nameEn: true, email: true, phone: true },
    });
  }

  /** GET /admin/staff：管理员账号列表 */
  async list() {
    return this.prisma.user.findMany({
      where: { role: UserRole.ADMIN },
      select: {
        id: true,
        name: true,
        nameEn: true,
        email: true,
        phone: true,
        isActive: true,
        mustChangePassword: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
