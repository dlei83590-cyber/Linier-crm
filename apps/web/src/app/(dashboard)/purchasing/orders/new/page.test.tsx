import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { permissionsForRole } from "@nilier-crm/shared";

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

import { DensityProvider } from '@/lib/table-density-context';
import Page from '@/app/(dashboard)/purchasing/orders/new/page';

/**
 * 用户报告：「新增采购单给供应商为空，没有关联到来往单位」
 *
 * 本文件锁定的契约：
 * - 供应商引用源失败必须**可见 + 可单字段重试**，且不得连带把物料/单位/付款条件下拉一起打成空；
 * - 供应商成功加载但为空 → 明确说明「供应商档案来自往来单位」并给出建档入口（不静默空下拉）；
 * - 正常路径仍按原契约 POST（supplierId + lines）。
 */

function mockResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

function envelope(data: unknown) {
  return { success: true, data };
}

function errorEnvelope(code: string, message: string) {
  return { success: false, error: { code, message } };
}

const ITEM = { id: 'item-1', code: 'ITM-001', name: '轴承 6204', model: null };
const UOM = { id: 'uom-1', code: 'PCS', name: '件', symbol: '件' };
const TERM = { id: 'term-1', code: 'NET30', name: '月结30天' };
const SUPPLIER = { id: 'sup-1', code: 'BP-S-001', name: '华东供应商有限公司', currency: 'CNY', partner: { id: 'bp-1' } };

interface RecordedRequest {
  url: string;
  method: string;
  body: string | null;
}

/** fetch 桩：记录每次请求（url / method / body），供应商源由 overrides 注入三态 */
function makeFetch(overrides: { suppliers?: () => Response } = {}) {
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn((input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    });
    if (url.includes('/api/suppliers')) {
      return Promise.resolve(overrides.suppliers ? overrides.suppliers() : mockResponse(200, envelope([SUPPLIER])));
    }
    if (url.includes('/api/items')) return Promise.resolve(mockResponse(200, envelope([ITEM])));
    if (url.includes('/api/unit-of-measures')) return Promise.resolve(mockResponse(200, envelope([UOM])));
    if (url.includes('/api/commercial-terms')) return Promise.resolve(mockResponse(200, envelope([TERM])));
    if (url.includes('/api/purchase-orders')) return Promise.resolve(mockResponse(200, envelope({ id: 'po-1' })));
    return Promise.resolve(mockResponse(200, envelope([])));
  });
  return { fetchMock, requests };
}

function renderPage() {
  return render(
    <DensityProvider>
      <Page />
    </DensityProvider>,
  );
}

function supplierSelect(): HTMLSelectElement {
  return screen.getAllByRole('combobox')[0] as HTMLSelectElement;
}

/** 行编辑区的物料下拉（选项来自 /api/items） */
function itemSelect(): HTMLSelectElement {
  const found = screen
    .getAllByRole('combobox')
    .find((s) => Array.from((s as HTMLSelectElement).options).some((o) => o.textContent?.includes('ITM-001')));
  if (!found) throw new Error('未找到物料下拉');
  return found as HTMLSelectElement;
}

describe('Purchase Order Create — 供应商引用源（往来单位）可见性与契约', () => {
  let fetchMock: ReturnType<typeof makeFetch>['fetchMock'];
  let requests: RecordedRequest[];

  beforeEach(() => {
    const made = makeFetch();
    fetchMock = made.fetchMock;
    requests = made.requests;
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('供应商源加载成功 → 下拉出现往来单位供应商（名称 + 编码）', async () => {
    renderPage();
    await screen.findByText('新建采购订单');
    await waitFor(() => {
      const options = Array.from(supplierSelect().options).map((o) => o.textContent ?? '');
      expect(options.some((t) => t.includes('华东供应商有限公司'))).toBe(true);
      expect(options.some((t) => t.includes('BP-S-001'))).toBe(true);
    });
    // 已有档案 → 不显示建档引导
    expect(screen.queryByText(/暂无供应商档案/)).not.toBeInTheDocument();
  });

  it('供应商源为空（无档案）→ 明确提示来自往来单位 + 建档入口，而不是静默空下拉', async () => {
    const made = makeFetch({ suppliers: () => mockResponse(200, envelope([])) });
    vi.stubGlobal('fetch', made.fetchMock);
    renderPage();
    await screen.findByText('新建采购订单');
    expect(await screen.findByText(/暂无供应商档案/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '新建往来单位' })).toHaveAttribute('href', '/business-partners/new');
  });

  it('供应商源失败（500）→ 字段显示失败 + 重试，且物料下拉不被级联清空', async () => {
    const made = makeFetch({ suppliers: () => mockResponse(500, errorEnvelope('INTERNAL_ERROR', '服务器错误')) });
    vi.stubGlobal('fetch', made.fetchMock);
    renderPage();
    await screen.findByText('新建采购订单');
    // 失败必须可见（不静默降级成空下拉）
    await screen.findByText(/加载失败，请重试/);
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    // 其他引用源不受影响：物料行依旧可选
    await waitFor(() => {
      expect(Array.from(itemSelect().options).some((o) => o.textContent?.includes('ITM-001'))).toBe(true);
    });
  });

  it('未选供应商提交 → 校验错误「请选择供应商」', async () => {
    renderPage();
    await screen.findByText('新建采购订单');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/请选择供应商/)).toBeInTheDocument();
  });

  it('选供应商 + 行 → POST 契约（supplierId + lines[itemId/quantity]）', async () => {
    renderPage();
    await screen.findByText('新建采购订单');

    await waitFor(() => {
      const options = Array.from(supplierSelect().options).map((o) => o.textContent ?? '');
      expect(options.some((t) => t.includes('华东供应商有限公司'))).toBe(true);
    });
    fireEvent.change(supplierSelect(), { target: { value: 'sup-1' } });

    await waitFor(() => expect(itemSelect()).toBeTruthy());
    fireEvent.change(itemSelect(), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByPlaceholderText('> 0'), { target: { value: '3' } });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      const posts = requests.filter((r) => r.url.includes('/api/purchase-orders') && r.method === 'POST');
      expect(posts.length).toBe(1);
      const body = JSON.parse(String(posts[0].body));
      expect(body.supplierId).toBe('sup-1');
      expect(body.lines).toHaveLength(1);
      expect(body.lines[0]).toMatchObject({ itemId: 'item-1', quantity: 3, priceSource: 'SUPPLIER_PRICE_SNAPSHOT' });
    });
  });
});
