/*
 * NodeSeek 助手 · 代理工具通用脚本（Surge / Loon / Stash / Quantumult X）
 * 版本 __NSH_VERSION__
 *
 * 三种用途，由请求路径区分：
 *   1. 站点 HTML 响应：在 </body> 前注入 <script src="/__nsh/app.js">
 *   2. /__nsh/app.js：从发布地址拉取注入版脚本并以同源 JS 返回
 *   3. /__nsh/relay：把页面里的图床上传请求转发到真实地址（绕开浏览器 CORS）
 */
const NSH_BASE = '__NSH_BASE__';
const NSH_VERSION = '__NSH_VERSION__';
const APP_FILE = 'nodeseek-helper.inject.js';

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

/** 统一的 HTTP 请求：QX 用 $task.fetch，其余用 $httpClient */
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
    // 同步协议依赖的版本头原样透传
    for (const h of ['ETag', 'X-Updated-At', 'Last-Modified']) {
      const v = headerOf(res.headers, h);
      if (v) out[h] = v;
    }
    respond(res.status, out, res.body);
  } catch (e) {
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

function sendApp(body, source) {
  // 地址带 ?v=版本号，内容随版本不变：浏览器可长期缓存，后续页面打开不再经过代理
  respond(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': source === 'stale' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-NSH-Relay': '1',
    'X-NSH-Source': source,
  }, body);
}

async function serveApp() {
  const cached = storeRead(CACHE_VER_KEY) === NSH_VERSION ? storeRead(CACHE_KEY) : null;
  if (cached) return sendApp(cached, 'cache');
  try {
    const res = await http({ url: `${NSH_BASE}/${APP_FILE}?v=${NSH_VERSION}`, method: 'GET', headers: {} });
    if (res.status >= 400 || !res.body) throw new Error('HTTP ' + res.status);
    if (storeWrite(CACHE_KEY, res.body)) storeWrite(CACHE_VER_KEY, NSH_VERSION);
    sendApp(res.body, 'network');
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
  if (!/text\/html/i.test(ct) || typeof body !== 'string' || body.indexOf('</head>') < 0 || body.indexOf('/__nsh/app.js') >= 0) {
    return $done({});
  }
  // 放在 <head> 里同步执行：脚本先于页面主体运行，顶部图标等能在首帧前就位
  const tag = `<script src="/__nsh/app.js?v=${NSH_VERSION}"></script>`;
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
