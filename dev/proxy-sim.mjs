// 在 node 里模拟 Surge（$httpClient）/ Quantumult X（$task）运行 dist/nsh-proxy.js，用于本地验证代理脚本
import fs from 'node:fs';
import vm from 'node:vm';

const toHeaders = (h) => Object.fromEntries(h.entries());

export function runProxy({ scriptPath, platform, request, response }) {
  const code = fs.readFileSync(scriptPath, 'utf8');
  return new Promise((resolve, reject) => {
    const ctx = {
      console,
      URL,
      ArrayBuffer,
      $request: request,
      $done: (v) => resolve(v),
    };
    if (response) ctx.$response = response;
    if (platform === 'qx') {
      ctx.$task = {
        fetch: async (o) => {
          const r = await fetch(o.url, { method: o.method || 'GET', headers: o.headers, body: o.bodyBytes ? Buffer.from(o.bodyBytes) : o.body });
          return { statusCode: r.status, headers: toHeaders(r.headers), body: await r.text() };
        },
      };
    } else {
      const call = (method) => (o, cb) => {
        fetch(o.url, { method, headers: o.headers, body: o.body })
          .then(async (r) => cb(null, { status: r.status, headers: toHeaders(r.headers) }, await r.text()))
          .catch((e) => cb(String(e)));
      };
      ctx.$httpClient = { get: call('GET'), post: call('POST'), put: call('PUT') };
    }
    try {
      vm.runInNewContext(code, ctx, { timeout: 5000 });
    } catch (e) {
      reject(e);
    }
    setTimeout(() => reject(new Error('$done 未被调用')), 15000);
  });
}
