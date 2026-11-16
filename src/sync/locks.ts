/**
 * 跨标签页锁（Web Locks，同源共享）。不支持的环境（极旧的浏览器）退化为直接执行 / 每个标签页都是主标签页。
 * 单独成模块，测试里可按「设备」替换成各自独立的实现。
 */
type Locks = { request: (name: string, cb: () => Promise<unknown>) => Promise<unknown> };

const locks = (): Locks | undefined => (navigator as Navigator & { locks?: Locks }).locks;

/** 独占执行：同一时刻只有一个标签页在执行 fn */
export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const l = locks();
  return l ? (l.request(name, fn) as Promise<T>) : fn();
}

/** 竞选主标签页：拿到锁时调用 onLeader，并在标签页存活期间一直持有（关闭后由下一个标签页接任） */
export function holdLeadership(name: string, onLeader: () => void): void {
  const l = locks();
  if (!l) return onLeader();
  void l.request(name, () => new Promise<void>(() => onLeader()));
}
