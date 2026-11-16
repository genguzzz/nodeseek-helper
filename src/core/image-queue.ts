/**
 * 图片加载队列：限制同时加载的图片数量，失败后退避重试。
 * 背景：NodeImage 等图床对同一 IP 的突发请求会返回 429，表情面板一次加载几十张图时部分会失败；
 * 图片本身带长期缓存，只要首次加载排队完成，之后都从浏览器缓存读取。
 */
const MAX_ACTIVE = 4;
export const RETRY_DELAYS = [1500, 4000, 9000];

let active = 0;
const waiting: (() => void)[] = [];

export function acquireSlot(): Promise<void> {
  if (active < MAX_ACTIVE) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(() => (active++, resolve())));
}

export function releaseSlot(): void {
  active = Math.max(0, active - 1);
  waiting.shift()?.();
}

/** 已成功加载过的地址（浏览器有缓存），再次出现时无需排队 */
export const loadedUrls = new Set<string>();
