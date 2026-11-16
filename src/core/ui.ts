import { markRaw, reactive } from 'vue';

export type PanelTab = 'hosts' | 'stickers' | 'sync' | 'general' | 'history';

export interface Toast {
  id: number;
  type: 'info' | 'success' | 'error' | 'loading';
  text: string;
  progress?: number;
}

export interface PreviewState {
  url: string;
  name: string;
  /** 视频表情（官方 Fluent）：预览时播放 */
  video?: string;
  /** 触发元素的位置，用于定位浮层 */
  rect: { left: number; top: number; right: number; bottom: number };
}

/** 编辑器工具栏表情弹层：锚点按钮 + 插入回调（均为非响应式原始对象） */
export interface PickerState {
  anchor: HTMLElement;
  insert: (text: string) => void;
  /** 所在编辑器，用于触发原生 App 功能（投票 / 星尘） */
  editor?: HTMLElement;
}

export interface ConfirmState {
  title: string;
  message: string;
  okText: string;
  cancelText: string;
  /** 可选的第三个按钮（如「仍然直接收藏」） */
  altText?: string;
  resolve: (choice: 'ok' | 'cancel' | 'alt') => void;
}

export const ui = reactive({
  confirm: null as ConfirmState | null,
  picker: null as PickerState | null,
  panelOpen: false,
  panelTab: 'hosts' as PanelTab,
  toasts: [] as Toast[],
  preview: null as PreviewState | null,
});

let seq = 0;

export function toast(text: string, type: Toast['type'] = 'info', duration = 2600): Toast {
  const t = reactive<Toast>({ id: ++seq, type, text });
  ui.toasts.push(t);
  if (type !== 'loading') setTimeout(() => dismissToast(t.id), duration);
  return t;
}

export function updateToast(t: Toast, patch: Partial<Toast>, duration = 2600): void {
  Object.assign(t, patch);
  if (patch.type && patch.type !== 'loading') setTimeout(() => dismissToast(t.id), duration);
}

export function dismissToast(id: number): void {
  const i = ui.toasts.findIndex((x) => x.id === id);
  if (i > -1) ui.toasts.splice(i, 1);
}

export function openPanel(tab: PanelTab = ui.panelTab): void {
  ui.panelTab = tab;
  ui.panelOpen = true;
}

export function showPreview(el: Element, url: string, name = '', video?: string): void {
  const r = el.getBoundingClientRect();
  ui.preview = { url, name, video, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
}

export function hidePreview(): void {
  ui.preview = null;
}

export const isAnimatedUrl = (url: string): boolean => /\.(gif|webp|avif|apng)(\?|#|$)/i.test(url);

export function togglePicker(anchor: HTMLElement, insert: (text: string) => void, editor?: HTMLElement): void {
  if (ui.picker?.anchor === anchor) {
    ui.picker = null;
    return;
  }
  ui.picker = { anchor: markRaw(anchor), insert: markRaw(insert), editor: editor ? markRaw(editor) : undefined };
}

export function closePicker(): void {
  ui.picker = null;
}

/** 站点风格的确认框，返回用户选择 */
export function askConfirm(opts: Omit<ConfirmState, 'resolve' | 'okText' | 'cancelText'> & { okText?: string; cancelText?: string }): Promise<'ok' | 'cancel' | 'alt'> {
  return new Promise((resolve) => {
    ui.confirm = {
      okText: '确定',
      cancelText: '取消',
      ...opts,
      resolve: markRaw((choice: 'ok' | 'cancel' | 'alt') => {
        ui.confirm = null;
        resolve(choice);
      }),
    };
  });
}
