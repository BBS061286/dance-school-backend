import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/** Stripe webhook 模块。调用 BillingService 落流水，幂等逻辑见 WebhooksService。 */
@Module({
  imports: [BillingModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
