/**
 * Theme definition.
 *
 * WHY THIS EXISTS AS A MODULE: three of the four rendering surfaces in this
 * application cannot read CSS custom properties.
 *
 *   - Panels and chrome     -> CSS variables in styles.css
 *   - Three.js 3D view      -> numeric hex passed to materials
 *   - 2D canvas view        -> CSS colour strings passed to a 2D context
 *   - Plotly charts         -> colour strings in a layout object
 *
 * So the palette is defined ONCE here in a form all four can consume, and
 * styles.css mirrors only the chrome tokens. Anything that appears in both
 * places is listed in `CHROME_TOKENS` below and checked by a test, so the two
 * cannot silently drift apart.
 */

export type ThemeChoice = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_CHOICE_LABELS: Record<ThemeChoice, string> = {
  dark: 'Dark',
  light: 'Light',
  system: 'System',
};

/**
 * Colours needed by the canvas, WebGL and Plotly renderers.
 *
 * Semantic vector colours (Sun, sail normal, velocity, acceleration) are
 * deliberately kept close between themes: they are a legend the user learns,
 * and swapping them would break that. They are darkened in light mode only as
 * far as contrast against a pale background requires.
 */
export interface ThemePalette {
  name: ResolvedTheme;

  // --- 3D scene ---
  /** WebGL clear colour. */
  sceneBackground: number;
  /** Radial-gradient CSS for the viewport behind the canvas. */
  viewportGradient: string;
  starColor: number;
  starOpacity: number;
  ambientLight: number;
  ambientIntensity: number;
  sunLight: number;
  sunLightIntensity: number;

  earthSurface: number;
  earthGraticule: number;
  earthEquator: number;
  earthAtmosphere: number;
  earthAtmosphereOpacity: number;
  moonSurface: number;
  moonOrbitLine: number;

  // --- Heliocentric scene ---
  /** The solar disc itself. Unlit, because it is the light source. */
  sunSurface: number;
  /** Corona shell drawn just outside the disc. */
  sunGlow: number;
  sunGlowOpacity: number;
  /** Perturbing planet spheres, all one colour: they are markers, not portraits. */
  planetSurface: number;
  /** Planetary orbit reference rings. */
  planetOrbitLine: number;

  trailColor: number;
  futureColor: number;
  futureOpacity: number;
  craftColor: number;
  sailPlaneColor: number;
  sailPlaneOpacity: number;

  /** Body marker ring + label, as a CSS colour (drawn on a 2D canvas). */
  earthMarker: string;
  moonMarker: string;
  sunMarker: string;
  planetMarker: string;

  // --- Semantic vectors, as numeric hex (3D) and CSS strings (2D) ---
  vecSun: number;
  vecNormal: number;
  vecVelocity: number;
  vecAccel: number;

  // --- 2D canvas ---
  canvasBackground: string;
  canvasGrid: string;
  canvasGridMajor: string;
  canvasText: string;
  canvasEarth: string;
  canvasEarthEdge: string;
  canvasMoon: string;
  canvasTrail: string;
  canvasFuture: string;
  canvasCraft: string;

  // --- Plotly ---
  plotFont: string;
  plotGrid: string;
  plotZeroLine: string;
  plotAxisLine: string;
  plotTitle: string;
  /** Cursor line drawn over every chart. */
  plotCursor: string;
  /** Categorical trace palette. */
  plotTraces: string[];
  /** Dimmed colour for an osculating trace behind its mean counterpart. */
  plotOsculating: string[];
}

const DARK: ThemePalette = {
  name: 'dark',

  sceneBackground: 0x05070c,
  viewportGradient: 'radial-gradient(ellipse at 50% 45%, #0e1523 0%, #05070c 75%)',
  starColor: 0x8fa0c4,
  starOpacity: 0.7,
  ambientLight: 0x2a3550,
  ambientIntensity: 0.55,
  sunLight: 0xfff4e0,
  sunLightIntensity: 2.6,

  earthSurface: 0x2f6ba8,
  earthGraticule: 0x4f8fd0,
  earthEquator: 0x8fc4f5,
  earthAtmosphere: 0x4d9fe0,
  earthAtmosphereOpacity: 0.09,
  moonSurface: 0xa9a49a,
  moonOrbitLine: 0x4a4a52,

  sunSurface: 0xffd66b,
  sunGlow: 0xffb347,
  sunGlowOpacity: 0.22,
  planetSurface: 0xb98f6a,
  planetOrbitLine: 0x3b4358,

  trailColor: 0x4da3ff,
  futureColor: 0x35507a,
  futureOpacity: 0.55,
  craftColor: 0xffffff,
  sailPlaneColor: 0x9fe8a3,
  sailPlaneOpacity: 0.3,

  earthMarker: '#7fb6ee',
  moonMarker: '#d8d3c6',
  sunMarker: '#ffd479',
  planetMarker: '#d7a878',

  vecSun: 0xffd479,
  vecNormal: 0x7ee081,
  vecVelocity: 0x6fc2ff,
  vecAccel: 0xff7a7a,

  canvasBackground: '#05070c',
  canvasGrid: '#141b28',
  canvasGridMajor: '#1e2838',
  canvasText: '#74809a',
  canvasEarth: '#2f6ba8',
  canvasEarthEdge: '#5a9bd8',
  canvasMoon: '#a9a49a',
  canvasTrail: '#4da3ff',
  canvasFuture: '#35507a',
  canvasCraft: '#ffffff',

  plotFont: '#aab4c8',
  plotGrid: '#1c2432',
  plotZeroLine: '#2b3444',
  plotAxisLine: '#283040',
  plotTitle: '#e8edf7',
  plotCursor: '#ffffff',
  plotTraces: [
    '#4da3ff',
    '#ffb347',
    '#7ee081',
    '#ff7a7a',
    '#c39bff',
    '#5fd6c8',
    '#ff9ecd',
    '#b9c34d',
  ],
  plotOsculating: ['#2f6499', '#a06b1f', '#4a8a4d'],
};

/**
 * Light palette.
 *
 * Not a mechanical inversion. Two things had to change in kind rather than in
 * lightness:
 *
 *   1. The starfield is removed (opacity 0) - pale dots on a pale sky are
 *      invisible and, worse, look like rendering dirt.
 *   2. The spacecraft marker and trail flip from white/bright-blue to near-black
 *      and a deeper blue, because the original values have no contrast against
 *      a light background. The Earth stays blue and the Moon stays grey, since
 *      those read as the bodies themselves.
 *
 * Trace and vector hues are darkened rather than re-chosen, so the legend the
 * user has learned still holds.
 */
const LIGHT: ThemePalette = {
  name: 'light',

  sceneBackground: 0xeef2f8,
  viewportGradient: 'radial-gradient(ellipse at 50% 45%, #ffffff 0%, #e4eaf3 78%)',
  starColor: 0x8fa0c4,
  // Stars are hidden entirely in light mode: see the note above.
  starOpacity: 0,
  ambientLight: 0xffffff,
  // A pale scene needs much more ambient fill, or the night side of a body
  // becomes a black hole against the background.
  ambientIntensity: 1.15,
  sunLight: 0xfff8ec,
  sunLightIntensity: 2.0,

  earthSurface: 0x3f86c8,
  earthGraticule: 0x1f4f80,
  earthEquator: 0x123a63,
  earthAtmosphere: 0x2a7fc0,
  earthAtmosphereOpacity: 0.1,
  moonSurface: 0x9c968b,
  moonOrbitLine: 0xa8adb8,

  // The Sun keeps a saturated fill in light mode: a pale disc on a pale sky
  // reads as a hole rather than as a star.
  sunSurface: 0xf5a623,
  sunGlow: 0xf5a623,
  sunGlowOpacity: 0.16,
  planetSurface: 0x9c6f47,
  planetOrbitLine: 0xb9bfcb,

  trailColor: 0x1565c0,
  // The not-yet-travelled path overlaps itself heavily - a 7-day LEO run is
  // ~106 revolutions whose planes precess under J2 - so on a light background
  // it accumulates into a solid band that dominates the view. Dark mode gets
  // away with 0.55 because the colour is dark-on-dark; light mode needs a
  // paler colour AND a lower opacity.
  futureColor: 0xb9c8dc,
  futureOpacity: 0.4,
  craftColor: 0x11161f,
  sailPlaneColor: 0x2f9e46,
  sailPlaneOpacity: 0.34,

  earthMarker: '#1a5c9e',
  moonMarker: '#6d675d',
  sunMarker: '#b26a00',
  planetMarker: '#7a4f28',

  vecSun: 0xc98a00,
  vecNormal: 0x1f8f3c,
  vecVelocity: 0x1273c4,
  vecAccel: 0xd33232,

  canvasBackground: '#f4f7fb',
  canvasGrid: '#dde4ee',
  canvasGridMajor: '#c3cede',
  canvasText: '#5b6678',
  canvasEarth: '#3f86c8',
  canvasEarthEdge: '#1f4f80',
  canvasMoon: '#9c968b',
  canvasTrail: '#1565c0',
  canvasFuture: '#c6d2e2',
  canvasCraft: '#11161f',

  plotFont: '#4a5566',
  plotGrid: '#e2e8f1',
  plotZeroLine: '#c3ccd9',
  plotAxisLine: '#c9d2df',
  plotTitle: '#161d27',
  plotCursor: '#1b2430',
  plotTraces: [
    '#1565c0',
    '#b26a00',
    '#1f8f3c',
    '#c62828',
    '#7b3fbf',
    '#0f8b80',
    '#c2185b',
    '#6f7a1f',
  ],
  plotOsculating: ['#8fb4dc', '#dcbb8a', '#9dcaa8'],
};

export const PALETTES: Record<ResolvedTheme, ThemePalette> = { dark: DARK, light: LIGHT };

/** Numeric hex to a `#rrggbb` string, for the canvas and Plotly consumers. */
export const hexToCss = (hex: number): string =>
  `#${hex.toString(16).padStart(6, '0')}`;

// ---------------------------------------------------------------------------
// Theme resolution and persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'solar-sail-theme';

/** Read the stored preference, defaulting to `system`. */
export function loadThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    // localStorage can throw in a sandboxed iframe or with cookies blocked;
    // a missing preference is not worth failing the app over.
  }
  return 'system';
}

export function saveThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* ignore - see loadThemeChoice */
  }
}

/** True when the OS/browser reports a dark colour-scheme preference. */
export function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** Resolve a choice to an actual theme. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return choice;
}

/**
 * Stamp the resolved theme onto the document root.
 *
 * `data-theme` is always set EXPLICITLY, even for the `system` choice, so
 * styles.css only needs two concrete states and never has to combine an
 * attribute selector with a `prefers-color-scheme` media query. `color-scheme`
 * is set alongside it so form controls, scrollbars and the canvas fallback
 * background follow the theme too.
 */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

/** Tokens that must exist in BOTH the CSS palettes. Checked by a test. */
export const CHROME_TOKENS = [
  '--bg-0',
  '--bg-1',
  '--bg-2',
  '--bg-3',
  '--bg-4',
  '--line',
  '--line-strong',
  '--text-0',
  '--text-1',
  '--text-2',
  '--accent',
  '--accent-dim',
  '--c-sun',
  '--c-normal',
  '--c-velocity',
  '--c-accel',
  '--c-orbit',
  '--c-trail',
  '--c-moon',
  '--c-earth',
  '--warn',
  '--err',
  '--ok',
  '--viewport-bg',
  '--hud-bg',
  '--shadow',
] as const;
