import { describe, expect, it } from 'vitest';
import { DEV_KEY, loaderSource } from '../dev/dev-loader';

describe('开发加载器', () => {
  const src = loaderSource('http://127.0.0.1:5173', ['https://www.nodeseek.com/*']);

  it('生成的脚本语法正确（油猴注入失败会导致整个插件不可用）', () => {
    expect(() => new Function(src)).not.toThrow();
  });

  it('使用固定 key，并在 document-start 运行', () => {
    expect(src).toContain(JSON.stringify(DEV_KEY));
    expect(src).toMatch(/@run-at\s+document-start/);
    expect(src).toMatch(/@grant\s+GM_xmlhttpRequest/);
  });
});
