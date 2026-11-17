import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  // 测试环境与代理注入版一致：`$` 指向 platform/web.ts
  define: { __NSH_WEB__: 'true', __NSH_DEBUG_REPORT__: '""', __NSH_VERSION__: '"test"' },
  resolve: { alias: { $: fileURLToPath(new URL('./src/platform/web.ts', import.meta.url)) } },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] },
});
