import { Controller, Get, Request } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** 当前用户信息（设计文档 §4.3） */
  @Get('me')
  me(@Request() req: { user: { id: string } }) {
    return this.usersService.getMe(req.user.id);
  }
}
