-- 053: 删掉 MessageThread 上残留的 participantId 单列唯一索引
-- 背景：048 想用 DROP CONSTRAINT 删掉旧唯一约束，但它实际是个 UNIQUE INDEX（非 constraint），
-- 所以没删掉；导致同一用户无法拥有多条会话（与管理员一条、与每位老师各一条），新建第二条会话会报唯一冲突。
-- 真正的唯一性由 048 的表达式索引 MessageThread_participant_peer_unique 保证，本迁移只删旧索引。
-- 幂等：IF EXISTS。
DROP INDEX IF EXISTS "MessageThread_participantId_key";
