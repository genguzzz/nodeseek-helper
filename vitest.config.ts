import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { $: fileURLToPath(new URL('./src/platform/web.ts', import.meta.url)) } },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] },
});
