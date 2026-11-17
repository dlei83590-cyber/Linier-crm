import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import { permissionsForRole } from '@nilier-crm/shared';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ id: 'pr-1' }),
}));

vi.mock('@/lib/session-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session-context')>();
  return {
    ...actual,
    useSession: () => ({
      state: {
        status: 'authenticated',
        user: {
          id: 'u-1',
          email: 'a@b.c',
          name: 'Admin',
          roles: ['SUPER_ADMIN'],
          // ADR-0057：会话有效权限集（内置角色等价集），供 can()/PermissionGuard 判定
          permissions: permissionsForRole('SUPER_ADMIN'),
        },
      },
    }),
  };
});

import type * as ApiClientModule from '@/lib/api-client';
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock('@/lib/api-client', async (importOriginal) => {
  const mod = await importOriginal<typeof ApiClientModule>();
  return { ...mod, apiFetch: mockApiFetch };
});

import { DensityProvider } from '@/lib/table-density-context';
import { ToastProvider } from '@/components/ui/toast';
import Page from '@/app/(dashboard)/purchasing/requisitions/page';

/**
 * 用户指令：「采购申请列表，在未关联其它动作时，列表可以删除」。
 *
 * 契约（本文件锁定）：
 * - 删除按钮显隐只消费后端只读投影 _count.purchaseOrders（有效采购订单引用数）+ 状态契约
 *   （DRAFT/SUBMITTED/CANCELLED/APPROVED，与 DELETE /:id 服务端一致）；
 * - APPROVED 且无采购订单引用 → 可删除（修复前列表缺该入口）；
 * - 已被采购订单引用 → 删除不可用（禁用并说明引用原因），不伪造可删状态；
 * - 已转单（CONVERTED）→ 只给「回退」，不给删除（删前必须先回退）。
 */

interface Row {
  id: string;
  code: string;
  status: string;
  needDate: string | null;
  requester: { name: string } | null;
  department: { name: string } | null;
  _count: { lines: number; purchaseOrders: number };
}

const ROWS: Row[] = [
  // APPROVED 且未关联采购订单 → 可删除（用户报告缺失的入口）
  { id: 'pr-free', code: 'PR-2026-0001', status: 'APPROVED', needDate: null, requester: { name: '张三' }, department: { name: '采购部' }, _count: { lines: 2, purchaseOrders: 0 } },
  // APPROVED 但已被 2 张采购订单引用 → 不可删除
  { id: 'pr-linked', code: 'PR-2026-0002', status: 'APPROVED', needDate: null, requester: { name: '李四' }, department: { name: '采购部' }, _count: { lines: 1, purchaseOrders: 2 } },
  // 已转采购订单 → 只能回退
  { id: 'pr-converted', code: 'PR-2026-0003', status: 'CONVERTED', needDate: null, requester: { name: '王五' }, department: { name: '采购部' }, _count: { lines: 1, purchaseOrders: 1 } },
  // 草稿 → 可删除
  { id: 'pr-draft', code: 'PR-2026-0004', status: 'DRAFT', needDate: null, requester: { name: '赵六' }, department: { name: '采购部' }, _count: { lines: 1, purchaseOrders: 0 } },
];

function rowOf(code: string): HTMLElement {
  const cell = screen.getByText(code);
  const tr = cell.closest('tr');
  if (!tr) throw new Error('未找到行：' + code);
  return tr as HTMLElement;
}

function renderPage() {
  return render(
    <DensityProvider>
      <ToastProvider>
        <Page />
      </ToastProvider>
    </DensityProvider>,
  );
}

describe('Purchase Requisition List — 未关联其它动作时可删除', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation((url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/purchase-requisitions/summary')) {
        return Promise.resolve({
          success: true,
          data: { total: ROWS.length, byStatus: { APPROVED: 2, CONVERTED: 1, DRAFT: 1 } },
        });
      }
      if (u.includes('/api/purchase-requisitions') && (init?.method ?? 'GET') === 'DELETE') {
        return Promise.resolve({ success: true, data: { id: 'pr-free', deleted: true } });
      }
      if (u.includes('/api/purchase-requisitions')) {
        return Promise.resolve({
          success: true,
          data: ROWS,
          meta: { page: 1, pageSize: 20, total: ROWS.length },
        });
      }
      return Promise.resolve({ success: true, data: [] });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('APPROVED 且无采购订单引用 → 列表出现可用「删除」', async () => {
    renderPage();
    await screen.findByText('PR-2026-0001');
    const btn = within(rowOf('PR-2026-0001')).getByRole('button', { name: '删除' });
    expect(btn).toBeEnabled();
  });

  it('已被采购订单引用 → 删除不可用，并说明引用原因（不静默隐藏）', async () => {
    renderPage();
    await screen.findByText('PR-2026-0002');
    const btn = within(rowOf('PR-2026-0002')).getByRole('button', { name: '删除' });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title') ?? '').toContain('2 张采购订单引用');
  });

  it('已转采购订单（CONVERTED）→ 只有「回退」，没有删除入口', async () => {
    renderPage();
    await screen.findByText('PR-2026-0003');
    const row = rowOf('PR-2026-0003');
    expect(within(row).queryByRole('button', { name: '删除' })).toBeNull();
    expect(within(row).getByRole('button', { name: '回退' })).toBeInTheDocument();
  });

  it('确认删除 → DELETE /api/purchase-requisitions/:id 且刷新列表', async () => {
    renderPage();
    await screen.findByText('PR-2026-0001');
    fireEvent.click(within(rowOf('PR-2026-0001')).getByRole('button', { name: '删除' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      const deletes = mockApiFetch.mock.calls.filter(
        (c) => String(c[0]).includes('/api/purchase-requisitions/pr-free') && (c[1] as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(deletes.length).toBe(1);
    });
    // 删除成功后重新拉取列表（refresh）
    await waitFor(() => {
      const listCalls = mockApiFetch.mock.calls.filter((c) => String(c[0]).startsWith('/api/purchase-requisitions?'));
      expect(listCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
