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
import Page from '@/app/(dashboard)/purchasing/inspections/new/page';

function mockResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

function envelope(data: unknown) {
  return { success: true, data };
}

describe('Inspection Create (ui-08) — 收货单 → 来源行级联 + POST 契约', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/purchase-receipts') && !/\/api\/purchase-receipts\/[^?]+/.test(url)) {
        // 收货单列表（分页对象）
        return Promise.resolve(
          mockResponse(200, envelope({
            total: 1,
            page: 1,
            pageSize: 100,
            items: [
              { id: 'rc-1', code: 'RC-2026-0001', status: 'RECEIVED', purchaseOrder: { code: 'PO-2026-0001' } },
            ],
          })),
        );
      }
      const detailMatch = url.match(/\/api\/purchase-receipts\/([^?]+)/);
      if (detailMatch) {
        return Promise.resolve(
          mockResponse(200, envelope({
            id: detailMatch[1],
            code: 'RC-2026-0001',
            status: 'RECEIVED',
            lines: [
              { id: 'rl-1', lineNo: 10, quantity: '5', item: { code: 'RM001', name: '钢材' }, uom: { symbol: 'kg' } },
            ],
          })),
        );
      }
      if (url.includes('/api/inspections') && (init?.method ?? 'GET') === 'POST') {
        return Promise.resolve(mockResponse(200, envelope({ id: 'ins-1' })));
      }
      return Promise.resolve(mockResponse(200, envelope([])));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('未选来源收货行提交 → 校验错误（purchaseReceiptLineId 必填）', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建质检记录');
    fireEvent.click(screen.getByRole('button', { name: '创建（PENDING）' }));
    await screen.findByRole('alert');
    expect(screen.getByText(/请选择来源收货行/)).toBeInTheDocument();
  });

  it('选择收货单 → 行级联加载 → 选行提交 → POST inspection 契约', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建质检记录');

    // 收货单 ReferenceSelector（第一个 combobox）
    const combos = screen.getAllByRole('combobox');
    fireEvent.change(combos[0], { target: { value: 'rc-1' } });

    // 来源收货行（第二个 combobox）加载出 rl-1 选项
    await waitFor(() => {
      expect(screen.getAllByRole('option').some((o) => o.textContent?.includes('L10 RM001 钢材'))).toBe(true);
    });
    const combosAfter = screen.getAllByRole('combobox');
    fireEvent.change(combosAfter[1], { target: { value: 'rl-1' } });

    fireEvent.click(screen.getByRole('button', { name: '创建（PENDING）' }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (c) => String(c[0]).includes('/api/inspections') && (c[1]?.method ?? 'GET') === 'POST',
      );
      expect(posts.length).toBe(1);
      const body = JSON.parse(String(posts[0][1]?.body));
      expect(body).toMatchObject({ purchaseReceiptLineId: 'rl-1', inspectionMode: 'SKIP' });
    });
  });
});
