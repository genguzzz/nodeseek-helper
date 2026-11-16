import { activeHost, addHistory, renderTemplate, settings } from './store';
import { maybeCompress, providerById, uploadFile } from './uploaders';
import { openPanel, toast, updateToast } from './ui';

/** 与 CodeMirror 5 交互所需的最小接口 */
export interface CM {
  replaceSelection(text: string): void;
  getValue(): string;
  posFromIndex(i: number): unknown;
  replaceRange(text: string, from: unknown, to?: unknown): void;
  focus(): void;
  on(ev: string, fn: (...args: never[]) => void): void;
}

function replacePlaceholder(cm: CM, placeholder: string, text: string): void {
  const i = cm.getValue().indexOf(placeholder);
  if (i < 0) {
    if (text) cm.replaceSelection(text);
    return;
  }
  cm.replaceRange(text, cm.posFromIndex(i), cm.posFromIndex(i + placeholder.length));
}

/** 上传一张图片：先插占位符，完成后替换为模板文本 */
export async function uploadIntoEditor(cm: CM, raw: File): Promise<void> {
  const host = activeHost();
  if (!host) {
    toast('还没有配置图床，先去设置一个吧', 'error', 4000);
    openPanel('hosts');
    return;
  }
  const tag = Math.random().toString(36).slice(2, 7);
  const placeholder = `![上传中… ${tag}]()`;
  cm.replaceSelection(placeholder + '\n');
  const t = toast(`正在上传 ${raw.name || '图片'}`, 'loading');
  try {
    const file = await maybeCompress(raw, settings);
    const url = await uploadFile(host, file, { onProgress: (p) => (t.progress = p) });
    const name = (raw.name || 'image').replace(/\.[^.]+$/, '');
    replacePlaceholder(cm, placeholder, renderTemplate(settings.imageTemplate, { url, name }));
    addHistory({ url, name, host: host.name || providerById(host.provider)?.name || host.provider, time: Date.now() });
    updateToast(t, { type: 'success', text: `上传成功 · ${host.name}`, progress: undefined });
  } catch (e) {
    replacePlaceholder(cm, placeholder + '\n', '');
    updateToast(t, { type: 'error', text: `上传失败：${(e as Error).message}`, progress: undefined }, 6000);
  }
}

export function imageFilesOf(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const it of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const f = it instanceof File ? it : it.kind === 'file' ? it.getAsFile() : null;
    if (f && f.type.startsWith('image/')) out.push(f.name ? f : new File([f], `paste-${Date.now()}.${f.type.split('/')[1]}`, { type: f.type }));
  }
  return out;
}

export async function uploadMany(cm: CM, files: File[]): Promise<void> {
  for (const f of files) await uploadIntoEditor(cm, f);
}
