import { Prisma, UserRole } from '@prisma/client';

/** 从 JwtStrategy.validate 挂到 request 上的用户（D1 约定） */
export interface RequestUser {
  id: string;
  email: string;
  role: UserRole;
}

/** Prisma 交互式事务客户端（$transaction 回调参数类型） */
export type TxClient = Prisma.TransactionClient;
