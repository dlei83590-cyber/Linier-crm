import { describe, it, expect } from 'vitest';
import { evaluateCustomerPoolRules, type PartnerPoolSnapshot, type ActivePoolRuleView } from './rule-evaluator';

function snap(partial: Partial<PartnerPoolSnapshot> = {}): PartnerPoolSnapshot {
  return { id: 'bp-1', type: 'CUSTOMER', region: '华东', industry: '机械', sourceChannel: '展会', isActive: true, deletedAt: null, ...partial };
}

function rule(partial: Partial<ActivePoolRuleView> = {}): ActivePoolRuleView {
  return {
    poolId: 'pool-1',
    poolCode: 'POOL-1',
    poolName: '池1',
    poolScopeType: 'GLOBAL',
    poolScopeValue: null,
    ruleId: 'rule-1',
    ruleType: 'FIELD_MATCH',
    matchMode: 'ANY',
    condition: [{ field: 'region', operator: 'EQ', value: '华东' }],
    priority: 10,
    ...partial,
  };
}

describe('evaluateCustomerPoolRules（Phase 2C-2 纯确定性 matcher）', () => {
  it('前置：SUPPLIER / deletedAt 非空 → NO_MATCH（即使规则命中）', () => {
    const r = rule({ condition: [{ field: 'type', operator: 'EQ', value: 'SUPPLIER' }] });
    expect(evaluateCustomerPoolRules(snap({ type: 'SUPPLIER' }), [r]).status).toBe('NO_MATCH');
    expect(evaluateCustomerPoolRules(snap({ deletedAt: new Date() }), [r]).status).toBe('NO_MATCH');
  });

  it('EQ 命中 → MATCH + winner', () => {
    const out = evaluateCustomerPoolRules(snap(), [rule()]);
    expect(out.status).toBe('MATCH');
    if (out.status === 'MATCH') {
      expect(out.winner.poolId).toBe('pool-1');
      expect(out.winner.priority).toBe(10);
    }
  });

  it('IN 命中（type in CUSTOMER/BOTH）', () => {
    const r = rule({ condition: [{ field: 'type', operator: 'IN', value: ['CUSTOMER', 'BOTH'] }] });
    expect(evaluateCustomerPoolRules(snap(), [r]).status).toBe('MATCH');
    expect(evaluateCustomerPoolRules(snap({ type: 'BOTH' }), [r]).status).toBe('MATCH');
    expect(evaluateCustomerPoolRules(snap({ type: 'SUPPLIER' }), [r]).status).toBe('NO_MATCH');
  });

  it('isActive EQ 命中/不命中', () => {
    const r = rule({ condition: [{ field: 'isActive', operator: 'EQ', value: true }] });
    expect(evaluateCustomerPoolRules(snap(), [r]).status).toBe('MATCH');
    expect(evaluateCustomerPoolRules(snap({ isActive: false }), [r]).status).toBe('NO_MATCH');
  });

  it('ALL 模式：全部条件满足才命中', () => {
    const r = rule({
      matchMode: 'ALL',
      condition: [
        { field: 'region', operator: 'EQ', value: '华东' },
        { field: 'industry', operator: 'EQ', value: '机械' },
      ],
    });
    expect(evaluateCustomerPoolRules(snap(), [r]).status).toBe('MATCH');
    const r2 = rule({
      matchMode: 'ALL',
      condition: [
        { field: 'region', operator: 'EQ', value: '华东' },
        { field: 'industry', operator: 'EQ', value: '化工' },
      ],
    });
    expect(evaluateCustomerPoolRules(snap(), [r2]).status).toBe('NO_MATCH');
  });

  it('ANY 模式：任一命中即可', () => {
    const r = rule({
      matchMode: 'ANY',
      condition: [
        { field: 'region', operator: 'EQ', value: '华南' },
        { field: 'industry', operator: 'EQ', value: '机械' },
      ],
    });
    expect(evaluateCustomerPoolRules(snap(), [r]).status).toBe('MATCH');
  });

  it('多池：priority 最高者获胜', () => {
    const out = evaluateCustomerPoolRules(snap(), [
      rule({ poolId: 'pool-a', priority: 5, condition: [{ field: 'region', operator: 'EQ', value: '华东' }] }),
      rule({ poolId: 'pool-b', priority: 20, condition: [{ field: 'region', operator: 'EQ', value: '华东' }] }),
    ]);
    expect(out.status).toBe('MATCH');
    if (out.status === 'MATCH') expect(out.winner.poolId).toBe('pool-b');
  });

  it('同 priority → AMBIGUOUS（NO AUTO ENTRY，禁止随机选池）', () => {
    const out = evaluateCustomerPoolRules(snap(), [
      rule({ poolId: 'pool-a', priority: 10 }),
      rule({ poolId: 'pool-b', priority: 10 }),
    ]);
    expect(out.status).toBe('AMBIGUOUS');
    if (out.status === 'AMBIGUOUS') expect(out.ties.length).toBe(2);
  });

  it('REGION scope 池：BP.region 精确匹配才评估；DEPARTMENT scope 池自动评估跳过', () => {
    const reg = rule({ poolScopeType: 'REGION', poolScopeValue: '华东' });
    expect(evaluateCustomerPoolRules(snap(), [reg]).status).toBe('MATCH');
    expect(evaluateCustomerPoolRules(snap({ region: '华南' }), [reg]).status).toBe('NO_MATCH');

    const dept = rule({ poolScopeType: 'DEPARTMENT', poolScopeValue: 'dept-1' });
    expect(evaluateCustomerPoolRules(snap(), [dept]).status).toBe('NO_MATCH');
  });

  it('无命中 → NO_MATCH', () => {
    const r = rule({ condition: [{ field: 'region', operator: 'EQ', value: '华南' }] });
    expect(evaluateCustomerPoolRules(snap(), [r]).status).toBe('NO_MATCH');
    expect(evaluateCustomerPoolRules(snap(), []).status).toBe('NO_MATCH');
  });

  it('INACTIVITY 规则防御跳过（不应存在）', () => {
    const r = rule({ ruleType: 'INACTIVITY' });
    expect(evaluateCustomerPoolRules(snap(), [r]).status).toBe('NO_MATCH');
  });
});
