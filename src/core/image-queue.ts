/**
 * 图片加载队列：限制同时加载的图片数量，失败后退避重试。
 * 背景：NodeImage 等图床对同一 IP 的突发请求会返回 429，表情面板一次加载几十张图时部分会失败；
 * 图片本身带长期缓存，只要首次加载排队完成，之后都从浏览器缓存读取。
 *
 * 注意两种会把队列「卡死」的情况：
 * - 排队中的缩略图已卸载（切换分组 / 关闭面板）：派发时跳过，否则它拿到名额却永远不会释放；
 * - 请求长时间挂起（既不 load 也不 error）：到时自动归还名额，图片继续在后台加载。
 */
const MAX_ACTIVE = 4;
const HOLD_TIMEOUT = 8000;
export const RETRY_DELAYS = [1500, 4000, 9000];

interface Waiter {
  alive: () => boolean;
  grant: (release: () => void) => void;
}

let active = 0;
const waiting: Waiter[] = [];

function makeRelease(): () => void {
  let done = false;
  const timer = setTimeout(() => release(), HOLD_TIMEOUT);
  const release = (): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    active = Math.max(0, active - 1);
    pump();
  };
  return release;
}

function pump(): void {
  while (active < MAX_ACTIVE && waiting.length) {
    const w = waiting.shift() as Waiter;
    if (!w.alive()) continue;
    active++;
    w.grant(makeRelease());
  }
}

/**
 * 申请一个加载名额；返回的函数用于归还（可重复调用，只生效一次）。
 * `alive` 返回 false 时（调用方已卸载）不再分配名额，Promise 永不 resolve。
 */
export function acquireSlot(alive: () => boolean = () => true): Promise<() => void> {
  return new Promise((resolve) => {
    waiting.push({ alive, grant: resolve });
    pump();
  });
}

/** 已成功加载过的地址（浏览器有缓存），再次出现时无需排队 */
export const loadedUrls = new Set<string>();
