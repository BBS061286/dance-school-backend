# 后端骨架 — 实施计划（草稿，待 Bin 确认）

依据：~/workspace/dance-school/design-doc-v2.md（§二 数据模型、§四 API、§五 提醒任务；v2 为权威版本，含 R1–R8 与 v2.1 F1–F5）

## v0.2 对齐（2026-10-01）
- `prisma/schema.prisma` 已按 v2 文档重写为 v0.2：34 models / 35 enums。
- 主要改动：Course.termWeeks → totalSessions；ClassSession.capacity 可空 + enrolledCount 计数器；
  Enrollment 新增候补/支付超时四字段 + `@@unique([classSessionId, waitlistPosition])`，删除 orderId；
  新增 RefundRecord、EventRegistrationOrder，删除 EventRegistration.orderId；
  OrderStatus 新增 PARTIALLY_PAID/PARTIALLY_REFUNDED，stripe 幂等字段加唯一约束；
  ReminderTargetType.CLASS_SESSION → SESSION_OCCURRENCE；SessionOccurrence/Event 新增 timeRange/timezone；
  CheckInMethod 新增 INSTRUCTOR；Notification 新增 WAITLIST_PROMOTED / ENROLLMENT / SESSION_OCCURRENCE；
  删除 User.age（年龄唯一来源为 Student.dob）。
- 保持草稿值（开放问题，待 Bin 确认）：Gender=MALE/FEMALE/OTHER；Payment.paidAt 必填 @default(now())；
  Enrollment 未加 @@unique([classSessionId, studentId])。
- D1 其余交付物（NestJS 骨架、JWT 认证、健康检查、种子数据、第三方 stub）已完成，见 backend/README.md。

## 为什么后端优先
1. 设计文档本身以数据模型 + API 为核心，后端骨架是把文档变成可执行代码的最短路径。
2. 文档"后续步骤"中原型标记为进行中（🔄）、后端未勾选（⬜），后端是明确的下一个开放项。
3. 最复杂的业务逻辑都在后端：报名状态机、候补转正、提醒去重、课次生成、补课资格、多时段加课审批、文件版本重签。

## 交付物 D1（首轮，预计一次开工完成）
- NestJS 项目骨架（`src/` 模块化结构：auth / users / courses / enrollments / orders / notifications…）
- `prisma/schema.prisma`（已备好草稿：32 models / 34 enums，待 `prisma validate`）
- JWT 认证：ADMIN / INSTRUCTOR / PARENT / ADULT_STUDENT 四角色 + 守卫
- 健康检查端点 + 全局异常/日志中间件
- 种子数据脚本：Burlington 校区 +《中国古典舞身韵》示例课程 + 1 个班级档期

## 后续交付
- D2：报名/订单/Stripe Checkout + webhook（§4.6/4.9）
- D3：BullMQ 提醒 worker（§五：ReminderRule → ReminderLog 去重 → Twilio/SendGrid/FCM）
- D4：打卡/补课/加课多时段审批（§6.1–6.11, 6.18）
- D5：评价/私信/文件签署/统一通知（§6.13–6.28）

## 待确认
- Postgres 在哪里跑（本地 Docker / 云 RDS / Neon 等）
- Stripe/Twilio/SendGrid/FCM 先接沙盒 key 还是只留对接骨架（interface + stub）
- 是否要 monorepo（前后端同仓）还是后端独立仓

## 校验记录（2026-09-29）
- `prisma/schema.prisma`（843 行 / 32 models / 34 enums）已通过离线静态校验：全部字段类型引用存在、
  全部关系双向完整、@relation fields/references 与 @@unique/@@index 引用字段均存在、@default 枚举值合法。
- 官方 `prisma validate` / `prisma format` 在本沙箱跑不了：binaries.prisma.sh 被网络阻断（engine 二进制已有缓存，
  但 CLI 仍需联网取 checksum/压缩包）。开工后在可联网环境（本地或 CI）跑一次 `prisma validate` 即可。
- 与设计文档核对无误：NotificationType 9 个取值（§6.28）、ReminderLog @@unique([ruleId,targetId,recipientId])（§2.15）、
  Gender=MALE/FEMALE/OTHER 为草稿自定（文档未定义，待 Bin 确认）、preferredCampusIds 用 String[] 存 UUID 数组
  （Prisma 无原生 UUID[]，schema 内有注释说明）。
- 2026-09-29 晚独立复核：用 Prisma 官方校验引擎（prisma-fmt WASM `validate`，与 `prisma validate` CLI 同一解析器；
  CLI 本体因沙箱联网限制仍无法下载 engine 二进制）跑完，全 schema 仅 1 条诊断：P1012 `datasource.url`——这是 Prisma 7+
  的新限制（连接串改放 prisma.config.ts）；项目目标为 Prisma 6，`url = env("DATABASE_URL")` 为标准合法写法，予以保留，
  不视为错误。结论：schema 草稿在目标版本下校验通过，开工后在可联网环境补跑一次 CLI 版 `prisma validate` 做最终确认即可。
