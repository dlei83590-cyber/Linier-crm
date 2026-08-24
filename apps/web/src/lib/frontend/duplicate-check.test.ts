import { describe, it, expect } from 'vitest';
import {
  computeDuplicateUiState,
  isStaleDuplicateResult,
  shouldRunDuplicateCheck,
  withAcknowledgment,
  duplicateReasonLabel,
} from './duplicate-check';

describe('computeDuplicateUiState（24. EXACT 阻断 / POTENTIAL warning）', () => {
  it('EXACT → blocking=true，acknowledgement 不能解除阻断', () => {
    expect(computeDuplicateUiState('EXACT', false).blocking).toBe(true);
    expect(computeDuplicateUiState('EXACT', true).blocking).toBe(true);
    expect(computeDuplicateUiState('EXACT', false).visible).toBe(true);
  });
  it('POTENTIAL → warning + 可确认（不阻断）', () => {
    const s = computeDuplicateUiState('POTENTIAL', false);
    expect(s.warning).toBe(true);
    expect(s.blocking).toBe(false);
    expect(s.visible).toBe(true);
    expect(s.confirmed).toBe(false);
  });
  it('POTENTIAL 确认后 confirmed=true', () => {
    expect(computeDuplicateUiState('POTENTIAL', true).confirmed).toBe(true);
  });
  it('NONE / 未查 → 无打扰（visible=false）', () => {
    expect(computeDuplicateUiState('NONE', false).visible).toBe(false);
    expect(computeDuplicateUiState(undefined, false).visible).toBe(false);
  });
});

describe('isStaleDuplicateResult（23. UI stale request 不覆盖新结果）', () => {
  it('旧序号响应视为 stale，拒绝覆盖', () => {
    expect(isStaleDuplicateResult(1, 3)).toBe(true);
    expect(isStaleDuplicateResult(3, 3)).toBe(false);
    expect(isStaleDuplicateResult(4, 3)).toBe(false);
  });
});

describe('withAcknowledgment（25. POTENTIAL 确认后携带 duplicateAcknowledged=true）', () => {
  it('确认 → payload 带 duplicateAcknowledged=true', () => {
    const p = withAcknowledgment({ code: 'X', name: 'Y' }, true);
    expect(p.duplicateAcknowledged).toBe(true);
  });
  it('未确认 → payload 不带 ack 字段', () => {
    const p = withAcknowledgment({ code: 'X', name: 'Y' }, false);
    expect('duplicateAcknowledged' in p).toBe(false);
  });
});

describe('duplicateReasonLabel（matchReasons 中文解释）', () => {
  it('已知 reason 中文解释', () => {
    expect(duplicateReasonLabel('USCC_EXACT')).toContain('统一社会信用代码');
    expect(duplicateReasonLabel('NAME_EXACT')).toContain('企业名称');
    expect(duplicateReasonLabel('CONTACT_MOBILE_EXACT')).toContain('联系人手机');
  });
  it('未知 reason 原样返回', () => {
    expect(duplicateReasonLabel('UNKNOWN_REASON')).toBe('UNKNOWN_REASON');
  });
});

describe('shouldRunDuplicateCheck（触发字段 name/uscc/phone）', () => {
  it('任一非空即触发', () => {
    expect(shouldRunDuplicateCheck('公司', '', '')).toBe(true);
    expect(shouldRunDuplicateCheck('', '9131', '')).toBe(true);
    expect(shouldRunDuplicateCheck('', '', '138')).toBe(true);
  });
  it('全空不触发', () => {
    expect(shouldRunDuplicateCheck('', '', '')).toBe(false);
  });
});
