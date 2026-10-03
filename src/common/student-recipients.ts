import { PrismaService } from '../prisma/prisma.service';
import { TxClient } from './types';

/**
 * 通知收件人解析（§6.28）。
 * 学员 → 家长经 ParentStudentLink（isPrimaryContact 优先）；
 * 成人学员本人即 User（SELF 关系的 parentId 就是学员自己的 User id，同样走这条链路）。
 * 仅返回首选联系人（去重），无关联时返回空数组。
 */
export async function resolveStudentRecipientUserIds(
  db: PrismaService | TxClient,
  studentId: string,
): Promise<string[]> {
  const links = await db.parentStudentLink.findMany({
    where: { studentId },
    orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }],
    select: { parentId: true },
  });
  const ids = [...new Set(links.map((l) => l.parentId))];
  return ids.slice(0, 1);
}
