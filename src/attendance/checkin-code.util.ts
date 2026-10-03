import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 签到二维码码值（纯函数，不存 DB）。
 * 格式：base64url(JSON({ o: occurrenceId, e: expUnix })) + '.' + HMAC-SHA256_hex。
 * secret 取 process.env.JWT_SECRET，有效期 15 分钟。
 */

const CODE_TTL_SECONDS = 15 * 60;

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET 未配置，无法签发签到码');
  return s;
}

/** 生成签到码 */
export function signCheckInCode(occurrenceId: string): string {
  const payload = {
    o: occurrenceId,
    e: Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

/**
 * 验签并返回 occurrenceId。
 * 格式非法 / 签名无效 / 已过期时抛 Error（中文 message，调用方转 400）。
 */
export function verifyCheckInCode(code: string): string {
  const parts = code.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('签到码格式非法');
  }
  const [b64, sig] = parts;
  const expected = createHmac('sha256', secret()).update(b64).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('签到码签名无效');
  }
  let payload: { o?: unknown; e?: unknown };
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  } catch {
    throw new Error('签到码格式非法');
  }
  if (typeof payload.o !== 'string' || !payload.o || typeof payload.e !== 'number') {
    throw new Error('签到码格式非法');
  }
  if (payload.e < Math.floor(Date.now() / 1000)) {
    throw new Error('签到码已过期，请让老师重新生成');
  }
  return payload.o;
}
