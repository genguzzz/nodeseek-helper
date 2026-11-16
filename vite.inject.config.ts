import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };

/** 把抽出的 CSS 内联进 JS（注入版只有一个文件） */
function inlineCss(): Plugin {
  return {
    name: 'nsh-inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const cssKeys = Object.keys(bundle).filter((k) => k.endsWith('.css'));
      const css = cssKeys.map((k) => (bundle[k] as { source: string }).source).join('\n');
      cssKeys.forEach((k) => delete bundle[k]);
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) {
          chunk.code = `(function(){var s=document.createElement('style');s.id='nsh-style';s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})();\n${chunk.code}`;
        }
      }
    },
  };
}

// 代理工具注入版：同一份业务代码，`$` 换成 Web 适配层，Vue 打包进产物
export default defineConfig({
  plugins: [vue(), inlineCss()],
  resolve: {
    alias: { $: fileURLToPath(new URL('./src/platform/web.ts', import.meta.url)) },
  },
  define: { 'process.env.NODE_ENV': '"production"', __NSH_VERSION__: JSON.stringify(pkg.version) },
  build: {
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: 'src/main.ts',
      name: 'NodeSeekHelper',
      formats: ['iife'],
      fileName: () => 'nodeseek-helper.inject.js',
    },
  },
});
