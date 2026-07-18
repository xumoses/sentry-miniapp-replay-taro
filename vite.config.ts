import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Match sentry-miniapp's Mini Program-compatible syntax floor. The old
    // Acorn parser embedded in miniprogram-ci cannot read ES2020 operators.
    target: 'es2015',
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        react: resolve(__dirname, 'src/react/index.ts'),
      },
      formats: ['es', 'cjs'],
      // miniprogram-ci 1.x appends `.js` to bare `.cjs` entries. Publishing
      // `.cjs.js` keeps Node's CJS resolution and old Mini Program tooling aligned.
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'mjs' : 'cjs.js'}`,
    },
    rolldownOptions: {
      external: ['@sentry/core', '@tarojs/runtime', '@tarojs/taro', 'react'],
    },
    sourcemap: true,
  },
});
