import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// jest-dom matchers 类型增强（vitest entry：runtime + TS Assertion 接口）
import '@testing-library/jest-dom/vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'so-1' }),
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
import Page from '@/app/(dashboard)/sales/orders/[id]/page';

const detail = {
  id: 'so-1',
  code: 'SO-2026-0001',
  status: 'DRAFT',
  orderDate: '2026-01-01T00:00:00.000Z',
  requestedDeliveryDate: null,
  paymentTerm: null,
  incoterm: null,
  currency: 'CNY',
  totalAmount: '113',
  remark: null,
  customer: { id: 'c-1', code: 'C001', name: '客户A' },
  quotation: null,
  lines: [
    {
      id: 'l-1',
      lineNo: 10,
      description: '成品',
      quantity: '100',
      deliveredQty: '0',
      remainingQty: '100',
      unitPrice: '1',
      totalAmount: '100',
      item: { id: 'i-1', code: 'FG1', name: '成品1' },
    },
  ],
  deliveries: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** apiFetch 消费的最小 Response 形状（status/ok/json） */
function mockResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

function envelope(data: unknown) {
  return { success: true, data };
}

function failEnvelope(code: string, message: string) {
  return { success: false, error: { code, message } };
}

describe('Sales Order Detail — Q 线投影（FRT-06：API 失败 ≠ 空态）', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let materialsFail: boolean;

  beforeEach(() => {
    materialsFail = true;
    fetchMock = vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes('/material-requirements')) {
        if (materialsFail) {
          return Promise.resolve(mockResponse(500, failEnvelope('INTERNAL_ERROR', '数据库查询失败')));
        }
        return Promise.resolve(
          mockResponse(200, envelope([{ itemId: 'rm-1', itemCode: 'RM001', itemName: '钢材', uom: '千克', requiredQty: 101, onHandQty: 500 }])),
        );
      }
      if (url.includes('/supplier-recommendations')) {
        // 供应商接口成功但无数据 → 合法空态
        return Promise.resolve(mockResponse(200, envelope([])));
      }
      return Promise.resolve(mockResponse(200, envelope(detail)));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('material-requirements 接口失败时显示真实错误 + 重试，绝不伪装成"无配方"空态', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );

    // 接口失败 → 显示错误面板（describeStatus(500)=系统故障）与重试按钮
    await screen.findByText(/系统故障/);
    expect(screen.getByText(/数据库查询失败/)).toBeInTheDocument();
    expect(screen.queryByText(/无配方原料需求/)).not.toBeInTheDocument();

    // 供应商接口成功空数组 → 合法空态文案照常显示（区分 API 失败与真实无数据）
    expect(screen.getByText(/暂无推荐供应商/)).toBeInTheDocument();
  });

  it('点击重试后（接口恢复）BOM 用料正常渲染，错误面板消失', async () => {
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );

    await screen.findByText(/系统故障/);
    const retryButtons = screen.getAllByRole('button', { name: '重试' });
    expect(retryButtons.length).toBeGreaterThan(0);

    // 接口恢复后重试
    materialsFail = false;
    fireEvent.click(retryButtons[0]);

    await screen.findByText('钢材');
    await waitFor(() => {
      expect(screen.queryByText(/系统故障/)).not.toBeInTheDocument();
    });
    expect(screen.getByText('101.0000')).toBeInTheDocument();
    expect(screen.queryByText(/无配方原料需求/)).not.toBeInTheDocument();
  });
});
