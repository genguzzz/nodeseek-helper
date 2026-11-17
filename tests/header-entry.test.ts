import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HEADER = '<header><div id="nsk-head" class="nsk-container"><form class="search-box"></form><div class="color-theme-switcher"><svg></svg></div></div></header>';

async function load(): Promise<typeof import('../src/header-entry')> {
  vi.resetModules();
  return import('../src/header-entry');
}

/** 打开顶部图标设置（默认关闭） */
const enable = (): void => localStorage.setItem('nsh:nsh_settings_v1', JSON.stringify({ showHeaderIcon: true }));

beforeEach(enable);

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

  it('默认关闭：没有设置或设置为关闭时都不插入；运行中再打开会插入，且不会重复插入', async () => {
    localStorage.clear();
    document.body.innerHTML = HEADER;
    let mod = await load();
    expect(document.querySelector('.nsh-head-entry')).toBeNull();
    localStorage.setItem('nsh:nsh_settings_v1', JSON.stringify({ showHeaderIcon: false }));
    mod = await load();
    expect(document.querySelector('.nsh-head-entry')).toBeNull();
    mod.startHeaderEntry();
    mod.startHeaderEntry();
    expect(document.querySelectorAll('.nsh-head-entry')).toHaveLength(1);

    document.querySelector('.nsh-head-entry')?.remove();
    enable();
    await load();
    await load();
    expect(document.querySelectorAll('.nsh-head-entry')).toHaveLength(1);
  });
});

describe('顶部导航入口：手机端有通知铃铛时放在铃铛左边', () => {
  it('复制铃铛的外壳（列表项、class、作用域属性、图标样式），换成我们的图标，去掉未读数', async () => {
    document.body.innerHTML =
      '<header><div id="nsk-head"><ul class="nav-menu"><li class="m-item" data-v-1><a href="/notification" class="bell-link" data-v-1><svg class="iconpark-icon" style="width:20px;height:20px" data-v-1><use href="#remind-6nce9p47"></use></svg><span class="notify-count">4</span></a></li></ul><div class="color-theme-switcher"><svg></svg></div></div></header>';
    const mod = await load();
    const bellLi = document.querySelector('a[href="/notification"]')!.closest('li')!;
    const entry = bellLi.previousElementSibling as HTMLElement;
    expect(entry.classList.contains('nsh-head-entry')).toBe(true);
    expect(entry.tagName).toBe('LI');
    expect(entry.classList.contains('m-item')).toBe(true);
    expect(entry.hasAttribute('data-v-1')).toBe(true);
    const svg = entry.querySelector('svg')!;
    expect(svg.getAttribute('class')).toBe('iconpark-icon');
    expect(svg.getAttribute('style')).toContain('width:20px');
    expect(entry.querySelector('use')!.getAttribute('href')).toBe('#nsh-sticker');
    expect(entry.querySelector('.notify-count')).toBeNull();
    expect(entry.textContent?.trim()).toBe('');
    expect(entry.querySelector('a')!.getAttribute('href')).toBe('javascript:void(0)');
    // 图标 symbol 已注册进页面
    expect(document.getElementById('nsh-sticker')?.tagName.toLowerCase()).toBe('symbol');
    // 点击打开面板，不跳转通知页
    const fn = vi.fn();
    mod.onHeaderEntryClick(fn);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    entry.querySelector('a')!.dispatchEvent(ev);
    expect(fn).toHaveBeenCalledOnce();
    expect(ev.defaultPrevented).toBe(true);
    // 原来的铃铛不受影响
    expect(bellLi.querySelector('.notify-count')?.textContent).toBe('4');
    expect(document.querySelectorAll('.nsh-head-entry')).toHaveLength(1);
  });

  it('铃铛绝对定位：克隆同样绝对定位，往左让出铃铛的宽度，垂直位置相同', async () => {
    document.body.innerHTML =
      '<header><div id="nsk-head"><a class="bell" href="/notification" style="position:absolute;right:40px;top:12px"><svg><use href="#remind"></use></svg></a><div class="color-theme-switcher"><svg></svg></div></div></header>';
    await load();
    const bell = document.querySelector('a.bell[href="/notification"]') as HTMLElement;
    const entry = bell.previousElementSibling as HTMLElement;
    expect(entry.classList.contains('nsh-head-entry')).toBe(true);
    expect(entry.style.position).toBe('absolute');
    expect(parseFloat(entry.style.right)).toBeGreaterThanOrEqual(40);
    expect(entry.style.top).toBe('12px');
  });

  it('没有铃铛（电脑端 / 未登录）：在日 / 夜间按钮左边，图标写法与它相同', async () => {
    document.body.innerHTML = HEADER;
    await load();
    const entry = document.querySelector<HTMLElement>('.nsh-head-entry');
    expect(entry?.nextElementSibling?.classList.contains('color-theme-switcher')).toBe(true);
    expect(entry?.style.right).toBe('37px');
    expect(entry?.querySelector('svg')?.getAttribute('class')).toBe('iconpark-icon');
    expect(entry?.querySelector('use')?.getAttribute('href')).toBe('#nsh-sticker');
  });
});

it('页面加载后铃铛才由前端渲染出来：挪到铃铛左边', async () => {
  document.body.innerHTML = '<header><div id="nsk-head"><ul class="nav-menu"></ul><div class="color-theme-switcher"><svg></svg></div></div></header>';
  await load();
  expect(document.querySelector('.nsh-head-entry')?.nextElementSibling?.classList.contains('color-theme-switcher')).toBe(true);
  document.querySelector('.nav-menu')!.innerHTML = '<li><a href="/notification"><svg><use href="#remind"></use></svg></a></li>';
  await new Promise((r) => setTimeout(r, 0));
  const bellLi = document.querySelector('a[href="/notification"]')!.closest('li')!;
  expect(bellLi.previousElementSibling?.classList.contains('nsh-head-entry')).toBe(true);
  expect(document.querySelectorAll('.nsh-head-entry')).toHaveLength(1);
});
