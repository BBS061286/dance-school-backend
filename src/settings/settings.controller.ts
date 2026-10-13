import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { LocalFileInterceptor } from '../common/local-upload';
import { SettingsService } from './settings.service';

@Controller()
export class SettingsController {
  constructor(private settings: SettingsService) {}

  /** 管理员查看收款二维码 */
  @Get('admin/settings/payment-qr')
  @Roles('ADMIN')
  getPaymentQrAdmin() {
    return this.settings.getPaymentQr();
  }

  /** 管理员上传收款二维码（type=zelle|paypal） */
  @Post('admin/settings/payment-qr/:type')
  @Roles('ADMIN')
  @UseInterceptors(LocalFileInterceptor('file'))
  uploadPaymentQr(
    @Param('type') type: string,
    @UploadedFile() file: { filename: string },
  ) {
    if (type !== 'zelle' && type !== 'paypal') {
      throw new Error('type 必须是 zelle 或 paypal');
    }
    const url = `uploads/${file.filename}`;
    return this.settings.setPaymentQrUrl(type, url);
  }

  /** 管理员删除收款二维码 */
  @Delete('admin/settings/payment-qr/:type')
  @Roles('ADMIN')
  clearPaymentQr(@Param('type') type: string) {
    if (type !== 'zelle' && type !== 'paypal') {
      throw new Error('type 必须是 zelle 或 paypal');
    }
    return this.settings.clearPaymentQr(type);
  }

  /** 家长/学员端获取收款二维码（需登录） */
  @Get('settings/payment-qr')
  getPaymentQr() {
    return this.settings.getPaymentQr();
  }
}
