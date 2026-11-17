import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import monkey, { cdn } from 'vite-plugin-monkey';
import fs from 'node:fs';
import { nshDevLoader } from './dev/dev-loader';
import { presetConnectHosts } from './dev/presets';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
/** 发布地址（dist 的公开 URL），设置后写入 @updateURL / @downloadURL，油猴可自动更新 */
const publishBase = process.env.NSH_PUBLISH_BASE?.replace(/\/+$/, '');
const MATCHES = ['https://www.nodeseek.com/*', 'https://nodeseek.com/*', 'https://www.deepflood.com/*', 'https://deepflood.com/*'];

// 开发：npm run dev，首次 npm run dev:install 安装开发加载器，之后保存即热更新（见 docs/dev.md）
// 构建：npm run build 产出 dist/ 下的油猴脚本与各代理工具模块

export default defineConfig({
  define: { __NSH_VERSION__: JSON.stringify(pkg.version) },
  // 压缩脚本本体，缩短下载与解析时间（UserScript 头部由插件单独保留）
  build: { minify: 'esbuild' },
  plugins: [
    // 稳定开发加载器：/nsh-dev.user.js 只需安装一次，见 dev/dev-loader.ts
    nshDevLoader(MATCHES),
    vue(),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'NodeSeek 助手',
        namespace: 'https://github.com/genguzzz/nodeseek-helper',
        version: pkg.version,
        ...(publishBase
          ? {
              updateURL: `${publishBase}/nodeseek-helper.user.js`,
              downloadURL: `${publishBase}/nodeseek-helper.user.js`,
            }
          : {}),
        homepageURL: 'https://github.com/genguzzz/nodeseek-helper',
        supportURL: 'https://github.com/genguzzz/nodeseek-helper/issues',
        license: 'MIT',
        description: 'NodeSeek 粘贴/拖拽图片自动上传图床（CloudFlare-ImgBed、兰空、EasyImage、Chevereto、SM.MS、Imgur、PicList、NodeImage、自定义），以及自定义表情包管理与快捷发送',
        icon: 'https://www.nodeseek.com/static/image/favicon/android-chrome-192x192.png',
        match: MATCHES,
        connect: [...presetConnectHosts(), '*'],
        // document-end：在 DOMContentLoaded 时运行，不在首帧前同步执行 Vue 与脚本本体
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
