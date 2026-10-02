# 舞蹈学校管理系统 — 后端（D1 骨架）

Node.js + NestJS + PostgreSQL + Prisma。需求文档见 `../design-doc-v2.md`（v2，权威版本）。

## 环境要求

- Node.js ≥ 20（已验证 v24.20.0）
- PostgreSQL（本地或云端均可；**本机没有自带数据库**）
- Prisma 固定 6.x（`prisma` 与 `@prisma/client` 均为 6.19.3），**不要升级到 latest**（v7+ 的 CLI 已重写，`validate`/`generate` 不再存在）

## 从零跑起来

```bash
cd backend
cp .env.example .env
# 把 .env 里的 DATABASE_URL 换成你的 Postgres 连接串
# 推荐免费 tier：Neon（https://neon.tech）或 Supabase（https://supabase.com）

npm install
npx prisma migrate dev --name init   # 建表
npm run seed                          # 写入种子数据
npm run start:dev                     # 启动，http://localhost:3000/api/v1
```

冒烟测试：

```bash
curl http://localhost:3000/api/v1/health
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@danceschool.local","password":"Admin1234!"}'
```

## 测试账号（仅开发用）

| 角色 | 邮箱 | 密码 |
|---|---|---|
| 管理员 | admin@danceschool.local | Admin1234! |
| 教师 | teacher@danceschool.local | Teacher1234! |
| 家长 | parent@danceschool.local | Parent1234! |

种子数据还包含：Burlington 校区、课程《中国古典舞身韵》（GROUP/YOUTH，minAge 11，每周四 17:00–18:00，TERM 共 12 节，$400）、1 个班级档期 + 12 个课次。

## D1 交付物

- `prisma/schema.prisma` v0.2：按 v2 文档重写的 34 个 model / 35 个 enum，已通过校验
- `src/`：NestJS 脚手架
  - `main.ts`：全局前缀 `api/v1`、ValidationPipe、全局异常过滤器、请求日志拦截器
  - `prisma/`：全局 PrismaModule + PrismaService
  - `auth/`：`POST /auth/register`（家长/成人学员自助注册）、`POST /auth/login`、`POST /auth/refresh`、`POST /auth/forgot-password`（stub）；JwtStrategy；`@Roles` 装饰器 + RolesGuard（ADMIN/INSTRUCTOR/PARENT/ADULT_STUDENT）
  - `health/`：`GET /health`
  - `users/`：`GET /me`（成人学员的 age 由 Student.dob 派生）
  - `integrations/`：Stripe / Twilio / SendGrid / FCM 的 interface + stub（只打日志，不接真实 key）
- `prisma/seed.ts`：种子数据脚本（`npm run seed`）

## 备注

- `npx prisma generate` 在本机因网络限制下不到引擎二进制；已用 `--no-engine` 生成类型，`npm run build` 可通过。拿到数据库后如需完整 client（含引擎），在网络正常环境重跑一次 `npx prisma generate` 即可。
- 第三方服务（Stripe/Twilio/SendGrid/FCM）D1 全部为 stub，D2 起按需替换真实实现。
