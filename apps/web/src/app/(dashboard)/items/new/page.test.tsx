/**
 * Items Create — 第 3 轮表单回归（类型=材质分类 / 9 字段 / 引用源独立加载）
 *
 * 覆盖：
 * 1. 引用源不级联：分类 403 与计量单位 500 各自独立，失败字段级可见 + 可单独重试。
 * 2. 「材料类型」自由文本：不再有枚举校验错误；保存时以 categoryName 交给服务端匹配/新建分类。
 * 3. 「类型」↔「分类」双向联动：同名自动选中；下拉选择回填文本。
 * 4. payload 只含仍维护的字段（被移除字段一律不提交），且不调用任何 supplier-items。
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

/** 表单不再维护的字段：一律不得出现在 payload 中（省略 = 不覆盖既有数据） */
const REMOVED_KEYS = [
  'mnemonic',
  'sourcingType',
  'description',
  'purchaseUomId',
  'salesUomId',
  'itemType',
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

async function fillRequiredAndSave(typeText: string) {
  fireEvent.change(inputByText('编码'), { target: { value: 'ITM-001' } });
  fireEvent.change(inputByText('名称'), { target: { value: '直线导轨' } });
  if (typeText) fireEvent.change(inputByText('材料类型'), { target: { value: typeText } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => {
    expect(fetchMockRef.current.mock.calls.some((c) => String(c[0]).includes('/api/items') && c[1]?.method === 'POST')).toBe(true);
  });
  const post = fetchMockRef.current.mock.calls.find((c) => String(c[0]).includes('/api/items') && c[1]?.method === 'POST');
  return JSON.parse(String(post?.[1]?.body)) as Record<string, unknown>;
}

/** beforeEach 注入的 fetch mock（供 helpers 使用） */
const fetchMockRef: { current: ReturnType<typeof vi.fn> } = { current: vi.fn() };

describe('Items Create — 第 3 轮表单（类型=材质分类 + 引用源独立加载）', () => {
  let categoryFails: boolean;
  let uomFails: boolean;

  beforeEach(() => {
    categoryFails = false;
    uomFails = false;
    fetchMockRef.current = vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/items') && method === 'POST') {
        return Promise.resolve(mockResponse(200, envelope({ id: 'itm-1' })));
      }
      if (url.includes('/api/item-categories')) {
        return Promise.resolve(
          categoryFails
            ? mockResponse(403, failure('FORBIDDEN', 'Insufficient permission'))
            : mockResponse(200, envelope([
                { id: 'cat-1', code: 'SLIDER', name: '滑块' },
                { id: 'cat-2', code: 'MAT-004', name: '45#钢' },
              ])),
        );
      }
      if (url.includes('/api/unit-of-measures')) {
        return Promise.resolve(
          uomFails
            ? mockResponse(500, failure('INTERNAL_ERROR', 'Internal server error'))
            : mockResponse(200, envelope([
                { id: 'uom-kg', code: 'KG', name: '千克', symbol: 'kg' },
                { id: 'uom-pc', code: 'PC', name: '件', symbol: '件' },
              ])),
        );
      }
      return Promise.resolve(mockResponse(200, envelope([])));
    });
    vi.stubGlobal('fetch', fetchMockRef.current);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('分类 403：计量单位不受影响；分类显示真实原因（含权限码）并可单独重试', async () => {
    categoryFails = true;
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');

    await waitFor(() => expect(selectByText('计量单位').options.length).toBe(3));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('item-category:view');
    expect(selectByText('分类').options[0].textContent).toContain('加载失败');

    categoryFails = false;
    retryIn('分类');
    await waitFor(() => expect(selectByText('分类').innerHTML).toContain('滑块'));
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
  });

  it('计量单位 500：分类不受影响；计量单位显示错误并可重试', async () => {
    uomFails = true;
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');

    await waitFor(() => expect(selectByText('分类').options.length).toBe(3));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('系统故障');
    expect(alerts[0].textContent).toContain('INTERNAL_ERROR');

    uomFails = false;
    retryIn('计量单位');
    await waitFor(() => expect(selectByText('计量单位').options.length).toBe(3));
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
  });

  it('类型自由文本：不再报「类型无法识别」；保存以 categoryName 提交，被移除字段不进 payload', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');

    // 任意文字都不再触发枚举校验错误（上一轮的用户报错点）
    fireEvent.change(inputByText('材料类型'), { target: { value: '不存在的材质' } });
    expect(screen.queryAllByRole('alert')).toHaveLength(0);

    const body = await fillRequiredAndSave('不存在的材质');
    expect(body.categoryName).toBe('不存在的材质');
    expect(body.code).toBe('ITM-001');
    expect(body.name).toBe('直线导轨');
    for (const key of REMOVED_KEYS) {
      expect(body).not.toHaveProperty(key);
    }
    expect(fetchMockRef.current.mock.calls.some((c) => String(c[0]).includes('/supplier-items'))).toBe(false);
    expect(fetchMockRef.current.mock.calls.some((c) => String(c[0]).includes('/api/suppliers'))).toBe(false);
  });

  it('材料类型与分类不联动：输入不回填下拉、选择不回填输入', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');
    await waitFor(() => expect(selectByText('分类').options.length).toBe(3));

    // 输入材料类型（哪怕与已有分类同名）→ 不得自动选中分类
    fireEvent.change(inputByText('材料类型'), { target: { value: '45#钢' } });
    expect(selectByText('分类').value).toBe('');
    expect(inputByText('材料类型').value).toBe('45#钢');

    // 选择分类 → 不得回填材料类型
    fireEvent.change(selectByText('分类'), { target: { value: 'cat-1' } });
    expect(inputByText('材料类型').value).toBe('45#钢');
  });

  it('材料类型与分类不一致 → 不拦截保存，以「最近修改」的为准（后改分类 → 提交 categoryId）', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');
    await waitFor(() => expect(selectByText('分类').options.length).toBe(3));

    fireEvent.change(inputByText('编码'), { target: { value: 'ITM-003' } });
    fireEvent.change(inputByText('名称'), { target: { value: '轴承' } });
    fireEvent.change(inputByText('材料类型'), { target: { value: '45#钢' } });
    fireEvent.change(selectByText('分类'), { target: { value: 'cat-1' } });

    // 非拦截式提示：说明以谁为准（不是错误、不禁用保存）
    expect(screen.getByText('保存时以「分类」为准（与材料类型不一致）')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(fetchMockRef.current.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true);
    });
    const post = fetchMockRef.current.mock.calls.find((c) => String(c[0]).includes('/api/items') && c[1]?.method === 'POST');
    const body = JSON.parse(String(post?.[1]?.body)) as Record<string, unknown>;
    expect(body.categoryId).toBe('cat-1');
    expect(body).not.toHaveProperty('categoryName');
  });

  it('材料类型与分类不一致 → 后改材料类型则以「材料类型」为准（提交 categoryName）', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');
    await waitFor(() => expect(selectByText('分类').options.length).toBe(3));

    fireEvent.change(inputByText('编码'), { target: { value: 'ITM-004' } });
    fireEvent.change(inputByText('名称'), { target: { value: '轴承' } });
    fireEvent.change(selectByText('分类'), { target: { value: 'cat-1' } });
    fireEvent.change(inputByText('材料类型'), { target: { value: '45#钢' } });

    expect(screen.getByText('保存时以「材料类型」为准（与所选分类不一致）')).toBeInTheDocument();

    const body = await fillRequiredAndSave('');
    expect(body.categoryName).toBe('45#钢');
    expect(body).not.toHaveProperty('categoryId');
  });

  it('计量单位选择与场景字段提交', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');
    await waitFor(() => expect(selectByText('计量单位').options.length).toBe(3));

    fireEvent.change(inputByText('系列'), { target: { value: 'SM' } });
    fireEvent.change(inputByText('型号'), { target: { value: 'SMH45A' } });
    fireEvent.change(inputByText('规格'), { target: { value: '45#钢' } });
    fireEvent.change(selectByText('计量单位'), { target: { value: 'uom-kg' } });
    fireEvent.change(inputByText('OEM 编码'), { target: { value: 'OEM-1' } });

    const body = await fillRequiredAndSave('滑块');
    expect(body.series).toBe('SM');
    expect(body.model).toBe('SMH45A');
    expect(body.spec).toBe('45#钢');
    expect(body.stockUomId).toBe('uom-kg');
    expect(body.oemCode).toBe('OEM-1');
    // 类型文本优先（同名分类由服务端解析/复用）
    expect(body.categoryName).toBe('滑块');
  });
});
