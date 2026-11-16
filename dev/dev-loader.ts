import fs from 'node:fs';
import type { Plugin } from 'vite';

/**
 * 稳定的开发加载器（只需安装一次）
 *
 * vite-plugin-monkey 的开发加载器用「脚本头部的 md5」作为 GM 桥接 key：头部任何变化（@connect、@run-at…）
 * 或换一份配置，已安装的加载器就对不上 key，页面里 GM_* 全部变成 undefined。
 * 这里改为固定 key + 固定头部：
 *   - GET /nsh-dev.user.js 返回固定的加载器（授权全部常用 GM API，以后新增 API 也无需重装）
 *   - 开发模式下把客户端代码里的 __MONKEY_WINDOW_KEY__ 替换为同一个固定 key
 * 之后代码改动、dev server 重启都不需要重新安装，页面自动热更新。
 */
export const DEV_KEY = '__monkeyWindow-nsh-dev';
export const DEV_LOADER_PATH = '/nsh-dev.user.js';

const GRANTS = [
  'GM_xmlhttpRequest',
  'GM_getValue',
  'GM_setValue',
  'GM_deleteValue',
  'GM_listValues',
  'GM_getValues',
  'GM_setValues',
  'GM_deleteValues',
  'GM_addValueChangeListener',
  'GM_removeValueChangeListener',
  'GM_registerMenuCommand',
  'GM_unregisterMenuCommand',
  'GM_setClipboard',
  'GM_addStyle',
  'GM_addElement',
  'GM_openInTab',
  'GM_notification',
  'GM_download',
  'GM_getResourceText',
  'GM_getResourceURL',
  'GM_info',
  'GM_log',
  'GM_cookie',
  'GM_getTab',
  'GM_saveTab',
  'GM_getTabs',
  'unsafeWindow',
  'window.close',
  'window.focus',
  'window.onurlchange',
];

/** 本地 presets/*.json 中的域名：写进加载器 @connect，Tampermonkey 不再逐个弹跨域确认 */
function presetHosts(): string[] {
  const dir = 'presets';
  if (!fs.existsSync(dir)) return [];
  const hosts = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const json = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
      const list = [...(json.hosts ?? json.settings?.hosts ?? []), ...(json.sync ? [{ values: json.sync }] : [])];
      for (const h of list) {
        for (const v of Object.values(h.values ?? {})) if (typeof v === 'string' && /^https?:\/\//.test(v)) hosts.add(new URL(v).hostname);
      }
    } catch {
      /* 忽略无效文件 */
    }
  }
  return [...hosts].sort();
}

function loaderSource(origin: string, matches: string[]): string {
  const meta = [
    ['name', 'NodeSeek 助手 · 开发'],
    ['namespace', 'https://github.com/genguzzz/nodeseek-helper/dev'],
    ['version', '1.0.0'],
    ['description', '开发加载器：从本地 dev server 动态加载代码并热更新，只需安装一次'],
    ...matches.map((m) => ['match', m]),
    ...presetHosts().map((h) => ['connect', h]),
    ['connect', 'localhost'],
    ['connect', '127.0.0.1'],
    ['connect', '*'],
    ...GRANTS.map((g) => ['grant', g]),
    ['run-at', 'document-start'],
    ['noframes', ''],
  ];
  const header = ['// ==UserScript==', ...meta.map(([k, v]) => `// @${k.padEnd(12)} ${v}`.trimEnd()), '// ==/UserScript=='].join('\n');
  // 新版 Tampermonkey 中 GM_* 是脚本作用域里的变量，并不挂在沙箱 window 上：
  // 这里显式收集成对象，再用 Proxy 叠加到沙箱 window 上交给页面里的开发代码（其余属性回落到 window）
  const gmNames = GRANTS.filter((g) => g.startsWith('GM_'));
  const body = `
;((entry, key) => {
  const api = {
    ${gmNames.map((g) => `${g}: typeof ${g} !== 'undefined' ? ${g} : undefined,`).join('\n    ')}
    GM: typeof GM !== 'undefined' ? GM : undefined,
    unsafeWindow: typeof unsafeWindow !== 'undefined' ? unsafeWindow : window,
  };
  document[key] = new Proxy(window, {
    get: (t, p) => (p in api && api[p] !== undefined ? api[p] : Reflect.get(t, p)),
  });
  const s = document.createElement('script');
  s.type = 'module';
  s.src = window.trustedTypes ? window.trustedTypes.createPolicy(key, { createScriptURL: (u) => u }).createScriptURL(entry) : entry;
  (document.head || document.documentElement).append(s);
})(${JSON.stringify(`${origin}/__vite-plugin-monkey.entry.js`)}, ${JSON.stringify(DEV_KEY)});
`;
  return `${header}\n${body}`;
}

export function nshDevLoader(matches: string[]): Plugin {
  return {
    name: 'nsh:dev-loader',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(DEV_LOADER_PATH, (req, res) => {
        const host = req.headers.host ?? '127.0.0.1:5173';
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(loaderSource(`http://${host}`, matches));
      });
    },
    // 先于 vite-plugin-monkey 把 key 占位符换成固定值
    transform(code, id) {
      if ((id.includes('vite-plugin-monkey') || id.includes('/node_modules/')) && code.includes('__MONKEY_WINDOW_KEY__')) {
        return code.replaceAll('__MONKEY_WINDOW_KEY__', JSON.stringify(DEV_KEY));
      }
      return undefined;
    },
  };
}
