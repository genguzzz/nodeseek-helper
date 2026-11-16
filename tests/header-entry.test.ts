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

describe('顶部导航入口：手机端有通知铃铛时放在铃铛左边', () => {
  it('铃铛在列表项里：包一层同样的 li，紧挨在铃铛前面', async () => {
    document.body.innerHTML =
      '<header><div id="nsk-head"><ul class="nav-menu"><li class="m-item" data-v-1><a href="/notification"><svg style="width:20px;height:20px"><use href="#remind-6nce9p47"></use></svg></a></li></ul><div class="color-theme-switcher"><svg></svg></div></div></header>';
    await load();
    const bellLi = document.querySelector('a[href="/notification"]')?.closest('li');
    const prev = bellLi?.previousElementSibling as HTMLElement;
    expect(prev?.classList.contains('nsh-head-entry-li')).toBe(true);
    expect(prev?.classList.contains('m-item')).toBe(true);
    expect(prev?.hasAttribute('data-v-1')).toBe(true);
    expect(prev?.querySelector('.nsh-head-entry')).not.toBeNull();
    expect(document.querySelectorAll('.nsh-head-entry')).toHaveLength(1);
  });

  it('铃铛绝对定位：同样绝对定位，紧挨在铃铛左边', async () => {
    document.body.innerHTML =
      '<header><div id="nsk-head"><a class="bell" href="/notification" style="position:absolute;right:40px;top:12px"><svg><use href="#remind"></use></svg></a><div class="color-theme-switcher"><svg></svg></div></div></header>';
    await load();
    const bell = document.querySelector('.bell') as HTMLElement;
    const btn = bell.previousElementSibling as HTMLElement;
    expect(btn.classList.contains('nsh-head-entry')).toBe(true);
    expect(btn.style.position).toBe('absolute');
    expect(parseFloat(btn.style.right)).toBeGreaterThanOrEqual(40); // 铃铛的 right + 铃铛宽度
    expect(btn.style.top).toBe('12px');
  });

  it('没有铃铛（电脑端 / 未登录）：仍在日 / 夜间按钮左边', async () => {
    document.body.innerHTML = HEADER;
    await load();
    const btn = document.querySelector<HTMLElement>('.nsh-head-entry');
    expect(btn?.nextElementSibling?.classList.contains('color-theme-switcher')).toBe(true);
    expect(btn?.style.right).toBe('37px');
  });
});

it('页面加载后铃铛才由前端渲染出来：挪到铃铛左边', async () => {
  document.body.innerHTML = '<header><div id="nsk-head"><ul class="nav-menu"></ul><div class="color-theme-switcher"><svg></svg></div></div></header>';
  await load();
  expect(document.querySelector('.nsh-head-entry')?.nextElementSibling?.classList.contains('color-theme-switcher')).toBe(true);
  document.querySelector('.nav-menu')!.innerHTML = '<li><a href="/notification"><svg><use href="#remind"></use></svg></a></li>';
  await new Promise((r) => setTimeout(r, 0));
  const bellLi = document.querySelector('a[href="/notification"]')!.closest('li')!;
  expect(bellLi.previousElementSibling?.querySelector('.nsh-head-entry')).not.toBeNull();
  expect(document.querySelectorAll('.nsh-head-entry')).toHaveLength(1);
});
