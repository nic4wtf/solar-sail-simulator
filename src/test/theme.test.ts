/**
 * Validation: theming.
 *
 * The palette is defined twice by necessity - as CSS custom properties for the
 * chrome, and as a TypeScript object for the three renderers that cannot read
 * CSS (WebGL, canvas 2D, Plotly). These tests are what stop the two halves
 * from drifting apart, and what catch a light-mode colour that has no contrast.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHROME_TOKENS,
  PALETTES,
  hexToCss,
  resolveTheme,
  type ThemePalette,
} from '../ui/theme.ts';

// Normalise line endings. The file is CRLF in a Windows working copy but
// LF in the repository (see .gitattributes), and the selector matching
// below spans two lines - so a raw read would fail on one or the other.
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  .split(String.fromCharCode(13))
  .join('');

/** Extract one `--token: value;` declaration from a given selector block. */
function tokenBlock(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, `selector ${selector} not found in styles.css`).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const m = /^\s*(--[\w-]+)\s*:\s*([^;]+);/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const darkTokens = tokenBlock(":root,\n:root[data-theme='dark']");
const lightTokens = tokenBlock(":root[data-theme='light']");

describe('CSS token parity', () => {
  it('both themes define every shared chrome token', () => {
    for (const token of CHROME_TOKENS) {
      expect(darkTokens[token], `dark is missing ${token}`).toBeDefined();
      expect(lightTokens[token], `light is missing ${token}`).toBeDefined();
    }
  });

  it('the light theme overrides every colour the dark theme defines', () => {
    // A token defined only in the dark block would leak dark-mode colour into
    // light mode, which is the most common theming bug.
    const skip = new Set(['--mono', '--sans', '--radius']);
    const missing: string[] = [];
    for (const [token, value] of Object.entries(darkTokens)) {
      if (skip.has(token)) continue;
      // Aliases that resolve through other tokens are fine to inherit.
      if (value.startsWith('var(')) continue;
      if (lightTokens[token] === undefined) missing.push(token);
    }
    expect(missing, `light theme does not override: ${missing.join(', ')}`).toEqual([]);
  });

  it('no token resolves to the same value in both themes by accident', () => {
    // Fonts and radii are shared deliberately; colours should differ.
    const shared: string[] = [];
    for (const token of CHROME_TOKENS) {
      if (darkTokens[token] === lightTokens[token]) shared.push(token);
    }
    expect(shared, `identical in both themes: ${shared.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

/** Relative luminance per WCAG 2.1. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return NaN;
  const n = parseInt(m[1], 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/** WCAG contrast ratio between two hex colours. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('text contrast', () => {
  // The panel surface is --bg-1 in both themes; body text is --text-0/1/2.
  const cases: Array<[string, Record<string, string>]> = [
    ['dark', darkTokens],
    ['light', lightTokens],
  ];

  it.each(cases)('%s: primary text meets WCAG AA on the panel surface', (_name, t) => {
    // 4.5:1 is the AA threshold for normal-size body text.
    expect(contrast(t['--text-0'], t['--bg-1'])).toBeGreaterThan(4.5);
    expect(contrast(t['--text-1'], t['--bg-1'])).toBeGreaterThan(4.5);
  });

  it.each(cases)('%s: secondary text meets WCAG AA-large on the panel surface', (_name, t) => {
    // --text-2 is used for labels and captions; 3:1 is the AA threshold for
    // large / secondary text and UI component boundaries.
    expect(contrast(t['--text-2'], t['--bg-1'])).toBeGreaterThan(3);
  });

  it.each(cases)('%s: the accent is legible on the panel surface', (_name, t) => {
    expect(contrast(t['--accent'], t['--bg-1'])).toBeGreaterThan(3);
  });

  it.each(cases)('%s: on-accent text is legible on the accent fill', (_name, t) => {
    expect(contrast(t['--on-accent'], t['--accent'])).toBeGreaterThan(3);
  });

  it.each(cases)('%s: every notice text colour is legible on its own tint', (_name, t) => {
    for (const kind of ['warn', 'err', 'ok'] as const) {
      const fg = t[`--notice-${kind}-text`];
      const bg = t[`--notice-${kind}-bg`];
      // The dark theme uses rgba() tints that this parser cannot resolve; skip
      // those and check the solid light-theme pastels, which are the ones at
      // real risk of being too pale.
      if (!fg?.startsWith('#') || !bg?.startsWith('#')) continue;
      expect(contrast(fg, bg), `notice-${kind}`).toBeGreaterThan(4.5);
    }
  });

  it.each(cases)('%s: semantic vector colours are distinguishable from the page', (_name, t) => {
    for (const v of ['--c-sun', '--c-normal', '--c-velocity', '--c-accel'] as const) {
      // These are drawn as 2 px legend swatches and as 3D arrows; 2:1 against
      // the panel is enough to be seen without being garish.
      expect(contrast(t[v], t['--bg-1']), v).toBeGreaterThan(1.9);
    }
  });
});

// ---------------------------------------------------------------------------
// JS palettes
// ---------------------------------------------------------------------------

describe('renderer palettes', () => {
  const both: Array<[string, ThemePalette]> = [
    ['dark', PALETTES.dark],
    ['light', PALETTES.light],
  ];

  it('both palettes define the same keys', () => {
    expect(Object.keys(PALETTES.dark).sort()).toEqual(Object.keys(PALETTES.light).sort());
  });

  it.each(both)('%s: name field matches its key', (name, p) => {
    expect(p.name).toBe(name);
  });

  /**
   * Numeric colour fields, listed explicitly.
   *
   * The palette also holds numeric opacities and light intensities, so
   * guessing "is this a colour?" from the magnitude does not work - a
   * `sunLightIntensity` of 2.6 is neither an opacity nor a colour.
   */
  const NUMERIC_COLOUR_KEYS = [
    'sceneBackground',
    'starColor',
    'ambientLight',
    'sunLight',
    'earthSurface',
    'earthGraticule',
    'earthEquator',
    'earthAtmosphere',
    'moonSurface',
    'moonOrbitLine',
    'trailColor',
    'futureColor',
    'craftColor',
    'sailPlaneColor',
    'vecSun',
    'vecNormal',
    'vecVelocity',
    'vecAccel',
  ] as const;

  it.each(both)('%s: every numeric colour is a valid 24-bit value', (_n, p) => {
    for (const key of NUMERIC_COLOUR_KEYS) {
      const value = p[key];
      expect(typeof value, `${key} is not a number`).toBe('number');
      expect(Number.isInteger(value), `${key} is not an integer`).toBe(true);
      expect(value, `${key} below range`).toBeGreaterThanOrEqual(0);
      expect(value, `${key} above range`).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('the numeric colour list covers every numeric colour field', () => {
    // Guards against a new colour being added to the palette but not to the
    // list above, which would silently drop it from the validation.
    const named = new Set<string>(NUMERIC_COLOUR_KEYS);
    const nonColourNumbers = new Set([
      'starOpacity',
      'ambientIntensity',
      'sunLightIntensity',
      'earthAtmosphereOpacity',
      'futureOpacity',
      'sailPlaneOpacity',
    ]);
    for (const [key, value] of Object.entries(PALETTES.dark)) {
      if (typeof value !== 'number') continue;
      expect(
        named.has(key) || nonColourNumbers.has(key),
        `${key} is a number but is in neither list - add it to one`,
      ).toBe(true);
    }
  });

  it.each(both)('%s: every CSS-string colour parses', (_n, p) => {
    for (const [key, value] of Object.entries(p)) {
      if (typeof value !== 'string') continue;
      if (key === 'name' || key === 'viewportGradient') continue;
      expect(/^#[0-9a-f]{6}$/i.test(value), `${key} = ${value}`).toBe(true);
    }
  });

  it.each(both)('%s: opacities are within [0, 1]', (_n, p) => {
    for (const key of [
      'starOpacity',
      'earthAtmosphereOpacity',
      'futureOpacity',
      'sailPlaneOpacity',
    ] as const) {
      expect(p[key]).toBeGreaterThanOrEqual(0);
      expect(p[key]).toBeLessThanOrEqual(1);
    }
  });

  it.each(both)('%s: has 8 categorical trace colours and 3 osculating', (_n, p) => {
    expect(p.plotTraces).toHaveLength(8);
    expect(p.plotOsculating).toHaveLength(3);
    // No duplicates, or two series would be indistinguishable.
    expect(new Set(p.plotTraces).size).toBe(8);
  });

  it.each(both)('%s: chart traces are legible against the panel surface', (name, p) => {
    const bg = name === 'dark' ? darkTokens['--bg-1'] : lightTokens['--bg-1'];
    for (const c of p.plotTraces) {
      expect(contrast(c, bg), `trace ${c}`).toBeGreaterThan(2);
    }
  });

  it.each(both)('%s: the spacecraft marker contrasts with the scene background', (_n, p) => {
    // This is the specific pairing that a naive theme flip gets wrong: a white
    // craft marker is invisible on a light sky.
    expect(
      contrast(hexToCss(p.craftColor), hexToCss(p.sceneBackground)),
    ).toBeGreaterThan(4);
  });

  it.each(both)('%s: the trajectory trail contrasts with the scene background', (_n, p) => {
    expect(
      contrast(hexToCss(p.trailColor), hexToCss(p.sceneBackground)),
    ).toBeGreaterThan(2.5);
  });

  it.each(both)('%s: the 2D craft marker contrasts with the canvas background', (_n, p) => {
    expect(contrast(p.canvasCraft, p.canvasBackground)).toBeGreaterThan(4);
  });

  it.each(both)('%s: the plot cursor contrasts with the panel surface', (name, p) => {
    const bg = name === 'dark' ? darkTokens['--bg-1'] : lightTokens['--bg-1'];
    expect(contrast(p.plotCursor, bg)).toBeGreaterThan(2.5);
  });

  it('the light theme hides the starfield rather than recolouring it', () => {
    // Pale dots on a pale sky read as rendering dirt.
    expect(PALETTES.light.starOpacity).toBe(0);
    expect(PALETTES.dark.starOpacity).toBeGreaterThan(0);
  });

  it('the light theme uses more ambient fill than the dark theme', () => {
    // Without it, the night side of a body becomes a black hole on a pale sky.
    expect(PALETTES.light.ambientIntensity).toBeGreaterThan(
      PALETTES.dark.ambientIntensity,
    );
  });
});

describe('theme resolution', () => {
  it('passes explicit choices straight through', () => {
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });

  it('resolves "system" to a concrete theme', () => {
    // No matchMedia in the node test environment, so this exercises the
    // fallback path: it must still return a usable value, never undefined.
    expect(['dark', 'light']).toContain(resolveTheme('system'));
  });
});

describe('hexToCss', () => {
  it('zero-pads to six digits', () => {
    expect(hexToCss(0x000000)).toBe('#000000');
    expect(hexToCss(0xff)).toBe('#0000ff');
    expect(hexToCss(0x4da3ff)).toBe('#4da3ff');
    expect(hexToCss(0xffffff)).toBe('#ffffff');
  });
});
