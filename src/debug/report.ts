/**
 * 调试构建的性能日志上报（正式构建 __NSH_DEBUG_REPORT__ 为空，以下函数体在压缩时被整体移除）。
 *
 * 每个页面上报一次：导航时间线、首帧 / 最大内容绘制、长任务、本插件各启动阶段耗时、
 * 代理脚本带出的 Surge 侧耗时与 Cloudflare 响应信息（含被拦截页面的事件）、
 * 中转请求是否漏到源站，以及按域名统计的请求（协议、耗时、体积）——用于判断慢在哪、是否被 Cloudflare 拦截。
 */

type Rec = Record<string, unknown>;

const marks: Rec[] = [];
const events: Rec[] = [];
const longTasks: [number, number][] = [];
let lcp = 0;
let sent = false;

/** 记录一个启动阶段的耗时 */
export function phase<T>(name: string, fn: () => T): T {
  if (!__NSH_DEBUG_REPORT__) return fn();
  const t = performance.now();
  try {
    return fn();
  } finally {
    marks.push({ name, at: Math.round(t), ms: +(performance.now() - t).toFixed(1) });
  }
}

/** 记录一条调试事件（如中转请求结果） */
export function debugEvent(ev: Rec): void {
  if (!__NSH_DEBUG_REPORT__) return;
  events.push({ at: Math.round(performance.now()), ...ev });
}

const round = (n: number | undefined): number | undefined => (n == null ? undefined : Math.round(n));

function navTimeline(): Rec | undefined {
  const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (!n) return undefined;
  return {
    type: n.type,
    proto: n.nextHopProtocol,
    redirect: round(n.redirectEnd - n.redirectStart),
    dns: round(n.domainLookupEnd - n.domainLookupStart),
    connect: round(n.connectEnd - n.connectStart),
    tls: n.secureConnectionStart ? round(n.connectEnd - n.secureConnectionStart) : 0,
    requestStart: round(n.requestStart),
    ttfb: round(n.responseStart),
    responseEnd: round(n.responseEnd),
    download: round(n.responseEnd - n.responseStart),
    domInteractive: round(n.domInteractive),
    dcl: round(n.domContentLoadedEventEnd),
    load: round(n.loadEventEnd),
    kb: round(n.encodedBodySize / 1024),
    serverTiming: (n.serverTiming ?? []).map((s) => `${s.name}${s.duration ? '=' + Math.round(s.duration) : ''}${s.description ? ' ' + s.description : ''}`),
  };
}

/** 按域名汇总资源请求；本站请求单独列出最慢的几条 */
function resources(): Rec {
  const list = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const byHost: Record<string, { n: number; proto: Set<string>; total: number; max: number; kb: number; cached: number }> = {};
  for (const r of list) {
    let host = '?';
    try {
      host = new URL(r.name).host;
    } catch {
      /* 保持 ? */
    }
    const h = (byHost[host] ??= { n: 0, proto: new Set(), total: 0, max: 0, kb: 0, cached: 0 });
    h.n++;
    if (r.nextHopProtocol) h.proto.add(r.nextHopProtocol);
    h.total += r.duration;
    h.max = Math.max(h.max, r.duration);
    h.kb += r.transferSize / 1024;
    if (r.transferSize === 0 && r.decodedBodySize > 0) h.cached++;
  }
  const slowSite = list
    .filter((r) => /nodeseek\.com|deepflood\.com/.test(r.name))
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 12)
    .map((r) => ({
      url: r.name.replace(/^https?:\/\/[^/]+/, '').slice(0, 90),
      type: r.initiatorType,
      proto: r.nextHopProtocol,
      start: round(r.startTime),
      ms: round(r.duration),
      wait: round(r.responseStart - r.requestStart),
      kb: round(r.transferSize / 1024),
      st: (r as PerformanceResourceTiming & { responseStatus?: number }).responseStatus,
      stm: (r.serverTiming ?? []).map((s) => `${s.name}${s.description ? ' ' + s.description : ''}`).join('; ').slice(0, 120) || undefined,
    }));
  return {
    hosts: Object.fromEntries(
      Object.entries(byHost).map(([k, v]) => [k, { n: v.n, proto: [...v.proto].join(','), avg: Math.round(v.total / v.n), max: Math.round(v.max), kb: Math.round(v.kb), cached: v.cached }]),
    ),
    slowSite,
  };
}

function report(reason: string): void {
  if (sent) return;
  sent = true;
  const w = window as unknown as { __nshProxy?: Rec; __nshApp?: Rec & { evalStart?: number } };
  const app = w.__nshApp;
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
  const body = {
    v: __NSH_VERSION__,
    reason,
    url: location.pathname + location.search,
    title: document.title.slice(0, 60),
    challenge: /just a moment|请稍候|attention required/i.test(document.title) || !!document.querySelector('#challenge-form, #cf-challenge-running'),
    ua: navigator.userAgent,
    vw: innerWidth,
    clock: Date.now(),
    timeOrigin: Math.round(performance.timeOrigin),
    nav: navTimeline(),
    fcp: round(fcp),
    lcp: round(lcp),
    longTasks: { n: longTasks.length, total: Math.round(longTasks.reduce((a, [, d]) => a + d, 0)), top: longTasks.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, d]) => [Math.round(s), Math.round(d)]) },
    // 代理脚本运行时刻换算到页面时间线（同一设备时钟）
    proxy: w.__nshProxy ? { ...w.__nshProxy, atRel: Math.round((w.__nshProxy.at as number) - performance.timeOrigin) } : null,
    app: app ? { ...app, atRel: Math.round((app.at as number) - performance.timeOrigin) } : null,
    marks,
    events,
    res: resources(),
  };
  const data = JSON.stringify(body);
  console.info('[NSH debug]', body);
  try {
    if (!navigator.sendBeacon(__NSH_DEBUG_REPORT__, new Blob([data], { type: 'text/plain' }))) throw new Error('beacon');
  } catch {
    void fetch(__NSH_DEBUG_REPORT__, { method: 'POST', body: data, keepalive: true, mode: 'no-cors' }).catch(() => undefined);
  }
}

/** 尽早调用：开始收集长任务与 LCP，页面加载完 4 秒后（或离开页面时）上报 */
export function startDebugReport(): void {
  if (!__NSH_DEBUG_REPORT__) return;
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true });
  } catch {
    /* Safari 不支持长任务 */
  }
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    /* Safari 不支持 LCP */
  }
  const app = (window as unknown as { __nshApp?: Rec & { evalStart?: number } }).__nshApp;
  if (app?.evalStart != null) marks.push({ name: 'appEval→main', at: Math.round(app.evalStart), ms: +(performance.now() - app.evalStart).toFixed(1) });
  const later = (): void => void setTimeout(() => report('load+4s'), 4000);
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
  window.addEventListener('pagehide', () => report('pagehide'), { once: true });
}
