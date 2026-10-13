import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReportsService } from './reports.service';

/**
 * 经营报表路由：全局前缀 /api/v1 已在 main.ts 设置。
 * 全部只读，仅管理员可访问。
 */
@Controller()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /** 经营报表汇总：GET /admin/reports/summary */
  @Get('admin/reports/summary')
  @Roles('ADMIN')
  summary() {
    return this.reportsService.summary();
  }
}
