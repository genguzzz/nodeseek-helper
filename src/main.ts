import { createApp } from 'vue';
import { GM_registerMenuCommand } from '$';
import './styles.css';
import App from './App.vue';
import { watchEditors } from './core/editor';
import { injectFastNav } from './core/fastnav';
import { addStickers, DEFAULT_GROUP_ID, settings } from './core/store';
import { openPanel, toast } from './core/ui';
import { HANABI_ICON_MONO } from './core/packs';

function mountApp(): void {
  const host = document.createElement('div');
  host.id = 'nsh-app';
  host.className = 'nsh-scope';
  document.body.append(host);
  createApp(App).mount(host);
}

/** 顶部导航栏入口，放在主题切换按钮旁边 */
function injectHeaderEntry(): void {
  const anchor = document.querySelector('#nsk-head .color-theme-switcher');
  if (!anchor || document.querySelector('.nsh-head-entry')) return;
  const btn = document.createElement('div');
  btn.className = 'nsh-head-entry';
  btn.title = 'NodeSeek 助手：图床与表情包';
  btn.innerHTML = HANABI_ICON_MONO;
  btn.addEventListener('click', () => openPanel());
  anchor.before(btn);
}

/** 帖子里悬浮图片时出现「收藏为表情」 */
function setupCollect(): void {
  const btn = document.createElement('button');
  btn.className = 'nsh-collect-btn';
  btn.innerHTML = '★ 收藏为表情';
  btn.style.display = 'none';
  document.body.append(btn);
  let current: HTMLImageElement | null = null;
  let hideTimer = 0;
  const hide = (): void => {
    hideTimer = window.setTimeout(() => {
      btn.style.display = 'none';
      current = null;
    }, 180);
  };
  document.addEventListener('mouseover', (e) => {
    const img = (e.target as Element).closest?.('.post-content img') as HTMLImageElement | null;
    if (!settings.collectFromPost || !img || img.closest('.md-editor, .nsh-scope') || img.width < 24) return;
    clearTimeout(hideTimer);
    current = img;
    const r = img.getBoundingClientRect();
    btn.style.display = 'inline-flex';
    btn.style.top = `${Math.max(4, r.top + 4)}px`;
    btn.style.left = `${Math.max(4, r.right - btn.offsetWidth - 4)}px`;
  });
  document.addEventListener('mouseout', (e) => {
    if ((e.target as Element) === current) hide();
  });
  window.addEventListener('scroll', () => (btn.style.display = 'none'), { passive: true });
  btn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  btn.addEventListener('mouseleave', hide);
  btn.addEventListener('click', () => {
    if (!current) return;
    const src = current.currentSrc || current.src;
    const r = addStickers([{ url: src, name: current.alt && current.alt !== 'image' ? current.alt : undefined } as { url: string; name?: string }], DEFAULT_GROUP_ID);
    toast(r.added ? '已收藏到「默认」分组' : '表情库里已经有它了', r.added ? 'success' : 'info');
    btn.style.display = 'none';
  });
}

function boot(): void {
  // 油猴与代理注入同时启用时只运行一份（DOM 标记在两个环境间共享）
  if (document.documentElement.dataset.nshLoaded) return;
  document.documentElement.dataset.nshLoaded = '1';
  mountApp();
  injectHeaderEntry();
  injectFastNav();
  watchEditors();
  setupCollect();
  GM_registerMenuCommand('⚙ 打开 NodeSeek 助手', () => openPanel());
  GM_registerMenuCommand('☁ 图床设置', () => openPanel('hosts'));
  GM_registerMenuCommand('☺ 表情包管理', () => openPanel('stickers'));
}

boot();
