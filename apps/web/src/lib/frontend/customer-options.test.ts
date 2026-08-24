import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api-client', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '@/lib/api-client';
import { CUSTOMER_SELECTOR_URL, loadCustomerOptions } from './customer-options';

const mockedFetch = vi.mocked(apiFetch);

/**
 * P0-1 回归测试（CTO Directive Phase 1）：
 * 证明客户选择器数据源是 /api/business-partners（BusinessPartner SSOT），
 * 不会再次把 Customer.id 提交给需要 BusinessPartner.id 的接口。
 */
describe('Customer selector SSOT（P0-1）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('数据源必须是 /api/business-partners?type=CUSTOMER（而非 /api/customers）', async () => {
    mockedFetch.mockResolvedValue({ success: true, data: [] });
    await loadCustomerOptions();
    const url = mockedFetch.mock.calls[0][0];
    expect(url).toBe(CUSTOMER_SELECTOR_URL);
    expect(url).toContain('/api/business-partners');
    expect(url).toContain('type=CUSTOMER');
    expect(url).toContain('isActive=true');
    expect(url).not.toContain('/api/customers');
  });

  it('option.id 直接透传 BusinessPartner.id（无 Customer 转换/映射）', async () => {
    mockedFetch.mockResolvedValue({
      success: true,
      data: [
        { id: 'bp-1', code: 'C001', name: '客户甲' },
        { id: 'bp-2', code: 'C002', name: '客户乙' },
      ],
    });
    const opts = await loadCustomerOptions();
    // option.id 必须是 BusinessPartner.id（= POST customerId = 后端校验 id）
    expect(opts.map((o) => o.id)).toEqual(['bp-1', 'bp-2']);
    expect(opts.map((o) => o.name)).toEqual(['客户甲', '客户乙']);
  });

  it('AbortSignal 透传给 apiFetch（页面 useEffect 取消支持）', async () => {
    const signal = new AbortController().signal;
    mockedFetch.mockResolvedValue({ success: true, data: [] });
    await loadCustomerOptions(signal);
    expect(mockedFetch.mock.calls[0][1]).toEqual({ signal });
  });
});
