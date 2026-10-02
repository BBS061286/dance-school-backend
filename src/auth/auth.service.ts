import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { jwtExpiresIn } from './jwt.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** 自助注册：家长 / 成人学员（设计文档 §4.2） */
  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException('该邮箱已被注册');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        phone: dto.phone,
        role: dto.role as UserRole,
        passwordHash,
      },
    });

    // 成人学员注册时自动生成"自己绑定自己"的记录，复用 Student/Enrollment 体系（v2 §6.10）
    if (dto.role === 'ADULT_STUDENT') {
      const student = await this.prisma.student.create({
        data: { name: dto.name },
      });
      await this.prisma.parentStudentLink.create({
        data: {
          parentId: user.id,
          studentId: student.id,
          relationship: 'SELF',
          isPrimaryContact: true,
          canPay: true,
        },
      });
    }

    return this.issueTokens(user.id, user.email, user.role);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('邮箱或密码错误');
    return this.issueTokens(user.id, user.email, user.role);
  }

  /** 用 refresh_token 换新的 access_token */
  async refresh(refreshToken: string) {
    let payload: { sub: string; email: string; role: UserRole; tokenType?: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken);
    } catch {
      throw new UnauthorizedException('refresh_token 无效或已过期');
    }
    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('不是合法的 refresh_token');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('用户不存在或已停用');
    }
    return this.issueTokens(user.id, user.email, user.role);
  }

  /** 忘记密码：D1 仅 stub，真实邮件发送在后续阶段接入 SendGrid 后实现 */
  async forgotPassword(email: string) {
    return {
      message: `如果 ${email} 已注册，重置密码邮件将发送到该邮箱（D1 stub，尚未接入邮件服务）`,
    };
  }

  private issueTokens(id: string, email: string, role: UserRole) {
    const payload = { sub: id, email, role };
    const accessExpiresIn = jwtExpiresIn(
      this.config.get<string>('JWT_EXPIRES_IN'),
      '15m',
    );
    return {
      access_token: this.jwt.sign(payload, { expiresIn: accessExpiresIn }),
      refresh_token: this.jwt.sign(
        { ...payload, tokenType: 'refresh' },
        { expiresIn: '7d' },
      ),
      token_type: 'Bearer',
    };
  }
}
