import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSessionDto } from './dto/create-session.dto';

/** 班次管理服务：管理员新建班次（上课时间/校区/老师/名额）。 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /admin/sessions（ADMIN）：新建班次 */
  async create(dto: CreateSessionDto) {
    const course = await this.prisma.course.findUnique({
      where: { id: dto.course_id },
      select: { id: true, capacity: true },
    });
    if (!course) throw new NotFoundException('课程不存在');
    const campus = await this.prisma.campus.findUnique({
      where: { id: dto.campus_id },
      select: { id: true },
    });
    if (!campus) throw new NotFoundException('校区不存在');
    const instructor = await this.prisma.instructor.findUnique({
      where: { id: dto.instructor_id },
      select: { id: true },
    });
    if (!instructor) throw new NotFoundException('教师不存在');

    const start = new Date(dto.start_time);
    const end = new Date(dto.end_time);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      throw new BadRequestException('开始/结束时间非法');
    }
    const capacity = dto.capacity ?? course.capacity;
    if (capacity < 1 || capacity > 50) {
      throw new BadRequestException('名额为 1-50 人');
    }

    return this.prisma.classSession.create({
      data: {
        courseId: dto.course_id,
        campusId: dto.campus_id,
        instructorId: dto.instructor_id,
        room: dto.room,
        startTime: start,
        endTime: end,
        capacity,
        waitlistCapacity: dto.waitlist_capacity ?? 10,
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        status: true,
      },
    });
  }
}
