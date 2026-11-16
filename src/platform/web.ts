/**
 * 非油猴环境（Surge / Quantumult X / Loon / Stash 通过改写 HTML 注入）下的 GM_* 适配层。
 * 构建代理版本时 `$` 被别名到本文件，业务代码无需改动。
 *
 * - 存储：localStorage（按站点源隔离，多标签页通过 storage 事件同步）
 * - 跨域请求：发往同源的 /__nsh/relay，由代理脚本转发到真实图床，绕开 CORS
 */

const STORE_PREFIX = 'nsh:';
export const RELAY_PATH = '/__nsh/relay';

type ChangeListener = (name: string, oldValue: unknown, newValue: unknown, remote: boolean) => void;

export const unsafeWindow: Window = window;

export function GM_getValue<T>(key: string, defaultValue?: T): T {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    return raw == null ? (defaultValue as T) : (JSON.parse(raw) as T);
  } catch {
    return defaultValue as T;
  }
}

export function GM_setValue(key: string, value: unknown): void {
  localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
}

export function GM_addValueChangeListener(key: string, fn: ChangeListener): number {
  const handler = (e: StorageEvent): void => {
    if (e.key !== STORE_PREFIX + key) return;
    const parse = (v: string | null): unknown => (v == null ? undefined : JSON.parse(v));
    fn(key, parse(e.oldValue), parse(e.newValue), true);
  };
  window.addEventListener('storage', handler);
  return 0;
}

/** 代理环境没有扩展菜单，入口由页面内按钮提供 */
export function GM_registerMenuCommand(_name: string, _fn: () => void): number {
  return 0;
}

export function GM_setClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

export function GM_addStyle(css: string): HTMLStyleElement {
  const s = document.createElement('style');
  s.textContent = css;
  document.head.append(s);
  return s;
}

interface XhrResponse {
  status: number;
  responseText: string;
  response?: unknown;
  responseHeaders?: string;
}

interface XhrDetails {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  data?: XMLHttpRequestBodyInit | null;
  timeout?: number;
  responseType?: string;
  upload?: { onprogress?: (e: ProgressEvent) => void };
  onload?: (res: XhrResponse) => void;
  onerror?: (err: unknown) => void;
  ontimeout?: (err: unknown) => void;
}

/** 与目标同源（或目标本身允许 CORS 的本机服务）时直连，否则走代理中转 */
function needsRelay(url: string): boolean {
  const u = new URL(url, location.href);
  return u.origin !== location.origin;
}

const toBase64 = (s: string): string => btoa(unescape(encodeURIComponent(s)));

export function GM_xmlhttpRequest(d: XhrDetails): { abort: () => void } {
  const xhr = new XMLHttpRequest();
  const relay = needsRelay(d.url);
  const method = d.method ?? 'GET';
  // 中转时统一 POST 到同源地址，真实目标与请求头放在自定义头里
  xhr.open(relay ? 'POST' : method, relay ? RELAY_PATH : d.url);
  if (relay) {
    xhr.setRequestHeader('X-NSH-Url', encodeURIComponent(d.url));
    xhr.setRequestHeader('X-NSH-Method', method);
    xhr.setRequestHeader('X-NSH-Headers', toBase64(JSON.stringify(d.headers ?? {})));
    if (d.responseType === 'blob') xhr.setRequestHeader('X-NSH-Binary', '1');
  } else {
    for (const [k, v] of Object.entries(d.headers ?? {})) xhr.setRequestHeader(k, v);
  }
  xhr.timeout = d.timeout ?? 0;
  if (d.responseType === 'blob') xhr.responseType = 'blob';
  if (d.upload?.onprogress) xhr.upload.onprogress = d.upload.onprogress;
  xhr.onload = () => {
    // 代理脚本未生效时同源 404 返回的是站点页面，给出明确提示
    if (relay && xhr.status === 404 && !xhr.getResponseHeader('X-NSH-Relay')) {
      d.onerror?.(new Error('中转不可用：请确认代理模块已启用且 MITM 包含 nodeseek.com'));
      return;
    }
    const isBlob = xhr.responseType === 'blob';
    d.onload?.({ status: xhr.status, responseText: isBlob ? '' : xhr.responseText, response: xhr.response, responseHeaders: xhr.getAllResponseHeaders() });
  };
  xhr.onerror = (e) => d.onerror?.(e);
  xhr.ontimeout = (e) => d.ontimeout?.(e);
  xhr.send(d.data ?? null);
  return { abort: () => xhr.abort() };
}
