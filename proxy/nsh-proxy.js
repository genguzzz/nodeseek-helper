/*
 * NodeSeek 助手 · 代理工具通用脚本（Surge / Shadowrocket / Loon / Stash / Quantumult X）
 * 版本 __NSH_VERSION__
 *
 * 三种用途，由请求路径区分：
 *   1. 站点 HTML 响应：在 </head> 前注入 <script defer src="/__nsh/app.js">
 *   2. /__nsh/app.js：从发布地址拉取注入版脚本并以同源 JS 返回
 *   3. /__nsh/relay：把页面里的图床上传请求转发到真实地址（绕开浏览器 CORS）
 */
const NSH_BASE = '__NSH_BASE__';
const NSH_VERSION = '__NSH_VERSION__';
const APP_FILE = 'nodeseek-helper.inject.js';
// 调试构建为 true：记录各阶段耗时与 Cloudflare 响应信息，经页面上报（正式构建为 false）
const NSH_DEBUG = !!'__NSH_DEBUG__';
const T0 = Date.now();

const isQX = typeof $task !== 'undefined';
const url = $request.url;
const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];

function headerOf(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function b64decode(s) {
  // 代理脚本环境不一定有 atob / TextDecoder，手写 base64 → UTF-8 解码
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = [];
  let buf = 0;
  let bits = 0;
  for (const c of s.replace(/=+$/, '')) {
    const v = chars.indexOf(c);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += '%' + bytes[i].toString(16).padStart(2, '0');
  return decodeURIComponent(out);
}

/** 统一的 HTTP 请求：QX 用 $task.fetch，其余（Surge / Shadowrocket / Loon / Stash）用 $httpClient */
function http(opts) {
  if (isQX) {
    const req = { url: opts.url, method: opts.method, headers: opts.headers };
    if (opts.body instanceof ArrayBuffer || ArrayBuffer.isView(opts.body)) {
      req.bodyBytes = ArrayBuffer.isView(opts.body) ? opts.body.buffer.slice(opts.body.byteOffset, opts.body.byteOffset + opts.body.byteLength) : opts.body;
    } else if (opts.body != null) {
      req.body = opts.body;
    }
    return $task.fetch(req).then((r) => ({ status: r.statusCode, headers: r.headers || {}, body: opts.binary ? r.bodyBytes : r.body }));
  }
  return new Promise((resolve, reject) => {
    const fn = $httpClient[(opts.method || 'GET').toLowerCase()] || $httpClient.post;
    const req = { url: opts.url, headers: opts.headers, timeout: 120 };
    if (opts.binary) req['binary-mode'] = true;
    if (opts.body != null) req.body = opts.body;
    fn.call($httpClient, req, (err, resp, data) => {
      if (err) return reject(err);
      resolve({ status: resp.status || resp.statusCode, headers: resp.headers || {}, body: data });
    });
  });
}

/** 直接返回一个响应（不再请求源站） */
function respond(status, headers, body) {
  if (isQX) {
    const isBytes = body instanceof ArrayBuffer || ArrayBuffer.isView(body);
    const payload = { status: `HTTP/1.1 ${status} ${status < 400 ? 'OK' : 'Error'}`, headers };
    if (isBytes) payload.bodyBytes = ArrayBuffer.isView(body) ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : body;
    else payload.body = body;
    $done(payload);
  } else {
    $done({ response: { status, headers, body } });
  }
}

function requestBody() {
  if (isQX) return $request.bodyBytes || $request.body;
  return $request.body;
}

async function relay() {
  const target = decodeURIComponent(headerOf($request.headers, 'X-NSH-Url') || '');
  if (!/^https?:\/\//.test(target)) return respond(400, { 'Content-Type': 'application/json', 'X-NSH-Relay': '1' }, '{"message":"缺少目标地址"}');
  const method = headerOf($request.headers, 'X-NSH-Method') || 'POST';
  const binary = headerOf($request.headers, 'X-NSH-Binary') === '1';
  const extra = JSON.parse(b64decode(headerOf($request.headers, 'X-NSH-Headers') || 'e30=') || '{}');
  const headers = Object.assign({}, extra);
  const ct = headerOf($request.headers, 'Content-Type');
  if (ct && !headerOf(headers, 'Content-Type')) headers['Content-Type'] = ct;
  try {
    const body = method === 'GET' || method === 'HEAD' ? undefined : requestBody();
    const res = await http({ url: target, method, headers, body, binary });
    const out = { 'Content-Type': headerOf(res.headers, 'Content-Type') || 'application/json', 'X-NSH-Relay': '1', 'Cache-Control': 'no-store' };
    // 同步协议依赖的版本头与口令锁状态原样透传
    for (const h of ['ETag', 'X-Updated-At', 'Last-Modified', 'X-NSH-Locked']) {
      const v = headerOf(res.headers, h);
      if (v) out[h] = v;
    }
    dbgPush({ k: 'relay', host: target.replace(/^https?:\/\/([^/]+).*$/, '$1'), path: target.replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(0, 40), m: method, st: res.status });
    respond(res.status, out, res.body);
  } catch (e) {
    dbgPush({ k: 'relay', host: target.replace(/^https?:\/\/([^/]+).*$/, '$1'), m: method, err: String(e).slice(0, 120) });
    respond(502, { 'Content-Type': 'application/json', 'X-NSH-Relay': '1' }, JSON.stringify({ message: '中转失败：' + String(e) }));
  }
}

/* ---------- 注入脚本缓存：同一版本只从发布地址下载一次，之后直接从代理工具的持久化存储返回 ---------- */
const CACHE_KEY = 'nsh_app_js';
const CACHE_VER_KEY = 'nsh_app_ver';

function storeRead(key) {
  try {
    if (isQX) return $prefs.valueForKey(key);
    return $persistentStore.read(key);
  } catch (e) {
    return null;
  }
}

function storeWrite(key, value) {
  try {
    if (isQX) return $prefs.setValueForKey(value, key);
    return $persistentStore.write(value, key);
  } catch (e) {
    return false;
  }
}

/* ---------- 调试：最近事件缓存在代理工具存储里，由下一次注入的页面带出上报（被拦截的页面自己无法上报） ---------- */
const DBG_KEY = 'nsh_dbg_events';

function dbgPush(ev) {
  if (!NSH_DEBUG) return;
  let list = [];
  try {
    list = JSON.parse(storeRead(DBG_KEY) || '[]');
  } catch (e) {
    list = [];
  }
  ev.t = T0;
  ev.dur = Date.now() - T0;
  list.push(ev);
  storeWrite(DBG_KEY, JSON.stringify(list.slice(-60)));
}

function dbgDrain() {
  const raw = storeRead(DBG_KEY);
  storeWrite(DBG_KEY, '[]');
  try {
    return JSON.parse(raw || '[]');
  } catch (e) {
    return [];
  }
}

function sendApp(body, source) {
  // 地址带 ?v=版本号，内容随版本不变：浏览器可长期缓存，后续页面打开不再经过代理
  respond(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': source === 'stale' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-NSH-Relay': '1',
    'X-NSH-Source': source,
  }, body);
}

/** 调试：脚本开头记录来源与「开始执行」时刻，页面据此算出下载与解析执行耗时 */
function dbgAppPrefix(source, fetchMs) {
  if (!NSH_DEBUG) return '';
  return `window.__nshApp={src:${JSON.stringify(source)},fetch:${fetchMs},proxyMs:${Date.now() - T0},at:Date.now(),evalStart:performance.now()};\n`;
}

async function serveApp() {
  const cached = storeRead(CACHE_VER_KEY) === NSH_VERSION ? storeRead(CACHE_KEY) : null;
  if (cached) {
    dbgPush({ k: 'app', src: 'cache', kb: Math.round(cached.length / 1024) });
    return sendApp(dbgAppPrefix('cache', 0) + cached, 'cache');
  }
  try {
    const t = Date.now();
    const res = await http({ url: `${NSH_BASE}/${APP_FILE}?v=${NSH_VERSION}`, method: 'GET', headers: {} });
    if (res.status >= 400 || !res.body) throw new Error('HTTP ' + res.status);
    if (storeWrite(CACHE_KEY, res.body)) storeWrite(CACHE_VER_KEY, NSH_VERSION);
    dbgPush({ k: 'app', src: 'network', fetch: Date.now() - t, kb: Math.round(res.body.length / 1024) });
    sendApp(dbgAppPrefix('network', Date.now() - t) + res.body, 'network');
  } catch (e) {
    // 新版本下载失败时退回旧缓存，保证功能可用
    const stale = storeRead(CACHE_KEY);
    if (stale) return sendApp(stale, 'stale');
    respond(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' }, `console.error(${JSON.stringify('[NodeSeek 助手] 加载失败：' + String(e))});`);
  }
}

function injectHtml() {
  const ct = headerOf($response.headers, 'Content-Type') || '';
  const body = $response.body;
  // Surge / Loon 为数字，Quantumult X 为 "HTTP/1.1 200 OK" 字符串
  const m = String($response.status || $response.statusCode || 200).match(/\d{3}/);
  const status = m ? Number(m[0]) : 200;
  const cf = {
    st: status,
    ray: headerOf($response.headers, 'cf-ray'),
    mit: headerOf($response.headers, 'cf-mitigated'),
    stm: headerOf($response.headers, 'server-timing'),
    cache: headerOf($response.headers, 'cf-cache-status'),
  };
  // Cloudflare 质询 / 拦截页（非 200 或带 cf-mitigated）不注入：脚本在那里无用，还可能干扰验证
  if (status !== 200 || cf.mit) {
    dbgPush({ k: 'skip', path, kb: typeof body === 'string' ? Math.round(body.length / 1024) : 0, cf });
    return $done({});
  }
  if (!/text\/html/i.test(ct) || typeof body !== 'string' || body.indexOf('</head>') < 0 || body.indexOf('/__nsh/app.js') >= 0) {
    return $done({});
  }
  // defer：不阻塞页面解析与首帧绘制，解析完成后、DOMContentLoaded 之前执行
  let tag = `<script defer src="/__nsh/app.js?v=${NSH_VERSION}"></script>`;
  if (NSH_DEBUG) {
    // 代理脚本在手机上运行，Date.now() 与页面同一时钟：可对照导航时间线看出 Surge 在哪个时刻处理了响应
    const info = { path, at: T0, dur: Date.now() - T0, kb: Math.round(body.length / 1024), cf, events: dbgDrain() };
    tag = `<script>window.__nshProxy=${JSON.stringify(info).replace(/</g, '\\u003c')}</script>` + tag;
  }
  const i = body.indexOf('</head>');
  const headers = Object.assign({}, $response.headers);
  // 若站点日后加了 CSP，去掉以保证注入脚本可执行
  Object.keys(headers).forEach((k) => {
    if (/^content-security-policy/i.test(k)) delete headers[k];
  });
  $done({ headers, body: body.slice(0, i) + tag + body.slice(i) });
}

if (typeof $response !== 'undefined') {
  injectHtml();
} else if (path === '/__nsh/relay') {
  relay();
} else if (path === '/__nsh/app.js') {
  serveApp();
} else {
  $done({});
}
