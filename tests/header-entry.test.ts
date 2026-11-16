import { afterEach, describe, expect, it, vi } from 'vitest';

const HEADER = '<header><div id="nsk-head" class="nsk-container"><form class="search-box"></form><div class="color-theme-switcher"><svg></svg></div></div></header>';

async function load(): Promise<typeof import('../src/header-entry')> {
  vi.resetModules();
  return import('../src/header-entry');
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('顶部导航入口', () => {
  it('导航栏已存在：导入时立即插到日 / 夜间按钮左边，点击走注册的回调', async () => {
    document.body.innerHTML = HEADER;
    const mod = await load();
    const btn = document.querySelector<HTMLElement>('.nsh-head-entry');
    expect(btn).not.toBeNull();
    expect(btn?.nextElementSibling?.classList.contains('color-theme-switcher')).toBe(true);
    // 行内样式，不依赖插件样式表
    expect(btn?.style.position).toBe('absolute');
    expect(btn?.style.right).toBe('37px');
    const fn = vi.fn();
    mod.onHeaderEntryClick(fn);
    btn?.click();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('导航栏稍后才解析出来：解析到主题按钮的同一轮立即插入', async () => {
    await load();
    expect(document.querySelector('.nsh-head-entry')).toBeNull();
    document.body.innerHTML = HEADER;
    await Promise.resolve(); // MutationObserver 回调是微任务，在下一帧绘制之前
    expect(document.querySelector('.nsh-head-entry')).not.toBeNull();
  });

  it('设置里关闭了顶部图标：不插入，也不会重复插入', async () => {
    localStorage.setItem('nsh:nsh_settings_v1', JSON.stringify({ showHeaderEntry: false }));
    document.body.innerHTML = HEADER;
    await load();
    expect(document.querySelector('.nsh-head-entry')).toBeNull();

    localStorage.clear();
    await load();
    await load();
    expect(document.querySelectorAll('.nsh-head-entry')).toHaveLength(1);
  });
});
