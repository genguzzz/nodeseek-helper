import { unsafeWindow } from '$';
import { settings } from './store';
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
  }
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
