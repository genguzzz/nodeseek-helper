import { describe, expect, it } from 'vitest';
// @ts-expect-error 构建脚本是 .mjs，无类型声明
import { NSH, PAGE } from '../scripts/build-proxy.mjs';

const page = new RegExp(PAGE as string);
const nsh = new RegExp(NSH as string);

describe('代理模块匹配规则', () => {
  it('不含引擎差异大的语法（前瞻 / 后顾断言）与逗号（Surge 用逗号分隔参数）', () => {
    for (const p of [PAGE, NSH] as string[]) {
      expect(p).not.toMatch(/\(\?[=!<]/);
      expect(p).not.toContain(',');
    }
  });

  it('匹配论坛页面', () => {
    for (const u of [
      'https://www.nodeseek.com/',
      'https://www.nodeseek.com/page-2',
      'https://www.nodeseek.com/post-472759-1',
      'https://www.nodeseek.com/post-472759-1?nshcheck=1',
      'https://www.nodeseek.com/categories/tech',
      'https://www.nodeseek.com/categories/photo-share/page-3',
      'https://www.nodeseek.com/space/67614',
      'https://www.nodeseek.com/notification',
      'https://www.nodeseek.com/new-discussion',
      'https://www.nodeseek.com/search?q=%E8%A1%A8%E6%83%85',
      'https://www.deepflood.com/post-123-1',
    ]) {
      expect(page.test(u), u).toBe(true);
    }
  });

  it('不匹配接口、静态资源、Cloudflare 校验与裸域名', () => {
    for (const u of [
      'https://www.nodeseek.com/api/statistics/notification',
      'https://www.nodeseek.com/static/image/sticker/ac/01.png',
      'https://www.nodeseek.com/assets/markdownEditor-DE42L09T.js',
      'https://www.nodeseek.com/cdn-cgi/challenge-platform/scripts/main.js',
      'https://www.nodeseek.com/__nsh/app.js',
      'https://www.nodeseek.com/signIn.html',
      'https://nodeseek.com/post-1-1',
      'http://www.nodeseek.com/post-1-1',
    ]) {
      expect(page.test(u), u).toBe(false);
    }
  });

  it('中转与注入脚本地址', () => {
    expect(nsh.test('https://www.nodeseek.com/__nsh/relay')).toBe(true);
    expect(nsh.test('https://www.nodeseek.com/__nsh/app.js?v=0.2.1')).toBe(true);
    expect(nsh.test('https://www.nodeseek.com/__nsh/other')).toBe(false);
  });
});

describe('Shadowrocket 模块', async () => {
  // @ts-expect-error 构建脚本是 .mjs，无类型声明
  const { outputs } = (await import('../scripts/build-proxy.mjs')) as { outputs: Record<string, string> };
  const mod = outputs['nodeseek-helper.module'];

  it('与 Surge 模块使用同一份脚本、同样的匹配规则与 MITM 域名', () => {
    const sg = outputs['nodeseek-helper.sgmodule'];
    const scriptOf = (s: string): string[] => [...s.matchAll(/script-path=(\S+)/g)].map((m) => m[1]);
    expect(scriptOf(mod)).toEqual(scriptOf(sg));
    expect(mod).toContain(`pattern=${PAGE as string},`);
    expect(mod).toContain(`pattern=${NSH as string},`);
    expect(mod).toMatch(/\[MITM\]\nhostname = %APPEND% www\.nodeseek\.com, www\.deepflood\.com/);
  });

  it('布尔参数写 true（不用 1），上传中转开启二进制模式', () => {
    expect(mod).not.toMatch(/=(1|0),/);
    expect(mod).toMatch(/nsh-relay = type=http-request,.*requires-body=true,binary-body-mode=true/);
    expect(mod).toMatch(/nsh-inject = type=http-response,.*requires-body=true/);
  });
});
