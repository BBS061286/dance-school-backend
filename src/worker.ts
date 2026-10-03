import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * 独立 worker 入口：用 NestFactory.createApplicationContext 建上下文，
 * 由 WorkerSchedulerService 注册三个定时任务并消费队列。
 * 运行：node dist/worker.js（需 REDIS_URL；运行时需安装 bullmq 的 peer 依赖 ioredis）
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  // eslint-disable-next-line no-console
  console.log('[worker] started: dance-tasks + reminder-send');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] 启动失败', err);
  process.exit(1);
});
