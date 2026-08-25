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
import Page from '@/app/(dashboard)/purchasing/requisitions/new/page';

function mockResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

function envelope(data: unknown) {
  return { success: true, data };
}

describe('Purchase Requisition Create (ui-08) — Workspace 表单', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/items')) {
        return Promise.resolve(
          mockResponse(200, envelope([
            { id: 'i-1', code: 'RM001', name: '钢材', stockUom: { id: 'u-1', symbol: 'kg' } },
          ])),
        );
      }
      if (url.includes('/api/purchase-requisitions') && (init?.method ?? 'GET') === 'POST') {
        return Promise.resolve(mockResponse(200, envelope({ id: 'pr-1', code: 'PR-2026-0001' })));
      }
      return Promise.resolve(mockResponse(200, envelope([])));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('加载物料下拉后渲染 Workspace 表单（EntityFormWorkspace 结构）', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    expect(await screen.findByText('新建采购申请')).toBeInTheDocument();
    // LineEditor 行明细表头 + 物料列
    expect(screen.getByText('行明细')).toBeInTheDocument();
    expect(screen.getByText('基本信息')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/items'),
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('空行提交 → 顶部 ErrorPanel 校验错误（禁止 window.confirm 离开逻辑）', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建采购申请');
    fireEvent.click(screen.getByRole('button', { name: '创建（草稿）' }));
    // 校验错误走 ErrorPanel（role=alert），不静默
    await screen.findByRole('alert');
    expect(screen.getByText(/第 1 行：请选择物料/)).toBeInTheDocument();
    // 未触发 POST（校验失败不发请求）
    const posts = fetchMock.mock.calls.filter(
      (c) => String(c[0]).includes('/api/purchase-requisitions') && (c[1]?.method ?? 'GET') === 'POST',
    );
    expect(posts.length).toBe(0);
  });

  it('填写物料+数量后提交 → POST 正确 payload（itemId/quantity 契约原样）', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建采购申请');
    // 等待物料异步加载完成（option 就绪后再选）
    await waitFor(() => {
      expect(screen.getAllByRole('option').some((o) => o.textContent?.includes('RM001 · 钢材'))).toBe(true);
    });
    // 物料列 select（LineEditor 第一个 combobox）
    const combos = screen.getAllByRole('combobox');
    fireEvent.change(combos[0], { target: { value: 'i-1' } });
    // 数量输入（placeholder > 0）
    const qty = screen.getByPlaceholderText('> 0');
    fireEvent.change(qty, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '创建（草稿）' }));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (c) => String(c[0]).includes('/api/purchase-requisitions') && (c[1]?.method ?? 'GET') === 'POST',
      );
      expect(posts.length).toBe(1);
      const body = JSON.parse(String(posts[0][1]?.body));
      expect(body.lines).toHaveLength(1);
      expect(body.lines[0]).toMatchObject({ itemId: 'i-1', quantity: 5, uomId: 'u-1' });
    });
  });
});