-- 043: 活动/比赛模块演示数据（幂等，ON CONFLICT DO NOTHING）
-- 比赛：FJW 杯少儿舞蹈邀请赛（SPLIT 均摊，$150/组，3人/组）
--   - 已成组：小天鹅组（赵子涵/钱多多/孙浩然，每人 $50）
--   - 未分组：李梦瑶、周子墨（每人全额 $150），可勾选后"合并为一组"演示
-- 活动：2026 圣诞舞蹈晚会（早鸟票 $15 / 正价票 $25）
--   - 吴悠悠：早鸟 x2 = $30（已付）；郑凯文：正价 x1 = $25（待付）；王梓萱：正价 x3 = $75（已付）
--   - 看板：已售 6 张 / 3 人 / 应收 $130 / 实收 $105

DO $$
DECLARE
  v_campus_id TEXT;
  v_parent_id TEXT;
BEGIN
  -- 校区：优先 Burlington（含 Lexington/Burlington 改名），兜底任一在用校区
  SELECT id INTO v_campus_id FROM "Campus" WHERE name = 'Burlington' AND "isActive" LIMIT 1;
  IF v_campus_id IS NULL THEN
    SELECT id INTO v_campus_id FROM "Campus" WHERE name LIKE '%Burlington%' AND "isActive" LIMIT 1;
  END IF;
  IF v_campus_id IS NULL THEN
    SELECT id INTO v_campus_id FROM "Campus" WHERE "isActive" ORDER BY "createdAt" LIMIT 1;
  END IF;
  -- 演示家长：王家长（parent@danceschool.local）
  SELECT id INTO v_parent_id FROM "User" WHERE email = 'parent@danceschool.local' LIMIT 1;

  IF v_campus_id IS NULL OR v_parent_id IS NULL THEN
    RAISE NOTICE '043 跳过：校区或演示家长不存在';
    RETURN;
  END IF;

  -- ============ 1. 比赛 ============
  INSERT INTO "Event" (id, title, description, "campusId", timezone, location, "startTime", "endTime",
    "requiresRegistration", capacity, status, category, "requiresTicket",
    "participationFeeCents", "feeMode", "groupSize", "createdAt", "updatedAt")
  VALUES ('demo043-competition', 'FJW 杯少儿舞蹈邀请赛',
    'FJW Dance Studio 首届少儿舞蹈邀请赛，分组赛制（3 人/组），报名费按组均摊',
    v_campus_id, 'America/New_York', 'Burlington 校区 主剧场',
    TIMESTAMPTZ '2026-11-14 23:00:00+00', TIMESTAMPTZ '2026-11-15 02:00:00+00',
    true, 30, 'SCHEDULED', 'COMPETITION', false,
    15000, 'SPLIT', 3, NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "EventRegistration" (id, "eventId", "studentId", "parentId", status,
    "participationFeeCents", "groupKey", "groupName", "feeStatus", "createdAt", "updatedAt")
  VALUES
    -- 已成组：小天鹅组（3 人，均摊 $150 → 每人 $50）
    ('demo043-reg-c1', 'demo043-competition', 'demo023-student-01', v_parent_id, 'REGISTERED',
      5000, 'demo043-group-swan', '小天鹅组', 'NOT_SET', NOW(), NOW()),
    ('demo043-reg-c2', 'demo043-competition', 'demo023-student-02', v_parent_id, 'REGISTERED',
      5000, 'demo043-group-swan', '小天鹅组', 'NOT_SET', NOW(), NOW()),
    ('demo043-reg-c3', 'demo043-competition', 'demo023-student-03', v_parent_id, 'REGISTERED',
      5000, 'demo043-group-swan', '小天鹅组', 'NOT_SET', NOW(), NOW()),
    -- 未分组：单独报名（每人全额 $150），可勾选后"合并为一组"
    ('demo043-reg-c4', 'demo043-competition', 'demo023-student-04', v_parent_id, 'REGISTERED',
      15000, 'demo043-group-solo-1', NULL, 'NOT_SET', NOW(), NOW()),
    ('demo043-reg-c5', 'demo043-competition', 'demo023-student-05', v_parent_id, 'REGISTERED',
      15000, 'demo043-group-solo-2', NULL, 'NOT_SET', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ============ 2. 活动（多票种） ============
  INSERT INTO "Event" (id, title, description, "campusId", timezone, location, "startTime", "endTime",
    "requiresRegistration", capacity, status, category, "requiresTicket",
    "ticketPriceCents", "maxTicketsPerRegistration", "ticketTiers", "createdAt", "updatedAt")
  VALUES ('demo043-christmas', '2026 圣诞舞蹈晚会',
    'FJW Dance Studio 圣诞舞蹈晚会，各班级节目展演，欢迎家长购票观看',
    v_campus_id, 'America/New_York', 'Burlington 校区 主剧场',
    TIMESTAMPTZ '2026-12-20 23:00:00+00', TIMESTAMPTZ '2026-12-21 02:00:00+00',
    true, 100, 'SCHEDULED', 'EVENT', true,
    2500, 6,
    '[{"name":"早鸟票","price_cents":1500,"valid_until":"2026-11-30T23:59:59-05:00"},{"name":"正价票","price_cents":2500}]'::jsonb,
    NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "EventRegistration" (id, "eventId", "studentId", "parentId", status,
    "ticketQuantity", "ticketTotalCents", "ticketTierBreakdown", "feeStatus", "createdAt", "updatedAt")
  VALUES
    ('demo043-reg-x1', 'demo043-christmas', 'demo023-student-06', v_parent_id, 'REGISTERED',
      2, 3000, '{"早鸟票":{"quantity":2,"totalCents":3000}}'::jsonb, 'NOT_SET', NOW(), NOW()),
    ('demo043-reg-x2', 'demo043-christmas', 'demo023-student-07', v_parent_id, 'REGISTERED',
      1, 2500, '{"正价票":{"quantity":1,"totalCents":2500}}'::jsonb, 'NOT_SET', NOW(), NOW()),
    ('demo043-reg-x3', 'demo043-christmas', 'demo023-student-08', v_parent_id, 'REGISTERED',
      3, 7500, '{"正价票":{"quantity":3,"totalCents":7500}}'::jsonb, 'NOT_SET', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- 门票订单（2 已付 + 1 待付）
  INSERT INTO "Order" (id, "parentId", "amountCents", "originalAmountCents", currency, status,
    "paymentMethod", "createdAt", "paidAt")
  VALUES
    ('demo043-order-x1', v_parent_id, 3000, 3000, 'usd', 'PAID', 'STRIPE', NOW(), NOW()),
    ('demo043-order-x2', v_parent_id, 2500, 2500, 'usd', 'PENDING', 'STRIPE', NOW(), NULL),
    ('demo043-order-x3', v_parent_id, 7500, 7500, 'usd', 'PAID', 'STRIPE', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "OrderItem" (id, "orderId", "eventRegistrationId", description, "amountCents")
  VALUES
    ('demo043-oi-x1', 'demo043-order-x1', 'demo043-reg-x1', '圣诞舞蹈晚会门票（早鸟票）x2 · 吴悠悠', 3000),
    ('demo043-oi-x2', 'demo043-order-x2', 'demo043-reg-x2', '圣诞舞蹈晚会门票（正价票）x1 · 郑凯文', 2500),
    ('demo043-oi-x3', 'demo043-order-x3', 'demo043-reg-x3', '圣诞舞蹈晚会门票（正价票）x3 · 王梓萱', 7500)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "EventRegistrationOrder" ("eventRegistrationId", "orderId", "itemType")
  VALUES
    ('demo043-reg-x1', 'demo043-order-x1', 'TICKET'),
    ('demo043-reg-x2', 'demo043-order-x2', 'TICKET'),
    ('demo043-reg-x3', 'demo043-order-x3', 'TICKET')
  ON CONFLICT DO NOTHING;

  INSERT INTO "Payment" (id, "orderId", "amountCents", method, status, "paidAt")
  VALUES
    ('demo043-pay-x1', 'demo043-order-x1', 3000, 'STRIPE', 'SUCCEEDED', NOW()),
    ('demo043-pay-x3', 'demo043-order-x3', 7500, 'STRIPE', 'SUCCEEDED', NOW())
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE '043 活动/比赛演示数据就绪';
END $$;
