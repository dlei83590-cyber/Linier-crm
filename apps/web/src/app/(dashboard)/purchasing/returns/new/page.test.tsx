import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/session-context', () => ({
  useSession: () => ({
    state: {
      status: 'authenticated',
      user: { id: 'u-1', email: 'a@b.c', name: 'Admin', roles: ['SUPER_ADMIN'] },
    },
  }),
}));

import { DensityProvider } from '@/lib/table-density-context';
import Page from '@/app/(dashboard)/purchasing/returns/new/page';

function mockResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

function envelope(data: unknown) {
  return { success: true, data };
}

describe('Purchase Return Create (ui-08) — 按单拉取来源行 + POST 契约', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/purchase-orders') && !url.includes('/purchase-receipts')) {
        return Promise.resolve(
          mockResponse(200, envelope([
            { id: 'po-1', code: 'PO-2026-0001', status: 'APPROVED', supplier: { name: '供应商A' } },
          ])),
        );
      }
      // 收货单列表（按 PO 过滤 + 全量都返回同一份）
      if (url.includes('/api/purchase-receipts') && !/\/api\/purchase-receipts\/[^?]+/.test(url)) {
        return Promise.resolve(
          mockResponse(200, envelope({
            total: 1,
            page: 1,
            pageSize: 100,
            items: [
              { id: 'rc-1', code: 'RC-2026-0001', status: 'RECEIVED' },
            ],
          })),
        );
      }
      const receiptDetail = url.match(/\/api\/purchase-receipts\/([^?]+)/);
      if (receiptDetail) {
        return Promise.resolve(
          mockResponse(200, envelope({
            id: receiptDetail[1],
            code: 'RC-2026-0001',
            status: 'RECEIVED',
            lines: [
              { id: 'rl-1', lineNo: 10, quantity: '5', returnableQty: '5', item: { code: 'RM001', name: '钢材' }, uom: { symbol: 'kg' } },
            ],
          })),
        );
      }
      if (url.includes('/api/purchase-returns') && (init?.method ?? 'GET') === 'POST') {
        return Promise.resolve(mockResponse(200, envelope({ id: 'ret-1' })));
      }
      return Promise.resolve(mockResponse(200, envelope([])));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('未选 PO 提交 → 校验错误（purchaseOrderId 必填）', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建采购退货');
    fireEvent.click(screen.getByRole('button', { name: '创建（草稿）' }));
    await screen.findByRole('alert');
    expect(screen.getByText(/请选择采购订单/)).toBeInTheDocument();
  });

  it('选择 PO → 选收货单 → 选可退行 → 填数量/原因 → POST return 契约（sourcePurchaseReceiptLineId）', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建采购退货');

    // ① 采购订单（基本信息第一个 combobox）
    const combos = screen.getAllByRole('combobox');
    fireEvent.change(combos[0], { target: { value: 'po-1' } });

    // ② 行编辑区：来源类型（默认 RECEIPT_LINE）→ 来源单据 select（第 4 个 combobox，行内 render）
    //    等待 PO 变化触发 RECEIPT_LINE 单据加载
    await waitFor(() => {
      const docSelects = screen.getAllByRole('combobox');
      expect(docSelects.some((s) => Array.from(s.querySelectorAll('option')).some((o) => o.textContent?.includes('RC-2026-0001')))).toBe(true);
    });

    const allCombos = screen.getAllByRole('combobox');
    // combos: [PO, returnType, sourceRefType, sourceDoc, sourceLine, disposition]
    // ③ 来源单据 → rc-1（触发拉取该单可退行）
    fireEvent.change(allCombos[3], { target: { value: 'rc-1' } });

    // ④ 来源行加载出 L10 RM001 钢材（可退 5）
    await waitFor(() => {
      const lineSelects = screen.getAllByRole('combobox');
      const lineSelect = lineSelects[4];
      expect(Array.from(lineSelect.querySelectorAll('option')).some((o) => o.textContent?.includes('L10 RM001 钢材（可退 5）'))).toBe(true);
    });

    const after = screen.getAllByRole('combobox');
    fireEvent.change(after[4], { target: { value: 'rl-1' } });

    // ⑤ 数量 + 退货原因
    fireEvent.change(screen.getByPlaceholderText('> 0'), { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText('必填'), { target: { value: '外观破损' } });

    fireEvent.click(screen.getByRole('button', { name: '创建（草稿）' }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (c) => String(c[0]).includes('/api/purchase-returns') && (c[1]?.method ?? 'GET') === 'POST',
      );
      expect(posts.length).toBe(1);
      const body = JSON.parse(String(posts[0][1]?.body));
      expect(body.purchaseOrderId).toBe('po-1');
      expect(body.lines).toHaveLength(1);
      expect(body.lines[0]).toMatchObject({
        sourceRefType: 'RECEIPT_LINE',
        sourcePurchaseReceiptLineId: 'rl-1',
        quantity: 2,
        returnReason: '外观破损',
        disposition: 'REPLACE_REQUIRED',
      });
    });
  });
});
