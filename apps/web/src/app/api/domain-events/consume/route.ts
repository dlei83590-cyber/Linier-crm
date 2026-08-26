import type { NextRequest } from 'next/server';
import { authenticate, requirePermission } from '@/lib/api-helpers';
import { ok, fail } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { runDomainEventConsumer } from '@/lib/domain-events/consumer';
import { runDingTalkSender } from '@/lib/dingtalk/sender';

export const dynamic = 'force-dynamic';

/**
 * POST /api/domain-events/consume — 通用 Domain Event Consumer 触发端点（CTO 建议：事件总线落地）
 *
 * 消费 OutboxMessage 中 PENDING 的通用领域事件（5C-1/5C-2 会计事件等）：claim → PROCESSING → PROCESSED；
 * 失败指数退避重试，超限 DEAD_LETTER。当前阶段事件经 Outbox 可靠持久化（业务事务原子）即视为交付，
 * 真实业务消费者（GL/Notification）在后续阶段注册 handler。
 * Migration 0055（合同收口）：同端点顺带触发 DingTalk Sender（CRM_CHECK_IN / ORDER_STAGE_CHANGED →
 * claim → POST 钉钉 → SENT/FAILED 可重试/DEAD_LETTER）——复用同一 Outbox dispatch 机制，无持续 worker，供 cron/手动触发。
 * 权限：domain-event:consume（系统级受限权限，见 SYSTEM_PERMISSIONS）。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'domain-event:consume');
  if (denied) return denied;
  requestLog(request, user?.id, 'domain-event.consume');

  try {
    const [results, dingtalk] = await Promise.all([runDomainEventConsumer(), runDingTalkSender()]);
    return ok({ consumed: results.length, results, dingtalk });
  } catch (err) {
    console.error('[domain-event.consume]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, 'Domain Event Consumer 执行失败', 500);
  }
}