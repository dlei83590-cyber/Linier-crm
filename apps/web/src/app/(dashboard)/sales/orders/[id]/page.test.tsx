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
  let materialsPayload: unknown[];

  beforeEach(() => {
    materialsFail = true;
    materialsPayload = [
      {
        itemId: 'rm-1',
        itemCode: 'RM001',
        itemName: '钢材',
        uom: '千克',
        requiredUom: 'KG',
        requiredQty: 101,
        tonnage: 0.101,
        tonnageConvertible: true,
        reason: null,
        onHandQty: 500,
      },
    ];
    fetchMock = vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes('/material-requirements')) {
        if (materialsFail) {
          return Promise.resolve(mockResponse(500, failEnvelope('INTERNAL_ERROR', '数据库查询失败')));
        }
        return Promise.resolve(mockResponse(200, envelope(materialsPayload)));
      }
      if (url.includes('/supplier-recommendations')) {
        // 供应商接口成功但无数据 → 合法空态（cc-06：rows 空数组 + basis 文案）
        return Promise.resolve(
          mockResponse(200, envelope({ rows: [], customerLevel: null, minimumSupplierRating: null, ruleApplied: false, basis: '推荐依据：客户未设置等级，无评级门槛（展示全部匹配供应商）；优选供应商优先，评级高者优先。用户仍可人工选择。' })),
        );
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
    expect(screen.getByText('101.0000 KG')).toBeInTheDocument();
    expect(screen.queryByText(/无配方原料需求/)).not.toBeInTheDocument();
  });

  it('推荐供应商（cc-06）：展示评级门槛依据文案 + 仅列出满足规则的供应商（rows）', async () => {
    materialsFail = false;
    fetchMock = vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes('/material-requirements')) {
        return Promise.resolve(mockResponse(200, envelope([{ itemId: 'rm-1', itemCode: 'RM001', itemName: '钢材', uom: '千克', requiredQty: 101, onHandQty: 500 }])));
      }
      if (url.includes('/supplier-recommendations')) {
        return Promise.resolve(
          mockResponse(200, envelope({
            rows: [
              { supplierId: 'sup-1', supplierCode: 'S001', supplierName: '甲供应商', creditRating: 'AA', supplierRating: 'AA', settlementTerms: null, itemCount: 2, preferredCount: 1, totalPrice: 300 },
              { supplierId: 'sup-2', supplierCode: 'S002', supplierName: '乙供应商', creditRating: 'B', supplierRating: 'B', settlementTerms: null, itemCount: 1, preferredCount: 0, totalPrice: 90 },
            ],
            customerLevel: 'VIP',
            minimumSupplierRating: 'A',
            ruleApplied: true,
            basis: '推荐依据：客户等级 VIP，要求供应商评级 ≥ A，优选供应商优先；评级相同则按供应商评级降序。用户仍可人工选择。',
          })),
        );
      }
      return Promise.resolve(mockResponse(200, envelope(detail)));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );

    // 依据文案（页面必须展示推荐原因）
    await screen.findByText(/要求供应商评级 ≥ A/);
    // 仅列出满足规则的供应商
    expect(screen.getByText('甲供应商')).toBeInTheDocument();
    expect(screen.getByText('乙供应商')).toBeInTheDocument();
    expect(screen.getByText('AA')).toBeInTheDocument();
  });

  it('KG→TON 换算：吨数列显示折算吨数；汇总只含可换算项', async () => {
    materialsFail = false;
    materialsPayload = [
      {
        itemId: 'rm-1',
        itemCode: 'RM001',
        itemName: '钢材',
        uom: '千克',
        requiredUom: 'KG',
        requiredQty: 2000,
        tonnage: 2,
        tonnageConvertible: true,
        reason: null,
        onHandQty: 500,
      },
    ];
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );

    await screen.findByText('钢材');
    // 2000 KG → 2.000 TON（行内折算吨数 + 合计各一处）
    expect(screen.getByText('2000.0000 KG')).toBeInTheDocument();
    expect(screen.getAllByText('2.000 TON').length).toBe(2);
    // 库存单位列
    expect(screen.getByText('千克')).toBeInTheDocument();
    // 合计 = 2.000 TON
    expect(screen.getByText(/预计用料吨数合计（仅可换算项）：/)).toBeInTheDocument();
    // 全部可换算 → 无未换算提示
    expect(screen.queryByText(/种原料未配置/)).not.toBeInTheDocument();
  });

  it('无换算原料：显示"未换算"（不造 0），汇总只含可换算项并明确提示未换算物料数', async () => {
    materialsFail = false;
    materialsPayload = [
      {
        itemId: 'rm-1',
        itemCode: 'RM001',
        itemName: '钢材',
        uom: '千克',
        requiredUom: 'KG',
        requiredQty: 2000,
        tonnage: 2,
        tonnageConvertible: true,
        reason: null,
        onHandQty: 500,
      },
      {
        itemId: 'rm-2',
        itemCode: 'RM002',
        itemName: '油漆',
        uom: '升',
        requiredUom: 'L',
        requiredQty: 10,
        tonnage: null,
        tonnageConvertible: false,
        reason: '缺少 L → TON 换算',
        onHandQty: 0,
      },
    ];
    render(
      <DensityProvider>
        <Page />
      </DensityProvider>,
    );

    await screen.findByText('钢材');
    // 未换算项显示"未换算"，绝不显示 0.000 TON
    expect(screen.getByText('未换算')).toBeInTheDocument();
    expect(screen.queryByText('0.000 TON')).not.toBeInTheDocument();
    // 汇总只含可换算项 = 2.000 TON（可换算行 + 合计各一处；未换算行不出现 0）
    expect(screen.getAllByText('2.000 TON').length).toBe(2);
    // 明确提示未换算物料数
    expect(screen.getByText(/另有 1 种原料未配置 → TON 换算，未计入合计/)).toBeInTheDocument();
    // 原单位需求列展示原单位
    expect(screen.getByText('10.0000 L')).toBeInTheDocument();
  });
});
