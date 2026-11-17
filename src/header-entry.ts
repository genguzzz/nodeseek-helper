/**
 * 顶部导航入口（笑脸贴纸图标）。
 *
 * 图标按 IconPark 的方式注册成 <symbol>，用 <svg class="iconpark-icon"><use href="#nsh-sticker"></use></svg> 引用，
 * 与站点的铃铛、太阳、搜索图标是同一种写法，站点作用在图标上的尺寸、颜色、对齐样式对它同样生效。
 *
 * 位置：
 * - 导航栏里有通知铃铛（手机端登录后）：复制铃铛的外壳（标签、class、作用域属性、行内样式），换成我们的图标，
 *   去掉未读数等文字，放在铃铛左边——颜色、大小、垂直对齐都与铃铛一致；铃铛绝对定位时再往左让出一个铃铛宽；
 * - 否则（电脑端 / 未登录）：放在日 / 夜间切换按钮左边，图标写法、尺寸与它的图标相同。
 *
 * 单独成模块并在 main.ts 最先导入：只依赖图标字符串与 GM_getValue，导航栏一解析出来立即插入；
 * 页面加载完（站点样式就绪）后再按最终样式放一次，之后只监听导航栏本身。
 */
import { GM_getValue } from '$';
import { HEADER_SYMBOL, HEADER_SYMBOL_ID } from './core/icons';

let clickHandler: (() => void) | null = null;

/** 主模块就绪后注册点击行为（打开设置面板） */
export function onHeaderEntryClick(fn: () => void): void {
  clickHandler = fn;
}

const ENTRY = 'nsh-head-entry';
const TITLE = 'NodeSeek 助手：图床与表情包';
const isBellUse = (u: Element): boolean => /^#remind/.test(u.getAttribute('href') ?? '');

/** 把图标 symbol 注册进页面（与站点的图标精灵同一种机制） */
function ensureSymbol(): void {
  if (document.getElementById(HEADER_SYMBOL_ID)) return;
  const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  sprite.innerHTML = HEADER_SYMBOL;
  (document.body ?? document.documentElement).append(sprite);
}

/** 导航栏里的通知铃铛图标所在的最外层条目（列表项或链接）；不是我们自己的入口 */
function findBell(head: Element): HTMLElement | null {
  const use = Array.from(head.querySelectorAll('use')).find(isBellUse);
  if (!use || use.closest(`.${ENTRY}`)) return null;
  const el = (use.closest('a') ?? use.closest('svg')?.parentElement) as HTMLElement | null;
  return el ? ((el.closest('li') as HTMLElement | null) ?? el) : null;
}

function bindClick(el: HTMLElement): void {
  // 捕获阶段拦截：克隆来的外壳可能带着站点给铃铛绑的行为（跳转通知页），一律不触发
  el.addEventListener(
    'click',
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      clickHandler?.();
    },
    true,
  );
}

/** 复制铃铛的外壳做入口：只保留通往铃铛图标的那条路径，把图标换成我们的 */
function cloneFromBell(bell: HTMLElement): HTMLElement {
  const root = bell.cloneNode(true) as HTMLElement;
  const use = Array.from(root.querySelectorAll('use')).find(isBellUse) as Element;
  const svg = use.closest('svg') as SVGElement;
  use.setAttribute('href', `#${HEADER_SYMBOL_ID}`);
  use.removeAttribute('xlink:href');
  // 去掉未读数、文字等：从图标往上，每一层只保留通往图标的那个子节点
  for (let node: Element = svg; node !== root; node = node.parentElement as Element) {
    for (const sib of Array.from((node.parentElement as Element).childNodes)) if (sib !== node) sib.remove();
  }
  for (const a of [root, ...Array.from(root.querySelectorAll('a'))]) {
    if (a.tagName !== 'A') continue;
    a.setAttribute('href', 'javascript:void(0)');
    a.removeAttribute('target');
  }
  root.removeAttribute('id');
  root.classList.add(ENTRY);
  root.title = TITLE;
  bindClick(root);
  // 铃铛绝对定位（如贴着日 / 夜间按钮）：克隆会与它重叠，往左让出一个铃铛的宽度
  const cs = getComputedStyle(bell);
  if (cs.position === 'absolute' || cs.position === 'fixed') {
    root.style.right = `${(parseFloat(cs.right) || 0) + bell.offsetWidth}px`;
    root.style.left = 'auto';
  }
  return root;
}

/** 电脑端 / 未登录：与日 / 夜间按钮同款（站点把它绝对定位在 header 右侧 right: 10px，这里紧挨在它左边） */
function createBesideSwitcher(): HTMLElement {
  const el = document.createElement('div');
  el.className = ENTRY;
  el.title = TITLE;
  el.style.cssText = 'position:absolute;right:37px;padding:0 5px;line-height:19.5px;color:var(--link-hover-color);cursor:pointer';
  el.innerHTML = `<svg class="iconpark-icon" style="width:17px;height:17px;vertical-align:middle"><use href="#${HEADER_SYMBOL_ID}"></use></svg>`;
  bindClick(el);
  return el;
}

/** 插入或校正入口位置；返回是否已就位（找到了导航栏）。force：按当前样式重新生成 */
function place(force = false): boolean {
  const head = document.querySelector('#nsk-head');
  const switcher = head?.querySelector('.color-theme-switcher');
  if (!head || !switcher) return false;
  ensureSymbol();
  const bell = findBell(head);
  const anchor = bell ?? switcher;
  const old = document.querySelector<HTMLElement>(`.${ENTRY}`);
  if (!force && old && old.nextElementSibling === anchor) return true;
  old?.remove();
  anchor.before(bell ? cloneFromBell(bell) : createBesideSwitcher());
  return true;
}

/** 页面加载后只盯着导航栏本身（变化很少）：铃铛若由前端稍后渲染出来，也能挪到它左边 */
function watchHead(): void {
  const head = document.querySelector('#nsk-head');
  if (head) new MutationObserver(() => place()).observe(head, { childList: true, subtree: true });
}

let started = false;

/**
 * 开始放置入口（只执行一次）。默认关闭：部分安卓浏览器导航栏很窄，多一个图标会把站点 Logo 文字挤到下一行、压住分类栏；
 * 设置里打开「顶部导航图标」后由主模块调用；导入时已打开则立即调用（避免先出现再被隐藏）。
 */
export function startHeaderEntry(): void {
  if (started) return;
  started = true;
  place();
  let loaded = false;
  // 导航栏（含铃铛）一解析出来就放好；页面加载完之后放好即停止监听整个文档
  const mo = new MutationObserver(() => {
    if (place() && loaded) {
      mo.disconnect();
      watchHead();
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  // 页面加载完、站点样式就绪后按最终样式重新放一次（同一任务内完成，不会闪）；导航栏还没出现时继续监听
  const finish = (): void => {
    loaded = true;
    if (place(true)) {
      mo.disconnect();
      watchHead();
    }
  };
  if (document.readyState === 'complete') finish();
  else window.addEventListener('load', finish, { once: true });
}

if (GM_getValue<{ showHeaderIcon?: boolean } | undefined>('nsh_settings_v1', undefined)?.showHeaderIcon === true) startHeaderEntry();
