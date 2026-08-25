import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// jest-dom matchers 类型增强（vitest entry：runtime + TS Assertion 接口）
import '@testing-library/jest-dom/vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'qt-1' }),
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

import Page from '@/app/(dashboard)/sales/quotations/[id]/print/page';

/** CC-05 打印视图 fixture：客户联系/地址 + 销售负责人 + 行单位（GET /api/quotations/:id 投影） */
const detail = {
  id: 'qt-1',
  code: 'QT-2026-0001',
  quoteDate: '2026-01-01T00:00:00.000Z',
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-01-31T00:00:00.000Z',
  currency: 'CNY',
  subtotal: '100000',
  taxAmount: '13000',
  totalAmount: '113000',
  paymentTerm: 'NET30',
  remark: '含税含运费，交货期 30 天',
  customer: {
    id: 'c-1',
    code: 'C001',
    name: '客户A',
    fullName: '客户A有限公司',
    contactPerson: '王经理',
    phone: '13800000000',
    email: 'wang@example.com',
    address: '上海市浦东新区某路 100 号',
    ownerships: [{ owner: { id: 'u-9', name: '张销售', email: 'zhang@example.com' } }],
  },
  lines: [
    {
      id: 'l-1',
      lineNo: 10,
      description: '线性模组',
      quantity: '100.0000',
      unitPrice: '1234.568',
      lineAmount: '123456.80',
      item: { id: 'i-1', code: 'FG-001', name: '线性模组', model: 'SMH45A', spec: '行程 450mm' },
      uom: { id: 'uom-1', code: 'PC', name: '件', symbol: '件' },
    },
  ],
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

describe('Quotation Print View — CC-05 报价固定打印模板', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(mockResponse(200, envelope(detail))));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'print').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('渲染报价行（编码/名称/规格/数量/单位/单价/金额）与汇总金额、条款、客户、销售负责人', async () => {
    render(<Page />);

    await screen.findByText('QT-2026-0001');
    // 客户信息
    expect(screen.getByText('客户A')).toBeInTheDocument();
    expect(screen.getByText('王经理')).toBeInTheDocument();
    expect(screen.getByText('13800000000')).toBeInTheDocument();
    expect(screen.getByText('上海市浦东新区某路 100 号')).toBeInTheDocument();
    // 报价行
    expect(screen.getByText('FG-001')).toBeInTheDocument();
    expect(screen.getAllByText('线性模组').length).toBeGreaterThan(0);
    // 规格 = item.model / item.spec 拼接（SMH45A / 行程 450mm）
    expect(screen.getByText('SMH45A / 行程 450mm')).toBeInTheDocument();
    // 数量 Decimal 尾部零修剪 + 金额千分位格式化
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('1,234.57')).toBeInTheDocument();
    expect(screen.getByText('123,456.80')).toBeInTheDocument();
    // 汇总
    expect(screen.getByText('小计（未税）')).toBeInTheDocument();
    expect(screen.getByText('100,000.00')).toBeInTheDocument();
    expect(screen.getByText('13,000.00')).toBeInTheDocument();
    expect(screen.getByText('113,000.00')).toBeInTheDocument();
    // 条款 / 备注
    expect(screen.getByText('NET30')).toBeInTheDocument();
    expect(screen.getByText('含税含运费，交货期 30 天')).toBeInTheDocument();
    // 底部：销售负责人（客户归属 SSOT 派生）
    expect(screen.getByText('销售负责人')).toBeInTheDocument();
    expect(screen.getByText('张销售')).toBeInTheDocument();
  });

  it('无明细行 → 显示空态文案，汇总金额仍按 0 格式化展示', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, envelope({ ...detail, lines: [], subtotal: '0', taxAmount: '0', totalAmount: '0' })),
    );

    render(<Page />);

    await screen.findByText(/暂无明细行/);
    // 小计/税额/含税总金额三处 0.00
    expect(screen.getAllByText('0.00').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('报价明细（0 项）')).toBeInTheDocument();
  });

  it('打印按钮调用 window.print（浏览器打印，无 PDF 引擎）', async () => {
    render(<Page />);

    await screen.findByText('QT-2026-0001');
    fireEvent.click(screen.getByRole('button', { name: '打印报价单' }));
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('接口失败 → 真实错误面板 + 返回列表链接（不伪装成空态）', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, failEnvelope('INTERNAL_ERROR', '数据库查询失败')));

    render(<Page />);

    // ErrorPanel：500 → 「系统错误」标题 + 后端 message + 错误码（不伪装成空态）
    await screen.findByText(/系统错误/);
    expect(screen.getByText(/数据库查询失败/)).toBeInTheDocument();
    expect(screen.getByText(/INTERNAL_ERROR/)).toBeInTheDocument();
    expect(screen.queryByText(/暂无明细行/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /返回报价列表/ })).toBeInTheDocument();
  });
});
