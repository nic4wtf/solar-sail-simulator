/**
 * Thin React wrapper around Plotly.
 *
 * Hand-written rather than using `react-plotly.js`: the wrapper is ~50 lines,
 * `Plotly.react` already does efficient in-place diffing, and this avoids a
 * dependency whose React peer range has repeatedly lagged behind React itself.
 *
 * `plotly.js-basic-dist-min` is used instead of the full bundle: it contains
 * the scatter/line traces this application needs at roughly a third of the
 * download size, which matters for a static GitHub Pages deployment.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as Plotly from 'plotly.js-basic-dist-min';
import { selectPalette, useStore } from '../../state/store.ts';
import type { ThemePalette } from '../theme.ts';

/**
 * Chart theming.
 *
 * Plotly takes colours in a layout object and cannot read CSS variables, so
 * the palette comes from `theme.ts`. Both `paper_bgcolor` and `plot_bgcolor`
 * stay fully transparent in both themes so the chart sits directly on the
 * panel surface, whatever that surface currently is.
 *
 * `usePlotColors()` returns the categorical trace palette for the ACTIVE
 * theme. Charts must call it rather than importing a fixed array, or their
 * traces would keep dark-mode hues on a light background.
 */
export function usePlotColors(): { traces: string[]; osculating: string[] } {
  const p = useStore(selectPalette);
  return useMemo(
    () => ({ traces: p.plotTraces, osculating: p.plotOsculating }),
    [p],
  );
}

function baseLayout(p: ThemePalette): Record<string, unknown> {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: {
      color: p.plotFont,
      family: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      size: 10,
    },
    margin: { l: 62, r: 16, t: 26, b: 40 },
    hovermode: 'x unified',
    showlegend: true,
    legend: {
      orientation: 'h',
      y: 1.14,
      x: 0,
      font: { size: 9.5 },
      bgcolor: 'rgba(0,0,0,0)',
    },
    xaxis: {
      gridcolor: p.plotGrid,
      zerolinecolor: p.plotZeroLine,
      linecolor: p.plotAxisLine,
      tickfont: { size: 9.5 },
      title: { font: { size: 10 } },
    },
    yaxis: {
      gridcolor: p.plotGrid,
      zerolinecolor: p.plotZeroLine,
      linecolor: p.plotAxisLine,
      tickfont: { size: 9.5 },
      title: { font: { size: 10 } },
    },
    title: {
      font: { size: 11.5, color: p.plotTitle },
      x: 0.01,
      xanchor: 'left',
      y: 0.98,
    },
  };
}

const CONFIG: Record<string, unknown> = {
  displaylogo: false,
  responsive: true,
  // Keep the mode bar to the tools that are useful for engineering charts.
  modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
  toImageButtonOptions: { format: 'png', filename: 'solar-sail-plot', scale: 2 },
};

export interface PlotProps {
  data: unknown[];
  layout?: Record<string, unknown>;
  height?: number;
  /** Extra class for layout purposes. */
  className?: string;
}

/** Deep-merge helper limited to the two nesting levels the layouts use. */
function mergeLayout(
  base: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const b = out[k];
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      b &&
      typeof b === 'object' &&
      !Array.isArray(b)
    ) {
      out[k] = { ...(b as object), ...(v as object) };
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function Plot({ data, layout = {}, height = 220, className }: PlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const palette = useStore(selectPalette);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const merged = mergeLayout(baseLayout(palette), { ...layout, height });
    // `react` updates an existing plot in place and creates one if absent, so
    // the same call handles both mount and update - including a theme change,
    // which arrives here as a new `palette` and redraws with new axis colours.
    void Plotly.react(el, data, merged, CONFIG);
  }, [data, layout, height, palette]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) Plotly.purge(el);
    };
  }, []);

  return <div ref={ref} className={className ?? 'chart-box'} style={{ height }} />;
}

/**
 * Build a vertical marker line for the playback cursor, as a layout shape.
 * Charts share this so the cursor is consistent across all of them.
 *
 * The colour is passed in rather than fixed: a white cursor is invisible on a
 * light background.
 */
export function cursorShape(x: number, color = '#ffffff'): Record<string, unknown> {
  return {
    type: 'line',
    x0: x,
    x1: x,
    yref: 'paper',
    y0: 0,
    y1: 1,
    line: { color, width: 1, dash: 'dot' },
    opacity: 0.55,
  };
}
