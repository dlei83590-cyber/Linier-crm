/**
 * Items Create — 表单改造回归（2026-09-27「物料管理改造」+ 引用源独立加载 + 单位联动）
 *
 * 覆盖：
 * 1. 引用源不级联：分类 403 与计量单位 500 各自独立，失败字段级可见 + 可单独重试。
 * 2. 类型手动输入：中文业务名归一化为 DB 枚举码；无法识别 → 阻止提交并提示（不发请求）。
 * 3. 改造后 payload 只含仍维护的字段（品牌/制造商/生命周期/状态/精度等级/预压值/采购销售标记一律不再提交），
 *    且不再调用任何 supplier-items 接口（既有 SupplierItem 数据不删不改）。
 * 4. 库存单位 → 采购单位 / 销售单位 联动（手工改过不再被覆盖）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { permissionsForRole } from '@nilier-crm/shared';

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
          permissions: permissionsForRole('SUPER_ADMIN'),
        },
      },
    }),
  };
});

import { DensityProvider } from '@/lib/table-density-context';
import Page from '@/app/(dashboard)/items/new/page';

function mockResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

const envelope = (data: unknown) => ({ success: true, data });
const failure = (code: string, message: string) => ({ success: false, error: { code, message } });

const REMOVED_KEYS = [
  'brand',
  'manufacturer',
  'lifecycle',
  'status',
  'precisionGrade',
  'preload',
  'isSalable',
  'isPurchasable',
  'isManufacturable',
];

/** 按字段文案取该字段下的控件（FormField 的 span → label → 控件） */
function fieldControl(text: string, tag: 'select' | 'input'): HTMLElement {
  let node: HTMLElement | null = screen.getByText(text);
  for (let i = 0; i < 4 && node; i += 1) {
    const found = node.querySelector(tag);
    if (found) return found as HTMLElement;
    node = node.parentElement;
  }
  throw new Error('未找到字段 ' + text + ' 下的 ' + tag);
}

function selectByText(text: string): HTMLSelectElement {
  return fieldControl(text, 'select') as HTMLSelectElement;
}

function inputByText(text: string): HTMLInputElement {
  return fieldControl(text, 'input') as HTMLInputElement;
}

function retryIn(fieldLabel: string) {
  const field = screen.getByText(fieldLabel).closest('label') as HTMLElement;
  fireEvent.click(within(field).getByRole('button', { name: '重试' }));
}

describe('Items Create — 表单改造 + 引用源独立加载 + 单位联动', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let categoryFails: boolean;
  let uomFails: boolean;

  beforeEach(() => {
    categoryFails = false;
    uomFails = false;
    fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/items') && method === 'POST') {
        return Promise.resolve(mockResponse(200, envelope({ id: 'itm-1' })));
      }
      if (url.includes('/api/item-categories')) {
        return Promise.resolve(
          categoryFails
            ? mockResponse(403, failure('FORBIDDEN', 'Insufficient permission'))
            : mockResponse(200, envelope([{ id: 'cat-1', code: 'SLIDER', name: '滑块' }])),
        );
      }
      if (url.includes('/api/unit-of-measures')) {
        return Promise.resolve(
          uomFails
            ? mockResponse(500, failure('INTERNAL_ERROR', 'Internal server error'))
            : mockResponse(200, envelope([
                { id: 'uom-kg', code: 'KG', name: '千克', symbol: 'kg' },
                { id: 'uom-m', code: 'M', name: '米', symbol: 'm' },
                { id: 'uom-pc', code: 'PC', name: '件', symbol: '件' },
              ])),
        );
      }
      return Promise.resolve(mockResponse(200, envelope([])));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('分类 403：计量单位三个字段不受影响；分类显示真实原因（含权限码）并可单独重试', async () => {
    categoryFails = true;
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');

    await waitFor(() => expect(selectByText('库存单位').options.length).toBe(4));
    expect(selectByText('采购单位').options.length).toBe(4);
    expect(selectByText('销售单位').options.length).toBe(4);

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('item-category:view');
    expect(selectByText('分类').options[0].textContent).toContain('加载失败');

    categoryFails = false;
    retryIn('分类');
    await waitFor(() => expect(selectByText('分类').innerHTML).toContain('滑块'));
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
  });

  it('计量单位 500：分类不受影响；三个单位字段各自可见错误，一次重试全部恢复', async () => {
    uomFails = true;
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');

    await waitFor(() => expect(selectByText('分类').options.length).toBe(2));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(3);
    expect(alerts[0].textContent).toContain('系统故障');
    expect(alerts[0].textContent).toContain('INTERNAL_ERROR');

    uomFails = false;
    retryIn('库存单位');
    await waitFor(() => expect(selectByText('库存单位').options.length).toBe(4));
    expect(selectByText('采购单位').options.length).toBe(4);
    expect(selectByText('销售单位').options.length).toBe(4);
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
  });

  it('类型手动输入：中文业务名归一化为枚举码；被移除字段不进 payload；不调用 supplier-items', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');

    fireEvent.change(inputByText('编码'), { target: { value: 'ITM-001' } });
    fireEvent.change(inputByText('名称'), { target: { value: '直线导轨' } });
    fireEvent.change(inputByText('类型'), { target: { value: '成品' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/items') && c[1]?.method === 'POST')).toBe(true);
    });

    const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/items') && c[1]?.method === 'POST');
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body.itemType).toBe('FINISHED_GOOD');
    expect(body.code).toBe('ITM-001');
    expect(body.name).toBe('直线导轨');
    for (const key of REMOVED_KEYS) {
      expect(body).not.toHaveProperty(key);
    }
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/supplier-items'))).toBe(false);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/suppliers'))).toBe(false);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/commercial-terms'))).toBe(false);
  });

  it('类型无法识别：阻止提交并提示可选值（不发 POST）', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');

    fireEvent.change(inputByText('编码'), { target: { value: 'ITM-002' } });
    fireEvent.change(inputByText('名称'), { target: { value: '滑块' } });
    fireEvent.change(inputByText('类型'), { target: { value: '不存在的类型' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('类型无法识别');
    expect(alert.textContent).toContain('成品');
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });

  it('联动：选定库存单位带出采购/销售单位；手工改过的字段不再被覆盖', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');
    await waitFor(() => expect(selectByText('库存单位').options.length).toBe(4));

    fireEvent.change(selectByText('库存单位'), { target: { value: 'uom-kg' } });
    expect(selectByText('采购单位').value).toBe('uom-kg');
    expect(selectByText('销售单位').value).toBe('uom-kg');
    expect(screen.getAllByText('跟随库存单位')).toHaveLength(2);

    fireEvent.change(selectByText('采购单位'), { target: { value: 'uom-pc' } });
    expect(selectByText('采购单位').value).toBe('uom-pc');
    expect(screen.getByText('已单独设置（不再跟随库存单位）')).toBeInTheDocument();

    fireEvent.change(selectByText('库存单位'), { target: { value: 'uom-m' } });
    expect(selectByText('采购单位').value).toBe('uom-pc');
    expect(selectByText('销售单位').value).toBe('uom-m');

    fireEvent.change(selectByText('采购单位'), { target: { value: 'uom-m' } });
    expect(screen.getAllByText('跟随库存单位')).toHaveLength(2);
    fireEvent.change(selectByText('库存单位'), { target: { value: 'uom-kg' } });
    expect(selectByText('采购单位').value).toBe('uom-kg');
  });
});
