import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { NotificationType, UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../common/types';
import { NotificationCenterService } from './notification-center.service';

class ListNotificationsQueryDto {
  @IsOptional()
  @IsEnum(NotificationType, { message: 'type 必须是合法的通知类型' })
  type?: NotificationType;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean({ message: 'unread_only 必须是布尔值' })
  unread_only?: boolean;
}

/**
 * 统一通知中心路由（§6.28）。全局前缀 /api/v1 在 main.ts 设置。
 * 依赖的 NotificationsService（D1/D4 既有）直接 import，不改动其文件。
 */
@Controller()
export class NotificationsController {
  constructor(private readonly center: NotificationCenterService) {}

  /** 统一通知列表：GET /me/notifications?type=&unread_only= */
  @Get('me/notifications')
  list(
    @Request() req: { user: RequestUser },
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.center.list(req.user.id, {
      type: query.type,
      unreadOnly: query.unread_only,
    });
  }

  /** 角标未读数：GET /me/notifications/unread-count */
  @Get('me/notifications/unread-count')
  unreadCount(@Request() req: { user: RequestUser }) {
    return this.center.unreadCount(req.user.id);
  }

  /** 标记已读：POST /me/notifications/:id/read */
  @Post('me/notifications/:id/read')
  markRead(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.center.markRead(req.user.id, id);
  }

  /** 催缴学费：POST /admin/orders/:id/remind（ADMIN） */
  @Roles(UserRole.ADMIN)
  @Post('admin/orders/:id/remind')
  remind(@Param('id') id: string) {
    return this.center.remindOrder(id);
  }
}
