import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, JobScheduler, Worker } from 'bullmq';
import { PaymentTimeoutService } from './reminders/payment-timeout.service';
import { redisConnection } from './reminders/redis';
import { RemindersService } from './reminders/reminders.service';
import { SeatReconcileService } from './reminders/seat-reconcile.service';

/**
 * 独立 worker 进程的任务调度器（设计文档 §五）：
 * - 在 'dance-tasks' 队列上用 bullmq v6 JobScheduler API 注册三个定时任务
 *  （upsert + override，重复注册不会产生重复任务）；
 * - 启动 'dance-tasks' 的 Worker，按 job 名分发到各 service。
 */
@Injectable()
export class WorkerSchedulerService implements OnModuleInit, OnModuleDestroy {
  private scheduler: JobScheduler | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly remindersService: RemindersService,
    private readonly paymentTimeoutService: PaymentTimeoutService,
    private readonly seatReconcileService: SeatReconcileService,
  ) {}

  async onModuleInit() {
    this.scheduler = new JobScheduler('dance-tasks', {
      connection: redisConnection(),
    });

    await this.scheduler.upsertJobScheduler(
      'reminder-scan',
      { every: 5 * 60 * 1000 },
      'reminder-scan',
      {},
      {},
      { override: true },
    );
    await this.scheduler.upsertJobScheduler(
      'payment-timeout-scan',
      { every: 10 * 60 * 1000 },
      'payment-timeout-scan',
      {},
      {},
      { override: true },
    );
    await this.scheduler.upsertJobScheduler(
      'seat-reconcile',
      { pattern: '0 3 * * *' },
      'seat-reconcile',
      {},
      {},
      { override: true },
    );

    this.worker = new Worker('dance-tasks', (job) => this.dispatch(job), {
      connection: redisConnection(),
    });
    // eslint-disable-next-line no-console
    console.log('[worker] dance-tasks scheduler + worker started');
  }

  private async dispatch(job: Job): Promise<void> {
    switch (job.name) {
      case 'reminder-scan':
        await this.remindersService.scanReminders();
        return;
      case 'payment-timeout-scan':
        await this.paymentTimeoutService.scanPaymentTimeouts();
        return;
      case 'seat-reconcile':
        await this.seatReconcileService.reconcileSeats();
        return;
      default:
        // eslint-disable-next-line no-console
        console.warn(`[worker] 未知的 job 名：${job.name}`);
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.scheduler?.close();
  }
}
