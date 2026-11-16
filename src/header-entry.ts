/**
 * 顶部导航入口（日 / 夜间切换按钮左边的笑脸贴纸图标）。
 *
 * 单独成模块并在 main.ts 最先导入：只依赖图标字符串与 GM_getValue，
 * 在 Vue 组件、表情数据、GIF 库等重模块执行之前就开始监听，导航栏一解析出来立即插入，
 * 与站点自己的搜索框、主题按钮同一帧出现。样式写成行内样式，不等插件样式表注入。
 */
import { GM_getValue } from '$';
import { ICON_HEADER } from './core/icons';

let clickHandler: (() => void) | null = null;

/** 主模块就绪后注册点击行为（打开设置面板） */
export function onHeaderEntryClick(fn: () => void): void {
  clickHandler = fn;
}

/** 与日 / 夜间按钮同款：站点把它绝对定位在 header 右侧 right: 10px，这里紧挨在它左边（让出一个按钮宽 27px） */
const STYLE = 'position:absolute;right:37px;padding:0 5px;line-height:19.5px;color:var(--link-hover-color);cursor:pointer';

/** 插入入口；返回是否已就位（找到了主题按钮） */
function inject(): boolean {
  if (document.querySelector('.nsh-head-entry')) return true;
  const anchor = document.querySelector('#nsk-head .color-theme-switcher');
  if (!anchor) return false;
  const btn = document.createElement('div');
  btn.className = 'nsh-head-entry';
  btn.title = 'NodeSeek 助手：图床与表情包';
  btn.style.cssText = STYLE;
  btn.innerHTML = ICON_HEADER;
  (btn.firstElementChild as SVGElement).style.cssText = 'display:inline-block;vertical-align:middle';
  btn.addEventListener('click', () => clickHandler?.());
  anchor.before(btn);
  return true;
}

function start(): void {
  // 设置里关闭了顶部图标时不插入，避免先出现再被隐藏
  if (GM_getValue<{ showHeaderEntry?: boolean } | undefined>('nsh_settings_v1', undefined)?.showHeaderEntry === false) return;
  if (inject()) return;
  const mo = new MutationObserver(() => {
    if (inject()) mo.disconnect();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      inject();
      mo.disconnect();
    },
    { once: true },
  );
}

start();
