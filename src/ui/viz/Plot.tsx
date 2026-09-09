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

import { useEffect, useRef } from 'react';
import * as Plotly from 'plotly.js-basic-dist-min';

/** Shared dark theme so every chart matches the application chrome. */
export const PLOT_COLORS = [
  '#4da3ff',
  '#ffb347',
  '#7ee081',
  '#ff7a7a',
  '#c39bff',
  '#5fd6c8',
  '#ff9ecd',
  '#b9c34d',
];

const BASE_LAYOUT: Record<string, unknown> = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: {
    color: '#aab4c8',
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
    gridcolor: '#1c2432',
    zerolinecolor: '#2b3444',
    linecolor: '#283040',
    tickfont: { size: 9.5 },
    title: { font: { size: 10 } },
  },
  yaxis: {
    gridcolor: '#1c2432',
    zerolinecolor: '#2b3444',
    linecolor: '#283040',
    tickfont: { size: 9.5 },
    title: { font: { size: 10 } },
  },
  title: { font: { size: 11.5, color: '#e8edf7' }, x: 0.01, xanchor: 'left', y: 0.98 },
};

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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const merged = mergeLayout(BASE_LAYOUT, { ...layout, height });
    // `react` updates an existing plot in place and creates one if absent, so
    // the same call handles both mount and update.
    void Plotly.react(el, data, merged, CONFIG);
  }, [data, layout, height]);

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
 */
export function cursorShape(x: number): Record<string, unknown> {
  return {
    type: 'line',
    x0: x,
    x1: x,
    yref: 'paper',
    y0: 0,
    y1: 1,
    line: { color: '#ffffff', width: 1, dash: 'dot' },
    opacity: 0.5,
  };
}
