/** Vite handles CSS imports as side effects; declare them for tsc. */
declare module '*.css';

/**
 * Application version, injected from package.json by Vite at build time.
 * See the `define` block in vite.config.ts.
 */
declare const __APP_VERSION__: string;
