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

## D2 交付物（报名 / 订单 / 支付 / Stripe webhook）

> 以下端点按 v2 设计文档 §2.15–2.16 / §4.9（报名与支付）实现，路由均挂在 `/api/v1` 全局前缀下。

### 新增端点表

**报名（enrollments）**

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | `/enrollments` | 家长 / 成人学员 | 报名（自动判断是否需付费、是否进候补） |
| GET | `/me/enrollments` | 家长 / 成人学员 | 我孩子的所有报名（候补中返回 waitlist_position） |
| PATCH | `/enrollments/:id/cancel` | 家长 / 成人学员 | 取消报名（释放名额→触发候补转正→触发退费流程判断） |
| POST | `/admin/enrollments/:id/confirm` | 管理员 | 手动确认报名（特殊情况人工覆盖） |
| GET | `/admin/enrollments/:id/refund-preview` | 管理员 | 退款试算（TERM 按 2.16 公式，其他按已付额） |
| POST | `/admin/enrollments/:id/refund` | 管理员 | 发起退款（生成 RefundRecord；Stripe 订单同步调 Stripe Refund API） |
| POST | `/admin/enrollments/:id/promote` | 管理员 | 手动转正指定候补者（可越过队列顺序） |
| POST | `/admin/sessions/:id/run-waitlist-promotion` | 管理员 | 手动触发某班级档期的候补转正检查 |

**订单与支付（orders / payments）**

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | `/orders` | 家长 / 成人学员 | 基于一个或多个 enrollment 创建订单 |
| POST | `/orders/:id/create-checkout-session` | 家长 / 成人学员 | 返回 Stripe Checkout URL（D2 为 stub，见下） |
| POST | `/orders/:id/payments` | 家长 / 成人学员 | 自助提交非即时收款（Zelle/PayPal/现金/支票）→ `PENDING_CONFIRM` |
| GET | `/me/orders` | 家长 / 成人学员 | 我的订单列表 |
| GET | `/admin/orders?status=&campus=` | 管理员 | 订单列表（按状态/校区筛选） |
| POST | `/admin/orders/:id/payments` | 管理员 | 登记线下收款（直接 `SUCCEEDED`，recorded_by=当前管理员） |
| POST | `/admin/payments/:id/confirm` | 管理员 | 核实学员自助提交的收款：`PENDING_CONFIRM → SUCCEEDED` |
| POST | `/admin/payments/:id/reject` | 管理员 | 核实未到账：`PENDING_CONFIRM → FAILED` |

**Stripe webhook（webhooks）**

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| POST | `/webhooks/stripe` | 公开（@Public，无 JWT） | 处理 `payment_intent.succeeded / payment_intent.payment_failed / charge.refunded` |

### Stripe stub 说明

- payments provider 仍是 stub（D1 的 integrations/stripe 未替换真实 key）：`POST /orders/:id/create-checkout-session` 返回假 URL（形如 `https://stub-checkout.local/s/cs_stub_xxx`），只打日志、不调真实 Stripe API。
- webhook 接收 stub 事件：`POST /api/v1/webhooks/stripe`，`@Public()` 无需 JWT；stub 模式只做事件结构校验（`type` 为 string 且 `data.object.id` 为 string），**不支持真实 HMAC 签名校验**——若设置了 `STRIPE_WEBHOOK_SECRET` 会直接 400（真实签名需要 raw body，超出 D2 stub 范围）。
- 所有分支（重复回调、未知订单、未知事件）都返回 200 `{ received: true }`，只有结构非法才 400。

`payment_intent.succeeded` 示例：

```json
{
  "id": "evt_stub_1",
  "type": "payment_intent.succeeded",
  "data": {
    "object": {
      "id": "pi_stub_123",
      "amount_received": 40000,
      "charges": { "data": [{ "id": "ch_stub_123", "amount": 40000 }] }
    }
  }
}
```

`charge.refunded` 示例：

```json
{
  "id": "evt_stub_2",
  "type": "charge.refunded",
  "data": {
    "object": {
      "id": "ch_stub_123",
      "refunds": { "data": [{ "id": "re_stub_123", "amount": 40000 }] }
    }
  }
}
```

### 实现说明

- **并发超卖防护（方案 B）**：用 `ClassSession.enrolledCount` 原子计数器，同一事务内完成名额判断 + enrollment 插入 + 计数器递增，避免超卖。
- **webhook 幂等（v2 R8c）**：靠 `Order.stripe_payment_intent_id` / `Payment.stripe_charge_id` / `RefundRecord.stripe_refund_id` 唯一约束去重；重复回调命中 P2002 直接 200，不抛错。
- **Order 状态只由流水派生**：任何接口都不直接写 Order.status；支付成功落 Payment 流水、退款落 RefundRecord 流水后统一调用 `deriveOrder` 重算。
- **候补转正的 position 调整**：转正后其余候补者 position 前移，用"两步 negate 法"（先全部取负再 +1）避开部分唯一索引的逐行检查冲突。
- 候补转正的 `WAITLIST_PROMOTED` 通知待 D4（6.28 通知模型）再接，D2 只完成转正逻辑。

### 开放问题重申（按 v2 文档原样，等 Bin 确认）

- `Payment.paidAt` 保持必填。
- `Enrollment` 不加 `(classSessionId, studentId)` 唯一约束，防重由代码层保证。
- `Gender` 保持 `MALE / FEMALE / OTHER` 三值。
