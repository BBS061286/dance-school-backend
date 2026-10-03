import { ConnectionOptions } from 'bullmq';

/**
 * BullMQ 连接配置：统一从 process.env.REDIS_URL 读取（D3 任务要求）。
 * maxRetriesPerRequest: null 是 Worker 阻塞连接的要求。
 *
 * 注意：bullmq v6 把 ioredis 列为 peerDependency（运行时懒加载），
 * 本仓库尚未安装 ioredis——运行 worker 前需 `npm install ioredis`。
 */
export function redisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL;
  if (!url) {
    // eslint-disable-next-line no-console
    console.warn(
      '[reminders] REDIS_URL 未设置，回退到 redis://127.0.0.1:6379',
    );
  }
  return {
    url: url ?? 'redis://127.0.0.1:6379',
    maxRetriesPerRequest: null,
  };
}
