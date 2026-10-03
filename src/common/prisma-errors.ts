import { Prisma } from '@prisma/client';

/** 是否为唯一约束冲突（P2002）。Stripe webhook 幂等去重的核心判断：重复回调命中唯一约束时直接返回 200。 */
export function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}
