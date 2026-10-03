import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { redisConnection } from './redis';
import { ReminderSendJobData, RemindersService } from './reminders.service';

/**
 * 'reminder-send' 队列的消费者：逐 channel 调用 stub provider 实际发送，
 * 成功时 RemindersService.sendReminder 置 SENT；重试耗尽后在此置 FAILED。
 */
@Injectable()
export class ReminderSendWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<ReminderSendJobData> | null = null;

  constructor(private readonly remindersService: RemindersService) {}

  async onModuleInit() {
    this.worker = new Worker<ReminderSendJobData>(
      'reminder-send',
      (job) => this.remindersService.sendReminder(job.data),
      { connection: redisConnection() },
    );
    this.worker.on('failed', (job, err) => {
      void this.handleFailed(job, err);
    });
    // eslint-disable-next-line no-console
    console.log('[reminder-send] worker started');
  }

  private async handleFailed(
    job: Job<ReminderSendJobData> | undefined,
    err: Error,
  ): Promise<void> {
    if (!job?.data?.logId) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      // eslint-disable-next-line no-console
      console.warn(
        `[reminder-send] job ${job.id} 最终失败（${attempts} 次）：${err.message}`,
      );
      await this.remindersService.markLogFailed(job.data.logId);
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
