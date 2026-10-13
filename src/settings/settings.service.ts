import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getPaymentQr(): Promise<{ zelleQrUrl: string | null; paypalQrUrl: string | null }> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: ['zelle_qr_url', 'paypal_qr_url'] } },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      zelleQrUrl: map['zelle_qr_url'] ?? null,
      paypalQrUrl: map['paypal_qr_url'] ?? null,
    };
  }

  async setPaymentQrUrl(type: 'zelle' | 'paypal', url: string) {
    const key = type === 'zelle' ? 'zelle_qr_url' : 'paypal_qr_url';
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value: url },
      create: { key, value: url },
    });
    return { key, url };
  }

  async clearPaymentQr(type: 'zelle' | 'paypal') {
    const key = type === 'zelle' ? 'zelle_qr_url' : 'paypal_qr_url';
    await this.prisma.systemSetting.deleteMany({ where: { key } });
    return { key, cleared: true };
  }
}
