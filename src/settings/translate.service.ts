import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 翻译服务：中文 -> 英文。
 * 有 GOOGLE_TRANSLATE_API_KEY 时调用 Google Translate API，
 * 无 key 时回退返回原文（前端提示用户手动填写）。
 */
@Injectable()
export class TranslateService {
  private readonly logger = new Logger(TranslateService.name);
  private readonly apiKey: string | undefined;

  constructor(private config: ConfigService) {
    this.apiKey = config.get<string>('GOOGLE_TRANSLATE_API_KEY');
    if (!this.apiKey) {
      this.logger.warn('[Translate] 缺少 GOOGLE_TRANSLATE_API_KEY，翻译接口将回退返回原文');
    }
  }

  async zhToEn(text: string): Promise<{ translated: string; auto: boolean }> {
    if (!text?.trim()) return { translated: '', auto: false };
    if (!this.apiKey) return { translated: text, auto: false };
    try {
      const res = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: text, source: 'zh', target: 'en', format: 'text' }),
        },
      );
      const data = (await res.json()) as any;
      const translated = data?.data?.translations?.[0]?.translatedText;
      if (!translated) throw new Error('翻译 API 返回异常');
      return { translated, auto: true };
    } catch (e) {
      this.logger.warn(`[Translate] 翻译失败，回退原文: ${(e as Error).message}`);
      return { translated: text, auto: false };
    }
  }
}
