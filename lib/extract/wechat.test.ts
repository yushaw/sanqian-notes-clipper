import { describe, expect, it } from 'vitest';
import { isWeChatArticleUrl, publishedFromPageScripts, nicknameFromPageScripts } from './wechat';

describe('isWeChatArticleUrl', () => {
  it('matches both article URL forms', () => {
    expect(isWeChatArticleUrl('https://mp.weixin.qq.com/s/iFviquGY-kCn13URoJQ5tg')).toBe(true);
    expect(isWeChatArticleUrl('https://mp.weixin.qq.com/s?__biz=MzA3&mid=1&idx=1&sn=abc')).toBe(true);
  });

  it('rejects other wechat pages and hosts', () => {
    expect(isWeChatArticleUrl('https://mp.weixin.qq.com/')).toBe(false);
    expect(isWeChatArticleUrl('https://mp.weixin.qq.com/mp/homepage?__biz=x')).toBe(false);
    expect(isWeChatArticleUrl('https://weixin.qq.com/s/abc')).toBe(false);
    expect(isWeChatArticleUrl('not a url')).toBe(false);
  });
});

describe('publishedFromPageScripts', () => {
  it('reads the epoch-seconds ct variable', () => {
    expect(publishedFromPageScripts(['var biz = "x";', 'var ct = "1706846400";'])).toBe('2024-02-02');
    expect(publishedFromPageScripts(['var ct = 1706846400;'])).toBe('2024-02-02');
  });

  it('returns undefined when absent', () => {
    expect(publishedFromPageScripts(['var other = "1";'])).toBeUndefined();
    expect(publishedFromPageScripts([])).toBeUndefined();
  });
});

describe('nicknameFromPageScripts', () => {
  it('reads the account name with and without htmlDecode', () => {
    expect(nicknameFromPageScripts(['var nickname = htmlDecode("MDPI化学材料");'])).toBe('MDPI化学材料');
    expect(nicknameFromPageScripts(['var nickname = "某公众号";'])).toBe('某公众号');
  });

  it('decodes HTML entities and unescapes embedded quotes', () => {
    expect(nicknameFromPageScripts(['var nickname = htmlDecode("M&amp;A观察");'])).toBe('M&A观察');
    expect(nicknameFromPageScripts(['var nickname = htmlDecode("说\\"话\\"号");'])).toBe('说"话"号');
  });

  it('returns undefined when absent', () => {
    expect(nicknameFromPageScripts(['var user_name = "gh_123";'])).toBeUndefined();
  });
});
