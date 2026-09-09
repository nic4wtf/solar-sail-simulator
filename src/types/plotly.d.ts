/**
 * Minimal ambient declarations for `plotly.js-basic-dist-min`.
 *
 * The basic bundle ships no type definitions. Rather than pull in the very
 * large `@types/plotly.js` (which describes the full library, most of which is
 * not in this bundle), only the three functions this application calls are
 * declared, with loosely typed data/layout objects.
 */
declare module 'plotly.js-basic-dist-min' {
  export interface PlotlyHTMLElement extends HTMLElement {
    on(event: string, handler: (data: unknown) => void): void;
    removeAllListeners?(event: string): void;
  }

  export function newPlot(
    root: HTMLElement,
    data: unknown[],
    layout?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Promise<PlotlyHTMLElement>;

  export function react(
    root: HTMLElement,
    data: unknown[],
    layout?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Promise<PlotlyHTMLElement>;

  export function relayout(
    root: HTMLElement,
    update: Record<string, unknown>,
  ): Promise<PlotlyHTMLElement>;

  export function purge(root: HTMLElement): void;
  export function Plots(): void;
}
