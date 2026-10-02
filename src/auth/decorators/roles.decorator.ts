import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** 声明路由允许的角色；配合全局 RolesGuard 使用 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
