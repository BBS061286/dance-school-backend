import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
    if (user.role === 'ADULT_STUDENT') {
      const link = await this.prisma.parentStudentLink.findFirst({
        where: { parentId: userId, relationship: 'SELF' },
        include: { student: true },
      });
      if (link?.student?.dob) age = calcAge(link.student.dob);
    }
    return { ...safe, age };
  }
}
