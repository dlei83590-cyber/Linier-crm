import { apiFetch } from "@/lib/api-client";

/**
 * Customer Selector SSOT（P0-1，CTO Directive Phase 1）
 *
 * 客户选择器统一数据源 = /api/business-partners?type=CUSTOMER&isActive=true（BusinessPartner SSOT）。
 *
 * 核心不变量（P0-1 验收）：
 *   UI option.id = BusinessPartner.id = POST customerId = backend lookup id
 *
 * 禁止再向需要 BusinessPartner.id 的接口提交 Customer.id（历史 ID 错配根因）；
 * 本模块是唯一授权加载客户选项的入口（前端），回归测试锁定数据源与 id 透传。
 */
export interface CustomerOption {
  id: string;
  code: string | null;
  name: string | null;
}

/** 客户选项数据源 URL（BusinessPartner SSOT；与 sales 侧 customer selector 一致） */
export const CUSTOMER_SELECTOR_URL = "/api/business-partners?pageSize=100&type=CUSTOMER&isActive=true";

/** 加载客户选项（AbortSignal 透传，供页面 useEffect 取消）；option.id = BusinessPartner.id */
export async function loadCustomerOptions(signal?: AbortSignal): Promise<CustomerOption[]> {
  const body = await apiFetch<CustomerOption[]>(CUSTOMER_SELECTOR_URL, { signal });
  return Array.isArray(body.data) ? body.data : [];
}
