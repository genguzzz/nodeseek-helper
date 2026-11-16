import { createApp, type App } from 'vue';
import { unsafeWindow } from '$';
import { settings } from './store';
import { recordOfficialUse } from './sticker-lists';
import InlineStickers from '../components/InlineStickers.vue';
import { openPanel, togglePicker } from './ui';
import { imageFilesOf, uploadMany, type CM } from './upload-flow';
import { ICON_EMOJI, ICON_GEAR, ICON_UPLOAD } from './icons';

const ENHANCED = 'nshEnhanced';
/** 发帖 / 回复编辑器（.md-editor）与私信输入框（.message-input）结构相同：工具栏 + CodeMirror */
const EDITOR_SELECTOR = '.md-editor, .message-input';

/** 取页面里的 CodeMirror 5 实例（兼容油猴沙箱 / Firefox Xray） */
export function getCM(md: Element): CM | undefined {
  const w = md.querySelector('.CodeMirror') as (Element & { CodeMirror?: CM; wrappedJSObject?: { CodeMirror?: CM } }) | null;
  return w?.CodeMirror ?? w?.wrappedJSObject?.CodeMirror ?? (unsafeWindow as unknown as { codemirrorInstance?: CM }).codemirrorInstance;
}

/** NodeSeek 用 Vue scoped 样式，把兄弟节点的 data-v-* 复制过来即可复用原生样式 */
function copyScope(from: Element | null, to: Element): void {
  if (!from) return;
  for (const a of Array.from(from.attributes)) if (a.name.startsWith('data-v-')) to.setAttribute(a.name, '');
}

function pickFiles(cm: CM): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => void uploadMany(cm, imageFilesOf(input.files));
  input.click();
}

function injectToolbar(md: Element, cm: CM): void {
  const bar = md.querySelector('.mde-toolbar');
  if (!bar || bar.querySelector('.nsh-tb')) return;
  const ref = bar.querySelector('.toolbar-item[title="图片"]') ?? bar.querySelector('.toolbar-item');
  const btn = document.createElement('span');
  btn.className = 'toolbar-item i-icon nsh-tb nsh-tb-upload';
  btn.title = '上传图片到图床（也可直接粘贴 / 拖拽）';
  btn.innerHTML = ICON_UPLOAD;
  copyScope(ref, btn);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pickFiles(cm);
  });
  const emoji = document.createElement('span');
  emoji.className = 'toolbar-item i-icon nsh-tb nsh-tb-emoji';
  emoji.title = '表情包（NodeSeek 助手）';
  emoji.innerHTML = ICON_EMOJI;
  copyScope(ref, emoji);
  emoji.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePicker(emoji, (text) => insertText(cm, text), md as HTMLElement);
  });
  ref ? ref.after(btn, emoji) : bar.append(btn, emoji);
}

function insertText(cm: CM, text: string): void {
  cm.replaceSelection(text);
  cm.focus();
}

function injectTopButtons(md: Element, cm: CM): void {
  const top = md.querySelector('.tab-select');
  if (!top || top.querySelector('.nsh-top')) return;
  const ref = top.querySelector('.editor-top-button');
  const make = (title: string, icon: string, onClick: () => void): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.href = 'javascript:void(0)';
    a.className = 'editor-top-button nsh-top';
    a.title = title;
    a.innerHTML = icon;
    copyScope(ref, a);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return a;
  };
  const upload = make('上传图片到图床', ICON_UPLOAD, () => pickFiles(cm));
  upload.classList.add('nsh-top-upload');
  const emoji = make('表情包', ICON_EMOJI, () => togglePicker(emoji, (text) => insertText(cm, text), md as HTMLElement));
  emoji.classList.add('nsh-top-emoji');
  const gear = make('NodeSeek 助手设置', ICON_GEAR, () => openPanel());
  ref ? ref.before(emoji, upload, gear) : top.append(emoji, upload, gear);
}

/** 每个编辑器挂一个小 Vue 应用，负责并入原生表情栏的标签与表情网格 */
const inlineApps = new WeakMap<Element, { app: App; panel: HTMLElement; bar: Element }>();

/**
 * 把助手表情并入底部原生表情栏：
 * 原生栏 = AC娘 / 洋葱头 / 小黄鸡 / Fluent | App；在最前面插入「收藏 / 最近 / 自定义分组」，最右侧放搜索与表情设置，
 * 表情网格放在原生 .exp-container 之后。原生栏被 Vue 重建时卸载旧应用重新挂载。
 */
function injectNativeBar(md: HTMLElement, cm: CM): void {
  const bar = md.querySelector<HTMLElement>('.expression');
  const prev = inlineApps.get(md);
  if (prev?.bar === bar && prev.panel.isConnected) return;
  if (prev) {
    prev.app.unmount();
    prev.panel.remove();
    inlineApps.delete(md);
  }
  if (!bar) return;
  bar.classList.add('nsh-exp-bar');
  const tabsHost = document.createElement('span');
  tabsHost.className = 'nsh-exp-tabs';
  const toolsHost = document.createElement('span');
  toolsHost.className = 'nsh-exp-tools';
  bar.prepend(tabsHost);
  bar.append(toolsHost);
  const panel = document.createElement('div');
  panel.className = 'nsh-scope nsh-exp-host';
  const container = bar.parentElement?.querySelector(':scope > .exp-container');
  (container ?? bar).after(panel);
  const app = createApp(InlineStickers, { bar, tabsHost, toolsHost, insert: (text: string) => insertText(cm, text) });
  app.mount(panel);
  inlineApps.set(md, { app, panel, bar });
}

/** 原生表情被点击时也计入「最近使用」 */
function trackNativeStickers(md: HTMLElement): void {
  md.addEventListener('click', (e) => {
    const el = (e.target as Element).closest?.('.exp-container .sticker');
    if (!el) return;
    const m = /\/sticker\/([a-z]+)\/(\d+)/i.exec(el.getAttribute('src') ?? '');
    if (m && m[1] !== 'app') recordOfficialUse(`:${m[1]}${m[2]}:`);
  });
}

function bindPasteAndDrop(md: HTMLElement, cm: CM): void {
  md.addEventListener(
    'paste',
    (e: ClipboardEvent) => {
      if (!settings.pasteUpload || !(e.target as Element).closest('.CodeMirror')) return;
      const dt = e.clipboardData;
      const files = imageFilesOf(dt?.items);
      // 同时带纯文本（如从 Excel / Word 复制）时按文本粘贴，避免误传
      if (!files.length || dt?.getData('text/plain')) return;
      e.preventDefault();
      e.stopPropagation();
      void uploadMany(cm, files);
    },
    true,
  );
  md.addEventListener(
    'dragover',
    (e: DragEvent) => {
      if (settings.dropUpload && e.dataTransfer?.types.includes('Files') && (e.target as Element).closest('.CodeMirror')) {
        e.preventDefault();
        md.classList.add('nsh-dragging');
      }
    },
    true,
  );
  md.addEventListener('dragleave', () => md.classList.remove('nsh-dragging'), true);
  md.addEventListener(
    'drop',
    (e: DragEvent) => {
      md.classList.remove('nsh-dragging');
      if (!settings.dropUpload || !(e.target as Element).closest('.CodeMirror')) return;
      const files = imageFilesOf(e.dataTransfer?.files);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void uploadMany(cm, files);
    },
    true,
  );
}

/** 增强单个编辑器；可重复调用（Vue 重渲染工具栏后会补注入） */
export function enhanceEditor(md: HTMLElement): void {
  const cm = getCM(md);
  if (!cm) return;
  if (!md.dataset[ENHANCED]) {
    md.dataset[ENHANCED] = '1';
    bindPasteAndDrop(md, cm);
    trackNativeStickers(md);
  }
  injectNativeBar(md, cm);
  injectToolbar(md, cm);
  injectTopButtons(md, cm);
}

export function watchEditors(): void {
  let scheduled = false;
  const scan = (): void => {
    scheduled = false;
    document.querySelectorAll<HTMLElement>(EDITOR_SELECTOR).forEach(enhanceEditor);
  };
  scan();
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(scan);
    }
  }).observe(document.body, { childList: true, subtree: true });
}
