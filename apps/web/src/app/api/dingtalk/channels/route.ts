import type { NextRequest } from 'next/server';
import { authenticate, requirePermission } from '@/lib/api-helpers';
import { ok } from '@/lib/api/response';
import { requestLog } from '@/lib/api/logger';
import { listDingTalkChannels } from '@/lib/dingtalk/channel-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dingtalk/channels — 已配置协同群列表（合同功能收口，Migration 0055）
 * 供客户档案页选择 collaborationChannelKey（仅返回 key + name，**绝不返回 webhook/secret**——
 * secret 只在自建 Server 环境 DINGTALK_CHANNELS_JSON；未配置 → 空数组，前端显示「未配置协同群」）。
 * 权限：business-partner:view（只读主数据视角，复用既有模块，不新增权限码）。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'business-partner:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'dingtalk.channels.list');
  return ok({ channels: listDingTalkChannels() });
}
