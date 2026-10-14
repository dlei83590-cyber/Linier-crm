/**
 * Items Create — 引用下拉加载修复 + 计量单位联动（用户问题回归）
 *
 * 回归点（用户报告：物料管理中 分类 / 库存单位 / 采购单位 / 销售单位 / 供应商 加载失败）：
 * 1. 修复前：4 个引用源共用一个 Promise.all —— 任一源失败（403/500/网络）会让整组下拉一起空白。
 *    修复后每源独立取数：某源失败不影响其他源；失败必须在字段上可见（真实原因 + 缺失权限码）且可单独重试。
 * 2. 联动：库存单位 → 采购单位 / 销售单位 自动跟随；手工改过的字段不再被库存单位变更覆盖，
 *    改回空值或与库存单位一致时恢复跟随。
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

/** 按字段文案取该字段下的下拉（FormField 的 span → label；供应商行的 label → 字段容器） */
function selectByText(text: string): HTMLSelectElement {
  let node: HTMLElement | null = screen.getByText(text);
  for (let i = 0; i < 4 && node; i += 1) {
    const select = node.querySelector('select');
    if (select) return select as HTMLSelectElement;
    node = node.parentElement;
  }
  throw new Error('未找到下拉字段：' + text);
}

describe('Items Create — 引用源独立加载 + 单位联动', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let categoryFails: boolean;
  let uomFails: boolean;

  beforeEach(() => {
    categoryFails = false;
    uomFails = false;
    fetchMock = vi.fn((input: unknown) => {
      const url = String(input);
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
      if (url.includes('/api/suppliers')) {
        return Promise.resolve(mockResponse(200, envelope([{ id: 'sup-1', code: 'S001', name: '供应商甲', partner: { id: 'bp-1' } }])));
      }
      if (url.includes('/api/commercial-terms')) {
        return Promise.resolve(mockResponse(200, envelope([{ id: 'ct-1', code: 'NET30', name: '月结30天' }])));
      }
      return Promise.resolve(mockResponse(200, envelope([])));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('分类 403 + 计量单位 500：供应商/付款条款仍加载成功，失败字段显示真实原因并可单独重试', async () => {
    categoryFails = true;
    uomFails = true;
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');

    // 未受影响的引用源照常可用（修复前会被同组失败一起打成空白）
    await waitFor(() => expect(selectByText('供应商').options.length).toBe(2));
    expect(selectByText('付款条款').options.length).toBe(2);
    expect(selectByText('供应商').innerHTML).toContain('供应商甲');

    // 失败可见：4 处（分类 1 + 计量单位 3）alert，且必须说明缺哪个权限 / 真实 HTTP 语义
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(4);
    expect(alerts[0].textContent).toContain('item-category:view');
    expect(alerts[1].textContent).toContain('系统故障');
    expect(alerts[1].textContent).toContain('INTERNAL_ERROR');
    // 失败时不得伪装成正常空态
    expect(selectByText('分类').options[0].textContent).toContain('加载失败');

    // 字段级重试：分类与计量单位是两个独立源，各自重试、互不影响
    expect(screen.getAllByRole('button', { name: '重试' })).toHaveLength(4);
    categoryFails = false;
    uomFails = false;
    fireEvent.click(within(screen.getByText('分类').closest('label') as HTMLElement).getByRole('button', { name: '重试' }));
    fireEvent.click(within(screen.getByText('库存单位').closest('label') as HTMLElement).getByRole('button', { name: '重试' }));

    await waitFor(() => expect(selectByText('分类').innerHTML).toContain('滑块'));
    await waitFor(() => expect(selectByText('库存单位').innerHTML).toContain('千克'));
    expect(selectByText('采购单位').innerHTML).toContain('千克');
    expect(selectByText('销售单位').innerHTML).toContain('千克');
    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0));
  });

  it('联动：选定库存单位带出采购/销售单位；手工改过的字段不再被覆盖', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );
    await screen.findByText('新建物料');
    await waitFor(() => expect(selectByText('库存单位').options.length).toBe(4));

    // ① 选库存单位 → 采购 / 销售单位自动跟随
    fireEvent.change(selectByText('库存单位'), { target: { value: 'uom-kg' } });
    expect(selectByText('采购单位').value).toBe('uom-kg');
    expect(selectByText('销售单位').value).toBe('uom-kg');
    expect(screen.getAllByText('跟随库存单位')).toHaveLength(2);

    // ② 手工改采购单位 → 该字段解除跟随
    fireEvent.change(selectByText('采购单位'), { target: { value: 'uom-pc' } });
    expect(selectByText('采购单位').value).toBe('uom-pc');
    expect(screen.getByText('已单独设置（不再跟随库存单位）')).toBeInTheDocument();

    // ③ 再改库存单位 → 手工设置过的采购单位保持不变，销售单位继续跟随
    fireEvent.change(selectByText('库存单位'), { target: { value: 'uom-m' } });
    expect(selectByText('采购单位').value).toBe('uom-pc');
    expect(selectByText('销售单位').value).toBe('uom-m');

    // ④ 手工改回与库存单位一致 → 恢复跟随
    fireEvent.change(selectByText('采购单位'), { target: { value: 'uom-m' } });
    expect(screen.getAllByText('跟随库存单位')).toHaveLength(2);
    fireEvent.change(selectByText('库存单位'), { target: { value: 'uom-kg' } });
    expect(selectByText('采购单位').value).toBe('uom-kg');
  });
});
