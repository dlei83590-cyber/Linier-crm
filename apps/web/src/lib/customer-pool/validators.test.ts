import { describe, it, expect } from 'vitest';
import { validatePoolScope, validateRule, isPartnerPoolEligible, POOL_RULE_FIELD_WHITELIST } from './validators';

describe('validatePoolScope（CTO OQ-1：REGION 字符串 EQ/IN，不建字典）', () => {
  it('GLOBAL → scopeValue 必须为空', () => {
    expect(validatePoolScope('GLOBAL', null).ok).toBe(true);
    expect(validatePoolScope('GLOBAL', '').ok).toBe(true);
    expect(validatePoolScope('GLOBAL', '华东').ok).toBe(false);
  });
  it('REGION/DEPARTMENT → scopeValue 必填', () => {
    expect(validatePoolScope('REGION', '华东').ok).toBe(true);
    expect(validatePoolScope('DEPARTMENT', 'dept-1').ok).toBe(true);
    expect(validatePoolScope('REGION', '').ok).toBe(false);
    expect(validatePoolScope('DEPARTMENT', null).ok).toBe(false);
  });
  it('非法 scopeType', () => {
    expect(validatePoolScope('TEAM', null).ok).toBe(false);
  });
});

describe('validateRule（FIELD_MATCH 白名单；INACTIVITY fail closed）', () => {
  it('FIELD_MATCH 合法 condition 通过', () => {
    expect(validateRule('FIELD_MATCH', 'ANY', [{ field: 'region', operator: 'EQ', value: '华东' }]).ok).toBe(true);
    expect(
      validateRule('FIELD_MATCH', 'ALL', [
        { field: 'type', operator: 'IN', value: ['CUSTOMER', 'BOTH'] },
        { field: 'isActive', operator: 'EQ', value: true },
      ]).ok,
    ).toBe(true);
  });
  it('INACTIVITY → POOL_RULE_SOURCE_UNAVAILABLE（Phase 3 前禁用）', () => {
    const v = validateRule('INACTIVITY', 'ANY', [{ field: 'region', operator: 'EQ', value: '华东' }]);
    expect(v.ok).toBe(false);
    expect(v.errorCode).toBe('POOL_RULE_SOURCE_UNAVAILABLE');
  });
  it('非白名单字段拒绝（fail closed）', () => {
    const v = validateRule('FIELD_MATCH', 'ANY', [{ field: 'ownerId', operator: 'EQ', value: 'u-1' }]);
    expect(v.ok).toBe(false);
    expect(v.errorCode).toBe('POOL_RULE_INVALID');
  });
  it('非法 operator 拒绝（禁止表达式/eval）', () => {
    expect(validateRule('FIELD_MATCH', 'ANY', [{ field: 'region', operator: 'LIKE', value: '华' }]).ok).toBe(false);
  });
  it('空 condition / 非法 matchMode 拒绝', () => {
    expect(validateRule('FIELD_MATCH', 'ANY', []).ok).toBe(false);
    expect(validateRule('FIELD_MATCH', 'SOME', [{ field: 'region', operator: 'EQ', value: '华东' }]).ok).toBe(false);
  });
  it('白名单仅 type/region/industry/sourceChannel/isActive', () => {
    expect(POOL_RULE_FIELD_WHITELIST).toEqual(['type', 'region', 'industry', 'sourceChannel', 'isActive']);
  });
});

describe('isPartnerPoolEligible（入池资格：CUSTOMER/BOTH）', () => {
  it('CUSTOMER/BOTH 可入池；SUPPLIER/null 不可', () => {
    expect(isPartnerPoolEligible('CUSTOMER')).toBe(true);
    expect(isPartnerPoolEligible('BOTH')).toBe(true);
    expect(isPartnerPoolEligible('SUPPLIER')).toBe(false);
    expect(isPartnerPoolEligible(null)).toBe(false);
    expect(isPartnerPoolEligible(undefined)).toBe(false);
  });
});
