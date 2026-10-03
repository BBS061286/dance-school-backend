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

## D3 交付物（提醒 worker）

### 新增端点表（管理端，ADMIN）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/admin/reminder-rules` | 提醒规则列表 |
| POST | `/api/v1/admin/reminder-rules` | 新建规则（targetType/session 或 event、offsetHoursBefore、channels、templateKey） |
| PATCH | `/api/v1/admin/reminder-rules/:id` | 修改规则（含启用/停用） |
| GET | `/api/v1/admin/reminder-logs?target_id=` | 发送记录查询 |

### Worker（BullMQ + Redis）

独立入口 `src/worker.ts`，三个定时任务（§五）：

| 任务 | 频率 | 说明 |
|---|---|---|
| `reminder-scan` | 每 5 分钟 | 扫描未来窗口内 SCHEDULED 的课次/活动，按 ReminderRule.offsetHoursBefore 判断触发窗口；收件人=已确认学员的主要联系人家長（含补课学员、排除请假）；ReminderLog 唯一约束去重；按 channels 经 stub（Twilio/SendGrid/FCM）分发，失败指数退避最多 3 次；结果写回 ReminderLog.status；同时写 CLASS_REMINDER/EVENT_REMINDER 通知 |
| `payment-timeout-scan` | 每 10 分钟 | PENDING_PAYMENT 且 paymentExpiresAt 过期（有 PENDING_CONFIRM 流水的豁免）；未转正过→取消+释放+自动转正；转正过的→回退候补 |
| `seat-reconcile` | 每天凌晨 3 点 | 重算各 ClassSession.enrolledCount（CONFIRMED+PENDING_PAYMENT），不一致则行锁修正并告警 |

时区：全部 UTC 存储，按 Campus.timezone / Event.timezone 用 luxon + IANA 库换算触发时刻，禁止固定偏移。

### 运行与部署

```bash
npm run worker        # 开发：ts-node src/worker.ts
npm run worker:prod   # 生产：node dist/worker.js（先 npm run build）
```

需要环境变量 `REDIS_URL`（worker 与 API 共用）。Railway 部署二选一：
1. **同一项目加第二个服务**：同一仓库再建一个服务，启动命令填 `npm run worker:prod`，共用 DATABASE_URL，另加 REDIS_URL（可用 Railway 的 Redis 插件）。
2. **独立 cron 服务**：把 worker 跑在任意能连 Redis/Postgres 的机器上，`npm run build && npm run worker:prod`。

注意：bullmq v6 运行时依赖 `ioredis`（peer dep），已加入 dependencies。

## D4 交付物（打卡 / 补课 / 加课 / 活动）

| 模块 | 端点 |
|---|---|
| 打卡 | `GET /courses/:id/sessions/:sessionId/occurrences`；`POST /occurrences/:id/check-in`（学员自助→待确认）；`POST /admin/occurrences/:id/check-in`（代打卡→已确认）；`POST /admin/attendance/:id/confirm`；`POST /me/instructor/checkins` + `GET /me/instructor/checkins`（教师打卡，INSTRUCTOR） |
| 课次管理 | `POST /admin/occurrences/:id/cancel-and-postpone`（取消并按 weekdays 顺延，通知学员+教师）；`POST /admin/occurrences/:id/cancel` |
| 补课 | `GET/POST /admin/class-sessions/:id/makeup-eligibility`；`GET /me/enrollments/:id/makeup-options`；`POST /makeup-bookings`（补课场次打卡后自动记 isMakeup 并完成预约） |
| 加课 | `POST /extra-lesson-requests`（学员发起）；`POST /admin/extra-lesson-requests`（管理员邀请，student_id 必填）；`GET /me/extra-lesson-requests`；`GET /admin/extra-lesson-requests`；时段审批 `POST /admin/extra-lesson-slots/:id/approve\|propose-alt\|reschedule\|cancel`；学员 `POST /extra-lesson-slots/:id/accept\|decline`；`GET /admin/extra-lesson-slots`；`POST /admin/extra-lesson-slots/:id/review` |
| 活动 | `POST /admin/events`；`GET /events/:id`（公开）；`POST /events/:id/register`（购票建 TICKET 订单）；`PATCH /event-registrations/:id/cancel`；`POST /admin/event-registrations/:id/issue-fee`；`POST /event-registrations/:id/pay`；`POST /admin/notices` + `GET /me/notices` |
| 用户 | `PATCH /me`（§6.10：name/dob 或 age/preferredCampusIds；age 反算 dob 写入 SELF 绑定 Student） |

实现说明：打卡用 `@@unique([sessionOccurrenceId,enrollmentId])` 防重，自助打卡后教师/管理员打卡转为已确认；私教课报名支付成功后自动生成 ExtraLessonRequest（initiatedBy=COURSE_PURCHASE）；加课状态变更按 §6.9 映射表发 EXTRA_LESSON_UPDATE 通知。

## D5 交付物（评价 / 私信 / 文件 / 通知 / 教师端）

| 模块 | 端点 |
|---|---|
| 通知中心 | `GET /me/notifications`；`GET /me/notifications/unread-count`；`POST /me/notifications/:id/read`；`POST /admin/orders/:id/remind`（催缴，PAYMENT_REMINDER） |
| 评价 | `POST /admin/courses/:id/reviews`；`GET /courses/:id/reviews`；`POST /admin/students/:id/reviews`；`GET /me/students/:id/reviews`；教师端同款 `POST /me/instructor/courses/:id/reviews`、`POST /me/instructor/students/:id/reviews` |
| 教师端 | `GET/PATCH /me/instructor/profile`；`GET /me/instructor/classes`；`GET /me/instructor/extra-lessons`；`POST /me/instructor/occurrences/:id/check-in`（点名，非自己班级 403）；`GET /me/instructor/occurrences/:id/attendance`；`GET /me/instructor/notifications` |
| 私信 | `POST/GET /me/messages`（与管理端唯一 thread）；`GET /admin/messages/threads`；`POST /admin/messages/threads/:id/reply`（发 MESSAGE_REPLY 通知） |
| 文件签署 | `POST /admin/documents`；`POST /admin/documents/:id/new-version`（重签发 DOCUMENT_SIGN_REQUEST）；`GET /admin/documents`；`GET /admin/documents/:id/signatures`；`GET /me/documents`；`POST /me/documents/:id/sign`；`GET /me/documents/:id/signature` |
| 学员/课程/教师管理 | `GET /admin/students`；`GET /admin/students/:id/detail`；`POST /admin/courses`（PRIVATE 强制 capacity=1）；`GET/PATCH /admin/instructors`；`POST /admin/course-sessions/:id/assign-instructor`（发 INSTRUCTOR_ASSIGNMENT 通知） |
| 上传 | `POST /me/students/:id/photo`；`POST /me/avatar`（multipart，本地 `./uploads` stub，生产需对象存储） |

通知接线：候补转正发 WAITLIST_PROMOTED（D2 预留已接上）；课程分配/私信回复/文件重签/评价发布/催缴各自触发对应类型。三个开放问题（Payment.paidAt 必填、无复合唯一约束、Gender 三值）保持 v2 原样未动。
