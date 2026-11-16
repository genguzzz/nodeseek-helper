/**
 * 顶部导航入口（笑脸贴纸图标）。
 *
 * 位置：
 * - 导航栏里有通知铃铛（手机端登录后）：放在铃铛左边，外层结构与定位方式跟铃铛一致；
 * - 否则（电脑端 / 未登录）：放在日 / 夜间切换按钮左边。
 *
 * 单独成模块并在 main.ts 最先导入：只依赖图标字符串与 GM_getValue，
 * 在 Vue 组件、表情数据、GIF 库等重模块执行之前就开始监听，导航栏一解析出来立即插入，
 * 与站点自己的导航同一帧出现。样式写成行内样式，不等插件样式表注入；
 * 页面加载完（站点样式、铃铛都就绪）后再校正一次位置。
 */
import { GM_getValue } from '$';
import { ICON_HEADER } from './core/icons';

let clickHandler: (() => void) | null = null;

/** 主模块就绪后注册点击行为（打开设置面板） */
export function onHeaderEntryClick(fn: () => void): void {
  clickHandler = fn;
}

const ICON_STYLE = 'display:inline-block;vertical-align:middle';
/** 与日 / 夜间按钮同款：站点把它绝对定位在 header 右侧 right: 10px，这里紧挨在它左边（让出一个按钮宽 27px） */
const SWITCHER_STYLE = 'position:absolute;right:37px;padding:0 5px;line-height:19.5px;color:var(--link-hover-color);cursor:pointer';

/** 导航栏里的通知铃铛（图标 #remind…，或指向 /notification 的链接）；返回铃铛所在的最外层条目 */
function findBell(head: Element): HTMLElement | null {
  const use = Array.from(head.querySelectorAll('use')).find((u) => /^#remind/.test(u.getAttribute('href') ?? ''));
  const link = (use?.closest('a') ?? head.querySelector('a[href^="/notification"]')) as HTMLElement | null;
  const el = link ?? (use?.closest('svg')?.parentElement as HTMLElement | null) ?? null;
  if (!el) return null;
  return (el.closest('li') as HTMLElement | null) ?? el;
}

function createButton(): HTMLElement {
  const btn = document.createElement('div');
  btn.className = 'nsh-head-entry';
  btn.title = 'NodeSeek 助手：图床与表情包';
  btn.innerHTML = ICON_HEADER;
  btn.addEventListener('click', () => clickHandler?.());
  return btn;
}

/** 把入口放到铃铛左边：外层与铃铛同类（列表项就包一层 li），图标尺寸与铃铛相同；铃铛绝对定位时紧挨在它左边 */
function placeBeforeBell(btn: HTMLElement, bell: HTMLElement): void {
  const icon = btn.firstElementChild as SVGElement;
  const bellIcon = bell.querySelector('svg');
  const size = bellIcon ? Math.round(bellIcon.getBoundingClientRect().width) : 0;
  if (size > 0) {
    icon.setAttribute('width', String(size));
    icon.setAttribute('height', String(size));
  }
  icon.style.cssText = ICON_STYLE;
  const cs = getComputedStyle(bell);
  const absolute = cs.position === 'absolute';
  btn.style.cssText = absolute
    ? `position:absolute;right:${(parseFloat(cs.right) || 0) + bell.offsetWidth}px;top:${cs.top};line-height:${cs.lineHeight};padding:${cs.padding};color:inherit;cursor:pointer`
    : 'display:inline-flex;align-items:center;padding:0 5px;color:inherit;cursor:pointer';
  const wrapper = bell.tagName === 'LI' ? document.createElement('li') : null;
  if (wrapper) {
    for (const a of Array.from(bell.attributes)) if (a.name.startsWith('data-v-') || a.name === 'class') wrapper.setAttribute(a.name, a.value);
    wrapper.classList.add('nsh-head-entry-li');
    wrapper.append(btn);
  }
  bell.before(wrapper ?? btn);
}

/** 插入或校正入口位置；返回是否已就位（找到了导航栏） */
function place(): boolean {
  const head = document.querySelector('#nsk-head');
  const switcher = head?.querySelector('.color-theme-switcher');
  if (!head || !switcher) return false;
  const old = document.querySelector<HTMLElement>('.nsh-head-entry');
  const bell = findBell(head);
  // 已经在正确的位置就不动
  if (old && (bell ? (old.closest('.nsh-head-entry-li') ?? old).nextElementSibling === bell : old.nextElementSibling === switcher)) return true;
  const btn = old ?? createButton();
  (btn.closest('.nsh-head-entry-li') ?? btn).remove();
  if (bell) {
    placeBeforeBell(btn, bell);
  } else {
    btn.style.cssText = SWITCHER_STYLE;
    (btn.firstElementChild as SVGElement).style.cssText = ICON_STYLE;
    switcher.before(btn);
  }
  return true;
}

/** 页面加载后只盯着导航栏本身（变化很少）：铃铛若由前端稍后渲染出来，也能挪到它左边 */
function watchHead(): void {
  const head = document.querySelector('#nsk-head');
  if (!head) return;
  new MutationObserver(() => place()).observe(head, { childList: true, subtree: true });
}

function start(): void {
  // 设置里关闭了顶部图标时不插入，避免先出现再被隐藏
  if (GM_getValue<{ showHeaderEntry?: boolean } | undefined>('nsh_settings_v1', undefined)?.showHeaderEntry === false) return;
  place();
  let loaded = false;
  // 导航栏（含铃铛）一解析出来就放好；页面加载完之后放好即停止监听
  const mo = new MutationObserver(() => {
    if (place() && loaded) {
      mo.disconnect();
      watchHead();
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  // 页面加载完、站点样式就绪后按最终样式重新放一次（铃铛的尺寸与定位依赖样式表）；同一任务内完成，不会闪
  // 导航栏还没出现时继续监听（如脚本注入晚于页面加载、导航栏由前端渲染）
  const finish = (): void => {
    loaded = true;
    const el = document.querySelector<HTMLElement>('.nsh-head-entry');
    if (el) (el.closest('.nsh-head-entry-li') ?? el).remove();
    if (place()) {
      mo.disconnect();
      watchHead();
    }
  };
  if (document.readyState === 'complete') finish();
  else window.addEventListener('load', finish, { once: true });
}

start();
