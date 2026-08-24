import { describe, it, expect } from 'vitest';
import {
  buildContactCreatePayload,
  buildContactEditPayload,
  buildSetPrimaryPayload,
  excludeSelf,
  buildSpecialDatePayload,
} from './workspace-helpers';

/**
 * 2A-2 前端契约（CTO Directive §12）：锁定关键 payload 与过滤逻辑。
 * 不重复测试 Backend 已锁定的 2/29 算法。
 */
describe('2A-2 联系人 Workspace 前端契约', () => {
  it('新建 payload 含 BusinessPartner 字段 + 可空字段转 null（非空字符串）', () => {
    const p = buildContactCreatePayload({
      name: '张三', title: '采购经理', mobile: '13800000000', phone: ' ', isPrimary: true,
    });
    expect(p.name).toBe('张三');
    expect(p.title).toBe('采购经理');
    expect(p.mobile).toBe('13800000000');
    expect(p.phone).toBeNull(); // 空白转 null
    expect(p.isPrimary).toBe(true);
  });

  it('编辑 payload 带 version（CAS）', () => {
    const p = buildContactEditPayload({ name: '李四' }, 7);
    expect(p.version).toBe(7);
    expect(p.name).toBe('李四');
  });

  it('设为主联系人：只提交 isPrimary=true，不携带批量改其他联系人的字段', () => {
    const p = buildSetPrimaryPayload(3);
    expect(p).toEqual({ version: 3, isPrimary: true });
    expect(Object.keys(p)).not.toContain('partnerId');
    expect(Object.keys(p)).not.toContain('contacts');
  });

  it('关系 target selector 排除自己', () => {
    const opts = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
    expect(excludeSelf(opts, 'c2').map((o) => o.id)).toEqual(['c1', 'c3']);
  });

  it('特殊日期 payload 直接透传 recurrence（NONE|YEARLY）', () => {
    const p = buildSpecialDatePayload({ type: 'BIRTHDAY', date: '1990-09-20', recurrence: 'YEARLY', remindDaysBefore: 7 });
    expect(p.type).toBe('BIRTHDAY');
    expect(p.recurrence).toBe('YEARLY');
    expect(p.remindDaysBefore).toBe(7);
    expect(p.reminderEnabled).toBe(true);
  });
});
