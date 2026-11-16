// 本地验证服务：静态文件 + 模拟 CloudFlare-ImgBed 的 /upload 接口
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProxy } from './proxy-sim.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = new Map();
const PORT = 5299;
// 代理模拟：surge（默认）或 qx，通过 NSH_SIM=qx 切换
const SIM = process.env.NSH_SIM || 'surge';
const proxyScript = () => path.join(root, 'dist/nsh-proxy.js');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.end();
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'POST' && url.pathname === '/upload') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const auth = url.searchParams.get('authCode');
        if (auth !== 'test-code') {
          res.statusCode = 401;
          return res.end(JSON.stringify({ message: 'authCode 错误' }));
        }
        const boundary = '--' + /boundary=(.+)$/.exec(req.headers['content-type'] || '')?.[1];
        const parts = body.toString('latin1').split(boundary);
        const part = parts.find((p) => p.includes('name="file"'));
        const headEnd = part.indexOf('\r\n\r\n');
        const type = /Content-Type: (\S+)/i.exec(part.slice(0, headEnd))?.[1] || 'image/png';
        const data = Buffer.from(part.slice(headEnd + 4, part.length - 2), 'latin1');
        const id = Math.random().toString(36).slice(2, 10) + '.' + type.split('/')[1];
        files.set(id, { type, data });
        console.log('upload', id, data.length, 'bytes', Object.fromEntries(url.searchParams));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify([{ src: `http://localhost:${PORT}/file/${id}` }]));
      });
      return;
    }
    // 模拟代理工具：/__nsh/* 交给真实的 dist/nsh-proxy.js 处理
    if (url.pathname.startsWith('/__nsh/')) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const body = new Uint8Array(Buffer.concat(chunks));
        const request = { url: `http://localhost:${PORT}${req.url}`, method: req.method, headers: req.headers };
        if (SIM === 'qx') request.bodyBytes = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
        else request.body = body;
        try {
          const out = await runProxy({ scriptPath: proxyScript(), platform: SIM, request });
          const r = SIM === 'qx' ? { status: parseInt(out.status.split(' ')[1], 10), headers: out.headers, body: out.body } : out.response;
          res.writeHead(r.status, r.headers);
          res.end(r.body);
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
      return;
    }
    // 模拟代理改写后的页面：/dev/proxied.html 先经 nsh-proxy.js 的响应改写再返回
    if (url.pathname === '/dev/proxied.html') {
      const html = fs.readFileSync(path.join(root, 'dev/proxied.html'), 'utf8');
      runProxy({ scriptPath: proxyScript(), platform: SIM, request: { url: `http://localhost:${PORT}/dev/proxied.html`, headers: {} }, response: { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html } })
        .then((out) => {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(out.body ?? html);
        })
        .catch((e) => ((res.statusCode = 500), res.end(String(e))));
      return;
    }
    if (url.pathname.startsWith('/file/')) {
      const f = files.get(url.pathname.slice(6));
      if (!f) return (res.statusCode = 404), res.end();
      res.setHeader('Content-Type', f.type);
      return res.end(f.data);
    }
    const p = path.join(root, url.pathname === '/' ? 'dev/mock.html' : url.pathname);
    if (!p.startsWith(root) || !fs.existsSync(p)) return (res.statusCode = 404), res.end('not found');
    res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream');
    fs.createReadStream(p).pipe(res);
  })
  .listen(PORT, () => console.log(`mock server http://localhost:${PORT}`));
