import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import monkey, { cdn } from 'vite-plugin-monkey';
import fs from 'node:fs';

/**
 * 本地 presets/*.json（已 gitignore）里配置的图床域名，显式写进 @connect：
 * Tampermonkey 对声明过的域名直接放行，不再弹跨域确认；个人域名不进入公共代码。
 */
function presetConnectHosts(): string[] {
  const dir = 'presets';
  if (!fs.existsSync(dir)) return [];
  const hosts = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const json = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
      const list = json.hosts ?? json.settings?.hosts ?? [];
      for (const h of list) {
        for (const v of Object.values(h.values ?? {})) {
          if (typeof v === 'string' && /^https?:\/\//.test(v)) hosts.add(new URL(v).hostname);
        }
      }
    } catch {
      /* 忽略无效文件 */
    }
  }
  return [...hosts];
}

// 开发：npm run dev 后在浏览器打开终端提示的 *.user.js 安装一次，之后改代码页面自动热更新
// 构建：npm run build 产出 dist/nodeseek-helper.user.js
export default defineConfig({
  plugins: [
    vue(),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'NodeSeek 助手',
        namespace: 'https://github.com/nodeseek-helper',
        version: '0.1.0',
        description: 'NodeSeek 粘贴/拖拽图片自动上传图床（CloudFlare-ImgBed、兰空、EasyImage、Chevereto、SM.MS、Imgur、PicList、NodeImage、自定义），以及自定义表情包管理与快捷发送',
        icon: 'https://www.nodeseek.com/static/image/favicon/android-chrome-192x192.png',
        match: ['https://www.nodeseek.com/*', 'https://nodeseek.com/*', 'https://www.deepflood.com/*', 'https://deepflood.com/*'],
        connect: [...presetConnectHosts(), '*'],
        'run-at': 'document-end',
        grant: [
          'GM_xmlhttpRequest',
          'GM_getValue',
          'GM_setValue',
          'GM_addValueChangeListener',
          'GM_registerMenuCommand',
          'GM_setClipboard',
          'GM_addStyle',
        ],
      },
      server: { mountGmApi: false },
      build: {
        fileName: 'nodeseek-helper.user.js',
        // Vue 走 @require CDN，脚本本体保持小巧
        externalGlobals: { vue: cdn.jsdelivr('Vue', 'dist/vue.global.prod.js') },
      },
    }),
  ],
});
