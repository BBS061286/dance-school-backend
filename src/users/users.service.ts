import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../common/types';

/** 由出生日期计算周岁 */
function calcAge(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** 当前用户信息；成人学员的 age 由其 SELF 绑定的 Student.dob 派生（v2 §6.10） */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('用户不存在');
    const { passwordHash: _omitted, ...safe } = user;

    let age: number | undefined;
    let dob: string | undefined;
    if (user.role === 'ADULT_STUDENT') {
      const link = await this.prisma.parentStudentLink.findFirst({
        where: { parentId: userId, relationship: 'SELF' },
        include: { student: true },
      });
      if (link?.student?.dob) {
        age = calcAge(link.student.dob);
        dob = link.student.dob.toISOString();
      }
    }
    return { ...safe, age, dob };
  }

  /**
   * 我的学员列表（GET /me/students，PARENT / ADULT_STUDENT）：
   * PARENT 走 parentStudentLink 查关联学员；ADULT_STUDENT 按 SELF 绑定返回自己，
   * 无 SELF 绑定时返回空数组。
   */
  async myStudents(user: RequestUser) {
    if (user.role === 'ADULT_STUDENT') {
      const link = await this.prisma.parentStudentLink.findFirst({
        where: { parentId: user.id, relationship: 'SELF' },
        include: { student: { select: { id: true, name: true } } },
      });
      return link?.student ? [link.student] : [];
    }
    const links = await this.prisma.parentStudentLink.findMany({
      where: { parentId: user.id },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return links.map((l) => l.student);
  }
}
