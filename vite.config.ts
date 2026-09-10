// `vitest/config` re-exports Vite's defineConfig with the `test` key typed.
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The version shown in the app's brand chip comes from package.json.
 *
 * Hard-coding it in the JSX is how a released build ends up claiming to be a
 * version it is not: the two live in different files and only one of them is
 * on the release checklist. Injecting it at build time makes that impossible.
 */
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
