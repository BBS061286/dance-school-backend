import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 学期结束自动归档：每天凌晨检查，
 * 把所属学期已结束（endDate < 今天）且仍为 PUBLISHED 的课程改为 ARCHIVED。
 * DRAFT 不动（还没发布），已 ARCHIVED 的跳过。
 */
@Injectable()
export class TermArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  async archiveEndedTerms(): Promise<{ archived: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await this.prisma.course.updateMany({
      where: {
        status: 'PUBLISHED',
        term: { endDate: { lt: today } },
      },
      data: { status: 'ARCHIVED' },
    });

    if (result.count > 0) {
      // eslint-disable-next-line no-console
      console.log(`[term-archive] 已自动归档 ${result.count} 门课程`);
    }
    return { archived: result.count };
  }
}
