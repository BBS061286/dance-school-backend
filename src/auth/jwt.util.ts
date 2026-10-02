import { ConfigService } from '@nestjs/config';

/**
 * jsonwebtoken / ms 能解析的过期时间写法。
 * 类型层面收窄为模板字面量（运行时原样透传，jsonwebtoken 自行解析）。
 */
export type JwtExpiresIn =
  | `${number}`
  | `${number}${'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'}`;

export function jwtExpiresIn(
  raw: string | undefined,
  fallback: JwtExpiresIn,
): JwtExpiresIn {
  return (raw || fallback) as JwtExpiresIn;
}

export function requireJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret) throw new Error('缺少 JWT_SECRET 环境变量');
  return secret;
}
