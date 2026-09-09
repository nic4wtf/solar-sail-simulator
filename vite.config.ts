// `vitest/config` re-exports Vite's defineConfig with the `test` key typed.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built bundle works from any GitHub Pages sub-path
  // (user.github.io/solar-sail-simulator/) without hard-coding the repo name.
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          plotly: ['plotly.js-basic-dist-min'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
  },
});
