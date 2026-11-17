// 必须最先导入：顶部图标在其他重模块执行之前就开始注入
import { onHeaderEntryClick, startHeaderEntry } from './header-entry';
import { createApp, watchEffect } from 'vue';
import { GM_registerMenuCommand } from '$';
import './styles.css';
import App from './App.vue';
import { watchEditors } from './core/editor';
import { injectFastNav } from './core/fastnav';
import { settings } from './core/store';
import { collectSticker } from './core/collect';
import { startAutoSync } from './sync/engine';
import { loadOfficialStickers } from './core/official';
import { openPanel } from './core/ui';

function mountApp(): void {
  const host = document.createElement('div');
  host.id = 'nsh-app';
  host.className = 'nsh-scope';
  document.body.append(host);
  createApp(App).mount(host);
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
    btn.style.display = 'none';
    // 非官方图床的图片会询问是否转存，见 core/collect.ts
    void collectSticker(src, current.alt).catch(() => undefined);
  });
}

/** 界面入口开关：用 <html> 上的 class 控制显隐，切换即时生效 */
function bindEntryToggles(): void {
  watchEffect(() => {
    const c = document.documentElement.classList;
    c.toggle('nsh-hide-upload', !settings.showUploadButton);
    c.toggle('nsh-hide-sticker', !settings.showStickerButton);
    c.toggle('nsh-hide-fastnav', !settings.showFastNav);
    c.toggle('nsh-hide-header', !settings.showHeaderIcon);
    if (settings.showHeaderIcon) startHeaderEntry();
  });
}

/** 依赖 body 的部分在 DOM 就绪后启动 */
function bootBody(): void {
  mountApp();
  injectFastNav();
  watchEditors();
  setupCollect();
  startAutoSync();
  void loadOfficialStickers();
  GM_registerMenuCommand('⚙ 打开 NodeSeek 助手', () => openPanel());
  GM_registerMenuCommand('☁ 图床设置', () => openPanel('hosts'));
  GM_registerMenuCommand('☺ 表情包管理', () => openPanel('stickers'));
  GM_registerMenuCommand('⇅ 配置同步', () => openPanel('sync'));
}

function boot(): void {
  // 油猴与代理注入同时启用时只运行一份（DOM 标记在两个环境间共享）
  if (document.documentElement.dataset.nshLoaded) return;
  document.documentElement.dataset.nshLoaded = '1';
  // 入口开关与顶部图标在首帧前就位
  bindEntryToggles();
  onHeaderEntryClick(() => openPanel());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootBody, { once: true });
  else bootBody();
}

boot();
