import { ICON_HELPER } from './icons';
import { openPanel, type PanelTab } from './ui';

const BTN_GAP = 40;
const MENU: { tab: PanelTab; label: string }[] = [
  { tab: 'stickers', label: '表情包管理' },
  { tab: 'hosts', label: '图床设置' },
  { tab: 'history', label: '上传记录' },
  { tab: 'general', label: '通用设置' },
];

/**
 * 在右下角 #fast-nav-button-group（回到顶部 / 返回 / 到底部）上方放置「NodeSeek 助手」按钮。
 * 原生按钮用 nth-last-child 绝对定位且会随滚动显隐，这里插到最前面并按可见按钮数动态计算 bottom，始终贴在最上方。
 */
export function injectFastNav(): void {
  if (document.querySelector('.nsh-fast-btn')) return;
  let group = document.getElementById('fast-nav-button-group');
  if (!group) {
    // 没有原生按钮组的页面（如首页列表）自建一个同位置的容器
    group = document.createElement('div');
    group.id = 'nsh-fast-nav';
    document.body.append(group);
  }
  const btn = document.createElement('div');
  btn.className = 'nav-item-btn nsh-fast-btn';
  btn.title = 'NodeSeek 助手';
  btn.innerHTML = ICON_HELPER;
  const menu = document.createElement('div');
  menu.className = 'nsh-fast-menu nsh-scope';
  for (const m of MENU) {
    const item = document.createElement('div');
    item.className = 'nsh-fast-menu-item';
    item.textContent = m.label;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.classList.remove('open');
      openPanel(m.tab);
    });
    menu.append(item);
  }
  btn.append(menu);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    btn.classList.toggle('open');
  });
  document.addEventListener('click', () => btn.classList.remove('open'));
  group.prepend(btn);
  const reposition = (): void => {
    // 原生按钮按 DOM 位置占固定槽位（nth-last-child：0/40/80px），与是否显示无关；放在最高可见槽位的上一格
    const natives = Array.from(group.children).filter((c) => c !== btn);
    let top = -1;
    natives.forEach((c, i) => {
      if (getComputedStyle(c).display !== 'none') top = Math.max(top, natives.length - 1 - i);
    });
    btn.style.bottom = `${(top + 1) * BTN_GAP}px`;
  };
  reposition();
  new MutationObserver(reposition).observe(group, { attributes: true, subtree: true, childList: true, attributeFilter: ['style', 'class'] });
  window.addEventListener('scroll', () => requestAnimationFrame(reposition), { passive: true });
}
