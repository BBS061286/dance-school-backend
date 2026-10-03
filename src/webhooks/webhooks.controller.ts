import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';

/** Stripe webhook 入口。无需 JWT（@Public），由 Stripe 服务端调用。 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Public()
  @Post('stripe')
  async stripe(@Body() body: any, @Headers('stripe-signature') sig?: string) {
    await this.webhooks.handleEvent(body, sig);
    return { received: true };
  }
}
