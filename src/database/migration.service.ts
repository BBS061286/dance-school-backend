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
      const statements = this.splitStatements(sql);
      for (const stmt of statements) {
        try {
          await this.prisma.$executeRawUnsafe(stmt);
        } catch (e) {
          const msg = (e as Error).message ?? '';
          // 幂等：对象已存在则跳过（兼容手动跑过的情况）
          if (
            msg.includes('already exists') ||
            msg.includes('duplicate key') ||
            msg.includes('DuplicateObject')
          ) {
            this.logger.warn(`跳过已存在: ${stmt.slice(0, 60)}...`);
            continue;
          }
          throw e;
        }
      }
      await this.prisma.$executeRawUnsafe(
        'INSERT INTO "schema_migrations" ("name") VALUES ($1) ON CONFLICT DO NOTHING',
        file,
      );
      this.logger.log(`迁移完成: ${file}`);
    }
  }

  /**
   * 按语句切分 SQL，能正确处理 DO $$ ... $$ 块内的分号。
   */
  private splitStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inDollar = false;
    // 去掉注释行，简化处理
    const lines = sql.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!inDollar && (trimmed.startsWith('--') || trimmed === '')) {
        continue;
      }
      // 检测 $$ 开关（简化：只处理 $$，不处理 $tag$）
      const dollarCount = (line.match(/\$\$/g) || []).length;
      if (dollarCount % 2 === 1) {
        inDollar = !inDollar;
      }
      current += line + '\n';
      if (!inDollar && trimmed.endsWith(';')) {
        statements.push(current.trim());
        current = '';
      }
    }
    if (current.trim()) statements.push(current.trim());
    return statements.filter((s) => s.length > 0);
  }
}
