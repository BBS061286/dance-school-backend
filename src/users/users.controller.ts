import { BadRequestException, Body, Controller, Get, Patch, Post, Request, UploadedFile, UseInterceptors } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { LocalFileInterceptor, UploadedLocalFile } from '../common/local-upload';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthService } from '../auth/auth.service';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  /** 当前用户信息（设计文档 §4.3） */
  @Get('me')
  me(@Request() req: { user: { id: string } }) {
    return this.usersService.getMe(req.user.id);
  }

  /** 改密码：POST /me/password（所有登录用户） */
  @Post('me/password')
  changePassword(@Request() req: { user: RequestUser }, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.id, dto.oldPassword, dto.newPassword);
  }

  /** 我的学员列表（家长 / 成人学员）：[{ id, name }] */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT)
  @Get('me/students')
  myStudents(@Request() req: { user: RequestUser }) {
    return this.usersService.myStudents(req.user);
  }

  /**
   * 编辑自己资料（设计文档 §6.10）：
   * - name / preferredCampusIds 直接写 User
   * - 年龄双写入口：传 dob（推荐）或 age；传 age 时由服务端按"今天减去 age 年"
   *   反算 dob，统一写入 SELF 绑定的 Student.dob（年龄的唯一事实来源）；
   *   GET /me 的 age 派生计算不动。
   */
  @Patch('me')
  async updateMe(
    @Request() req: { user: RequestUser },
    @Body() dto: UpdateMeDto,
  ) {
    const userData: { name?: string; nickname?: string | null; gender?: any; phone?: string | null; email?: string; avatarUrl?: string | null; preferredCampusIds?: string[] } = {};
    if (dto.name !== undefined) userData.name = dto.name;
    if (dto.nickname !== undefined) userData.nickname = dto.nickname || null;
    if (dto.gender !== undefined) userData.gender = dto.gender;
    if (dto.phone !== undefined) userData.phone = dto.phone || null;
    if (dto.avatarUrl !== undefined) userData.avatarUrl = dto.avatarUrl || null;
    if (dto.preferred_campus_ids !== undefined) {
      userData.preferredCampusIds = dto.preferred_campus_ids;
    }
    // 邮箱唯一性校验
    if (dto.email !== undefined && dto.email !== req.user.email) {
      const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (exists) throw new BadRequestException('该邮箱已被使用');
      userData.email = dto.email;
    }
    if (Object.keys(userData).length > 0) {
      await this.prisma.user.update({
        where: { id: req.user.id },
        data: userData,
      });
    }

    if (dto.dob !== undefined || dto.age !== undefined) {
      const link = await this.prisma.parentStudentLink.findFirst({
        where: { parentId: req.user.id, relationship: 'SELF' },
      });
      if (!link) {
        throw new BadRequestException('只有成人学员（有 SELF 绑定）可以更新年龄');
      }
      const dob =
        dto.dob !== undefined ? new Date(dto.dob) : this.dobFromAge(dto.age!);
      if (Number.isNaN(dob.getTime())) {
        throw new BadRequestException('出生日期格式非法');
      }
      await this.prisma.student.update({
        where: { id: link.studentId },
        data: { dob },
      });
    }

    return this.usersService.getMe(req.user.id);
  }

  /** 自己上传头像：POST /me/avatar（PARENT / ADULT_STUDENT） */
  @Roles(UserRole.PARENT, UserRole.ADULT_STUDENT)
  @Post('me/avatar')
  @UseInterceptors(LocalFileInterceptor())
  async uploadAvatar(
    @Request() req: { user: RequestUser },
    @UploadedFile() file?: UploadedLocalFile,
  ) {
    if (!file) throw new BadRequestException('请上传图片文件');
    await this.prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl: `/uploads/${file.filename}` },
    });
    return this.usersService.getMe(req.user.id);
  }

  /** 由周岁反算出生日期：今天减去 age 年（§6.10） */
  private dobFromAge(age: number): Date {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()),
    );
  }
}
