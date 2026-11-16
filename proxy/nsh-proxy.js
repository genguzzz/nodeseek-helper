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
    return $task.fetch(req).then((r) => ({ status: r.statusCode, headers: r.headers || {}, body: r.body }));
  }
  return new Promise((resolve, reject) => {
    const fn = $httpClient[(opts.method || 'GET').toLowerCase()] || $httpClient.post;
    const req = { url: opts.url, headers: opts.headers, timeout: 120 };
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
    $done({ status: `HTTP/1.1 ${status} ${status < 400 ? 'OK' : 'Error'}`, headers, body });
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
  const extra = JSON.parse(b64decode(headerOf($request.headers, 'X-NSH-Headers') || 'e30=') || '{}');
  const headers = Object.assign({}, extra);
  const ct = headerOf($request.headers, 'Content-Type');
  if (ct && !headerOf(headers, 'Content-Type')) headers['Content-Type'] = ct;
  try {
    const res = await http({ url: target, method, headers, body: requestBody() });
    respond(res.status, { 'Content-Type': headerOf(res.headers, 'Content-Type') || 'application/json', 'X-NSH-Relay': '1', 'Cache-Control': 'no-store' }, res.body);
  } catch (e) {
    respond(502, { 'Content-Type': 'application/json', 'X-NSH-Relay': '1' }, JSON.stringify({ message: '中转失败：' + String(e) }));
  }
}

async function serveApp() {
  try {
    const res = await http({ url: `${NSH_BASE}/${APP_FILE}?v=${NSH_VERSION}`, method: 'GET', headers: {} });
    if (res.status >= 400) throw new Error('HTTP ' + res.status);
    respond(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-NSH-Relay': '1' }, res.body);
  } catch (e) {
    respond(200, { 'Content-Type': 'application/javascript; charset=utf-8' }, `console.error(${JSON.stringify('[NodeSeek 助手] 加载失败：' + String(e))});`);
  }
}

function injectHtml() {
  const ct = headerOf($response.headers, 'Content-Type') || '';
  const body = $response.body;
  if (!/text\/html/i.test(ct) || typeof body !== 'string' || body.indexOf('</body>') < 0 || body.indexOf('/__nsh/app.js') >= 0) {
    return $done({});
  }
  const tag = `<script src="/__nsh/app.js?v=${NSH_VERSION}" defer></script>`;
  const i = body.lastIndexOf('</body>');
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
