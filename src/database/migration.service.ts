import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 开机自动迁移：一劳永逸，schema 变更无需手动跑 SQL。
 * - SQL 文件放在 prisma/manual-migrations/*.sql（按文件名排序执行）
 * - 执行记录记在 schema_migrations 表，已执行的跳过
 * - SQL 必须幂等（IF NOT EXISTS），防止手动跑过后重复执行报错
 */
@Injectable()
export class MigrationService implements OnModuleInit {
  private readonly logger = new Logger(MigrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.runPendingMigrations();
    } catch (e) {
      // 迁移失败不阻塞启动（打日志，靠健康检查/人工发现）
      // 注意：表结构缺失会导致后续请求报错，日志里会很明显
      this.logger.error(`自动迁移失败: ${(e as Error).message}`);
    }
  }

  private async runPendingMigrations() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "schema_migrations" (
        "name" TEXT PRIMARY KEY,
        "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = await this.prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'SELECT "name" FROM "schema_migrations"',
    );
    const appliedSet = new Set(applied.map((r) => r.name));

    const dir = path.join(process.cwd(), 'prisma', 'manual-migrations');
    if (!fs.existsSync(dir)) {
      this.logger.log('无 manual-migrations 目录，跳过自动迁移');
      return;
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (appliedSet.has(file)) continue;
      this.logger.log(`正在执行迁移: ${file}`);
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      // 拆成单条执行（Postgres 不允许一条 query 里多条 DDL 混事务时出问题）
      const statements = sql
        .split(/;\s*\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        await this.prisma.$executeRawUnsafe(stmt);
      }
      await this.prisma.$executeRawUnsafe(
        'INSERT INTO "schema_migrations" ("name") VALUES ($1) ON CONFLICT DO NOTHING',
        file,
      );
      this.logger.log(`迁移完成: ${file}`);
    }
  }
}
