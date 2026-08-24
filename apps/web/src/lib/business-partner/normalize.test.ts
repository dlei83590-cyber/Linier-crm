import { describe, it, expect } from 'vitest';
import { normalizeUscc, isValidUscc, normalizeCompanyName, normalizePhone } from './normalize';

describe('normalizeUscc（Phase 2B — trim/去格式空格/大写）', () => {
  it('trim + 去合法格式空格 + 大写', () => {
    expect(normalizeUscc(' 9131 0000 ma1k 35l 88u ')).toBe('91310000MA1K35L88U');
    expect(normalizeUscc('91310000MA1K35L88U')).toBe('91310000MA1K35L88U');
  });
  it('多空格/制表符也折叠', () => {
    expect(normalizeUscc('9131\t0000\nMA1K35L88U')).toBe('91310000MA1K35L88U');
  });
  it('空串安全', () => {
    expect(normalizeUscc('')).toBe('');
    expect(normalizeUscc('   ')).toBe('');
  });
});

describe('isValidUscc（GB 32100-2015：18 位，不含 I/O/S/V/Z）', () => {
  it('合法 18 位通过', () => {
    expect(isValidUscc('91310000MA1K35L88U')).toBe(true);
  });
  it('长度不足 / 含禁用字母 I O S V Z 拒绝', () => {
    expect(isValidUscc('91310000MA1K35L88')).toBe(false);
    expect(isValidUscc('91310000MA1K35L88I')).toBe(false);
    expect(isValidUscc('91310000MA1K35L88O')).toBe(false);
    expect(isValidUscc('91310000MA1K35L88S')).toBe(false);
    expect(isValidUscc('91310000MA1K35L88V')).toBe(false);
    expect(isValidUscc('91310000MA1K35L88Z')).toBe(false);
  });
  it('小写 normalize 后合法（调用方须先 normalizeUscc）', () => {
    expect(isValidUscc(normalizeUscc('91310000ma1k35l88u'))).toBe(true);
  });
});

describe('normalizeCompanyName（NFKC + trim + collapse whitespace + Latin case 归一）', () => {
  it('全角转半角 + 折叠空格', () => {
    expect(normalizeCompanyName('ＡＢＣ　有　限　公　司')).toBe('abc 有 限 公 司');
  });
  it('保留法律名称组成部分（不删除 有限公司）', () => {
    expect(normalizeCompanyName('上海某某科技有限公司')).toBe('上海某某科技有限公司');
  });
  it('大小写归一', () => {
    expect(normalizeCompanyName('ABC Trading Co., Ltd.')).toBe('abc trading co., ltd.');
  });
  it('首尾空格 trim', () => {
    expect(normalizeCompanyName('  上海某某  ')).toBe('上海某某');
  });
});

describe('normalizePhone（去显示格式字符，保留 +86 国家码语义）', () => {
  it('去空格 / 短横线 / 括号', () => {
    expect(normalizePhone('138 1234 0000')).toBe('13812340000');
    expect(normalizePhone('021-1234-5678')).toBe('02112345678');
    expect(normalizePhone('（021）12345678')).toBe('02112345678');
    expect(normalizePhone('138-1234-0000')).toBe('13812340000');
  });
  it('保留 +86 语义（不剥离，避免国际/国内误报）', () => {
    expect(normalizePhone('+86 138 1234 0000')).toBe('+8613812340000');
    expect(normalizePhone('+8613812340000')).not.toBe('13812340000');
  });
  it('全角括号/数字 NFKC', () => {
    expect(normalizePhone('（０２１）１２３４５６７８')).toBe('02112345678');
  });
});
