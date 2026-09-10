/**
 * Application state.
 *
 * Zustand rather than Context + reducers: there are ~60 independent numeric
 * parameters and several high-frequency values (the playback cursor updates at
 * 60 Hz), and selector-based subscriptions let the 3D view re-render on the
 * cursor while the parameter panels stay untouched.
 *
 * The store holds UI state and simulation RESULTS. It contains no physics -
 * every computation is delegated to `src/core` and `src/sim`.
 */

import { create } from 'zustand';
import type { SimulationConfig, SimulationResult } from '../sim/types.ts';
import type { SweepRequest, SweepResult } from '../sim/sensitivity.ts';
import { propagate } from '../sim/propagator.ts';
import { runSweep } from '../sim/sensitivity.ts';
import { buildScenario, defaultConfig } from '../sim/scenarios.ts';
import { PRESETS_BY_ID } from '../sim/presets.ts';
import { clearExpressionCache } from '../core/attitude/rules.ts';
import {
  type ResolvedTheme,
  type ThemeChoice,
  PALETTES,
  type ThemePalette,
  applyTheme,
  loadThemeChoice,
  resolveTheme,
  saveThemeChoice,
} from '../ui/theme.ts';

export type RunState = 'idle' | 'propagating' | 'ready' | 'playing';

export type ViewMode = '3d' | '2d';

export type CameraTarget = 'earth' | 'moon' | 'sun' | 'spacecraft' | 'free';

export type PanelTab =
  | 'mission'
  | 'spacecraft'
  | 'sail'
  | 'attitude'
  | 'simulation'
  | 'results'
  | 'sensitivity'
  | 'docs';

/** A stored run kept for comparison against the current one. */
export interface ComparisonRun {
  id: string;
  label: string;
  result: SimulationResult;
}

interface AppState {
  // --- Configuration ---------------------------------------------------
  config: SimulationConfig;
  /** True when the config has changed since the last completed run. */
  dirty: boolean;

  // --- Run state -------------------------------------------------------
  runState: RunState;
  progress: number;
  result: SimulationResult | null;
  /** Error message from the last failed run attempt. */
  runError: string | null;

  // --- Playback --------------------------------------------------------
  /** Index into `result.samples` currently displayed. */
  cursor: number;
  /**
   * Playback rate in SIMULATION SECONDS PER REAL SECOND.
   *
   * Deliberately not a "speed multiplier" over sample advance, which is what
   * this used to be. That older scheme advanced N samples per animation
   * frame, so the actual rate depended on the output interval AND the display
   * refresh rate: its slowest setting still ran a LEO revolution past in 2.5
   * real seconds, and the same "0.25x" meant a different speed in every
   * scenario. Simulation-time-per-real-time is frame-rate independent,
   * scenario independent, and directly answerable ("how long will one
   * revolution take to watch?").
   */
  playbackRate: number;
  /**
   * True while the rate is still being chosen automatically.
   *
   * A solar-sail study has two timescales of interest that are ~100x apart:
   * the ATTITUDE dynamics within one revolution, and the ORBIT evolution over
   * the whole mission. No single rate serves both - at "1 revolution per 30
   * seconds" the default 7-day run takes 53 minutes to play, and at "whole
   * run per 30 seconds" a revolution flashes past in 0.28 s.
   *
   * So the rate defaults to the mission scale (the whole run in ~30 s, which
   * is what you want to see first after pressing Run) and refits itself to
   * each new run - until the user picks a rate, after which their choice is
   * respected across re-runs so A/B comparisons stay comparable.
   */
  rateAuto: boolean;
  /**
   * Fractional position between `cursor` and `cursor + 1`, 0..1.
   *
   * Recorded samples are far apart compared with a display frame - the
   * default LEO run has ~38 samples per revolution - so playing back on
   * sample boundaries alone judders badly at the slow rates this control
   * exists to provide. The views interpolate across this fraction.
   */
  cursorFrac: number;
  /** Whether the trajectory trail shows the whole run or only the past. */
  showFullTrajectory: boolean;

  // --- Theme -----------------------------------------------------------
  /** The user's preference, which may be 'system'. */
  themeChoice: ThemeChoice;
  /** The concrete theme in force, after resolving 'system'. */
  theme: ResolvedTheme;

  // --- View ------------------------------------------------------------
  viewMode: ViewMode;
  cameraTarget: CameraTarget;
  showVectors: boolean;
  showOrbitTrail: boolean;
  activeTab: PanelTab;

  // --- Comparison ------------------------------------------------------
  comparisons: ComparisonRun[];

  // --- Sensitivity -----------------------------------------------------
  sweep: SweepResult | null;
  sweepRunning: boolean;
  sweepProgress: { completed: number; total: number };

  // --- Actions ---------------------------------------------------------
  setConfig: (updater: (cfg: SimulationConfig) => void) => void;
  replaceConfig: (cfg: SimulationConfig, options?: { keepResult?: boolean }) => void;
  loadScenario: (id: string) => void;
  loadPreset: (id: string) => void;
  reset: () => void;

  run: () => Promise<void>;
  cancel: () => void;

  play: () => void;
  pause: () => void;
  stop: () => void;
  setCursor: (index: number) => void;
  stepCursor: (delta: number) => void;
  setPlaybackRate: (rate: number) => void;
  /** Derive the rate from a viewing time for one revolution or the whole run. */
  fitPlaybackRate: (
    scale: 'revolution' | 'mission',
    seconds: number,
    auto?: boolean,
  ) => void;
  /**
   * Advance playback by a real-time delta [s]. Called from the render loop,
   * which owns the frame clock.
   */
  advancePlayback: (realDeltaSeconds: number) => void;

  setThemeChoice: (choice: ThemeChoice) => void;
  /** Re-resolve 'system' after an OS colour-scheme change. */
  syncSystemTheme: () => void;

  setViewMode: (mode: ViewMode) => void;
  setCameraTarget: (target: CameraTarget) => void;
  setActiveTab: (tab: PanelTab) => void;
  toggleVectors: () => void;
  toggleOrbitTrail: () => void;
  toggleFullTrajectory: () => void;

  storeComparison: (label?: string) => void;
  removeComparison: (id: string) => void;
  clearComparisons: () => void;

  startSweep: (request: SweepRequest) => Promise<void>;
  cancelSweep: () => void;
}

/**
 * Cancellation flags live outside the store: they are read inside tight
 * propagation loops where a React state read would be both slow and stale.
 */
let cancelRequested = false;
let sweepCancelRequested = false;
let comparisonCounter = 0;

const initialThemeChoice = loadThemeChoice();
const initialTheme = resolveTheme(initialThemeChoice);
// Stamp at module load, before React's first paint, so the page never flashes
// the wrong theme.
if (typeof document !== 'undefined') applyTheme(initialTheme);

export const useStore = create<AppState>((set, get) => ({
  config: defaultConfig(),
  dirty: true,

  runState: 'idle',
  progress: 0,
  result: null,
  runError: null,

  cursor: 0,
  // 600 s of mission time per real second = 10 simulated minutes per second.
  // A 95-minute LEO revolution then takes ~9.5 s to watch, which is slow
  // enough to follow the sail attitude through it.
  // Overwritten by the auto-fit as soon as the first run completes.
  playbackRate: 600,
  rateAuto: true,
  cursorFrac: 0,
  showFullTrajectory: true,

  themeChoice: initialThemeChoice,
  theme: initialTheme,

  viewMode: '3d',
  cameraTarget: 'earth',
  showVectors: true,
  showOrbitTrail: true,
  activeTab: 'mission',

  comparisons: [],

  sweep: null,
  sweepRunning: false,
  sweepProgress: { completed: 0, total: 0 },

  // -------------------------------------------------------------------
  setConfig: (updater) => {
    const next = structuredClone(get().config);
    updater(next);
    // A changed attitude expression must invalidate the compiled-formula cache.
    clearExpressionCache();
    set({ config: next, dirty: true });
  },

  replaceConfig: (cfg, options) => {
    clearExpressionCache();
    set({
      config: cfg,
      dirty: true,
      ...(options?.keepResult
        ? {}
        : { result: null, runState: 'idle', cursor: 0, progress: 0, runError: null }),
    });
  },

  loadScenario: (id) => {
    const cfg = buildScenario(id, get().config.epoch);
    get().replaceConfig(cfg);
  },

  loadPreset: (id) => {
    const preset = PRESETS_BY_ID.get(id);
    if (!preset) return;
    get().replaceConfig(preset.build(get().config.epoch));
  },

  reset: () => {
    set({
      config: defaultConfig(),
      dirty: true,
      result: null,
      runState: 'idle',
      cursor: 0,
      progress: 0,
      runError: null,
      sweep: null,
    });
  },

  // -------------------------------------------------------------------
  run: async () => {
    if (get().runState === 'propagating') return;
    cancelRequested = false;
    set({ runState: 'propagating', progress: 0, runError: null });

    try {
      const result = await propagate(get().config, {
        onProgress: (f) => set({ progress: f }),
        shouldCancel: () => cancelRequested,
      });

      if (cancelRequested && result.samples.length < 2) {
        set({ runState: 'idle', progress: 0 });
        return;
      }

      set({
        result,
        // Auto-play so pressing Run immediately shows the orbit evolving,
        // which is what the user asked for by pressing Run.
        runState: 'playing',
        cursor: 0,
        cursorFrac: 0,
        progress: 1,
        dirty: false,
      });

      // Fit the whole run into ~30 s unless the user has chosen a rate. The
      // mission scale is the right first view: it answers "what happened over
      // the mission", and the Attitude preset is one click away for detail.
      if (get().rateAuto) get().fitPlaybackRate('mission', 30, true);
    } catch (err) {
      set({
        runState: 'idle',
        progress: 0,
        runError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  cancel: () => {
    cancelRequested = true;
  },

  // -------------------------------------------------------------------
  play: () => {
    const { result, cursor } = get();
    if (!result || result.samples.length < 2) return;
    // Restarting from the end rewinds, which is what a Play press means there.
    const atEnd = cursor >= result.samples.length - 1;
    set({
      runState: 'playing',
      cursor: atEnd ? 0 : cursor,
      ...(atEnd ? { cursorFrac: 0 } : {}),
    });
  },

  pause: () => {
    if (get().runState === 'playing') set({ runState: 'ready' });
  },

  stop: () => {
    if (get().result) set({ runState: 'ready', cursor: 0, cursorFrac: 0 });
  },

  setCursor: (index) => {
    const { result } = get();
    if (!result) return;
    const max = result.samples.length - 1;
    // Scrubbing lands exactly on a sample, so the readouts are exact values
    // rather than interpolated ones.
    set({ cursor: Math.max(0, Math.min(max, Math.round(index))), cursorFrac: 0 });
  },

  stepCursor: (delta) => {
    const { result, cursor, runState } = get();
    if (!result) return;
    const max = result.samples.length - 1;
    const next = cursor + delta;
    if (next >= max) {
      set({
        cursor: max,
        cursorFrac: 0,
        runState: runState === 'playing' ? 'ready' : runState,
      });
    } else {
      set({ cursor: Math.max(0, next), cursorFrac: 0 });
    }
  },

  setPlaybackRate: (rate) =>
    // Clamped to the range the UI slider exposes; 1e7 is about 4 months of
    // mission time per second, beyond which nothing is discernible.
    // An explicit choice also disables the per-run auto-fit.
    set({ playbackRate: Math.max(0.1, Math.min(1e7, rate)), rateAuto: false }),

  /**
   * Set the rate from a target wall-clock viewing time, without counting as a
   * manual choice if `auto` is set.
   *
   * `scale: 'revolution'` fits one orbital revolution into `seconds`;
   * `scale: 'mission'` fits the entire run into `seconds`.
   */
  fitPlaybackRate: (scale, seconds, auto = false) => {
    const { result } = get();
    if (!result || seconds <= 0) return;

    let span: number | null = null;
    if (scale === 'revolution') {
      const s = result.samples[Math.min(get().cursor, result.samples.length - 1)];
      // Fall back to the whole run when the trajectory is not periodic (an
      // escape or a lunar transfer has no revolution to fit).
      span = s && Number.isFinite(s.period) && s.period > 0 ? s.period : null;
    }
    if (span === null) span = result.summary.finalTime;
    if (!(span > 0)) return;

    const rate = Math.max(0.1, Math.min(1e7, span / seconds));
    set({ playbackRate: rate, ...(auto ? {} : { rateAuto: false }) });
  },

  advancePlayback: (realDelta) => {
    const { result, runState, cursor, cursorFrac, playbackRate } = get();
    if (runState !== 'playing' || !result) return;

    const samples = result.samples;
    const max = samples.length - 1;
    if (max < 1) return;
    if (cursor >= max) {
      set({ cursor: max, cursorFrac: 0, runState: 'ready' });
      return;
    }

    // Guard against a huge delta after a background tab resumes, which would
    // otherwise jump the whole run in one frame.
    const dt = Math.min(Math.max(realDelta, 0), 0.25);
    let remainingSim = playbackRate * dt;
    let i = cursor;
    let frac = cursorFrac;

    // Walk forward through sample intervals. Intervals are uniform in
    // practice but the adaptive integrator can vary them, so each is measured
    // rather than assumed.
    while (i < max && remainingSim > 0) {
      const span = samples[i + 1].t - samples[i].t;
      if (span <= 0) {
        i++;
        frac = 0;
        continue;
      }
      const leftInInterval = (1 - frac) * span;
      if (remainingSim < leftInInterval) {
        frac += remainingSim / span;
        remainingSim = 0;
      } else {
        remainingSim -= leftInInterval;
        i++;
        frac = 0;
      }
    }

    if (i >= max) set({ cursor: max, cursorFrac: 0, runState: 'ready' });
    else set({ cursor: i, cursorFrac: frac });
  },

  // -------------------------------------------------------------------
  setThemeChoice: (choice) => {
    const theme = resolveTheme(choice);
    saveThemeChoice(choice);
    applyTheme(theme);
    set({ themeChoice: choice, theme });
  },

  syncSystemTheme: () => {
    // Only meaningful while the user's choice is 'system'.
    if (get().themeChoice !== 'system') return;
    const theme = resolveTheme('system');
    if (theme === get().theme) return;
    applyTheme(theme);
    set({ theme });
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setCameraTarget: (target) => set({ cameraTarget: target }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleVectors: () => set((s) => ({ showVectors: !s.showVectors })),
  toggleOrbitTrail: () => set((s) => ({ showOrbitTrail: !s.showOrbitTrail })),
  toggleFullTrajectory: () => set((s) => ({ showFullTrajectory: !s.showFullTrajectory })),

  // -------------------------------------------------------------------
  storeComparison: (label) => {
    const { result, comparisons } = get();
    if (!result) return;
    comparisonCounter++;
    const id = `cmp-${comparisonCounter}`;
    set({
      comparisons: [
        ...comparisons,
        { id, label: label ?? `${result.config.name} (${comparisonCounter})`, result },
      ].slice(-6), // keep the store bounded
    });
  },

  removeComparison: (id) =>
    set((s) => ({ comparisons: s.comparisons.filter((c) => c.id !== id) })),

  clearComparisons: () => set({ comparisons: [] }),

  // -------------------------------------------------------------------
  startSweep: async (request) => {
    if (get().sweepRunning) return;
    sweepCancelRequested = false;
    set({ sweepRunning: true, sweepProgress: { completed: 0, total: request.samples } });
    try {
      const sweep = await runSweep(get().config, request, {
        onProgress: (completed, total) => set({ sweepProgress: { completed, total } }),
        shouldCancel: () => sweepCancelRequested,
      });
      set({ sweep, sweepRunning: false });
    } catch (err) {
      set({
        sweepRunning: false,
        runError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  cancelSweep: () => {
    sweepCancelRequested = true;
  },
}));

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** The sample currently under the playback cursor, if any. */
export const selectCurrentSample = (s: AppState) =>
  s.result && s.result.samples.length > 0
    ? s.result.samples[Math.min(s.cursor, s.result.samples.length - 1)]
    : null;

export const selectSampleCount = (s: AppState) => s.result?.samples.length ?? 0;

/**
 * Interpolated display state at `cursor + cursorFrac`.
 *
 * Position and the sail vectors are interpolated so slow playback is smooth
 * rather than a staircase. The interpolation is between two genuinely
 * computed samples and spans at most one output interval (2.7% of a
 * revolution in the default LEO), so a sharp attitude switch appears smoothed
 * over that much. HUD NUMBERS deliberately use the nearest sample instead -
 * see `selectCurrentSample` - so every figure shown is a real computed value.
 */
export function interpolatedState(
  s: AppState,
): { x: number; y: number; z: number; nx: number; ny: number; nz: number; ax: number; ay: number; az: number } | null {
  const res = s.result;
  if (!res || res.samples.length === 0) return null;
  const max = res.samples.length - 1;
  const i = Math.min(s.cursor, max);
  const a = res.samples[i];
  if (i >= max || s.cursorFrac <= 0) {
    return { x: a.x, y: a.y, z: a.z, nx: a.nx, ny: a.ny, nz: a.nz, ax: a.ax, ay: a.ay, az: a.az };
  }
  const b = res.samples[i + 1];
  const f = s.cursorFrac;
  const l = (p: number, q: number) => p + (q - p) * f;
  return {
    x: l(a.x, b.x),
    y: l(a.y, b.y),
    z: l(a.z, b.z),
    nx: l(a.nx, b.nx),
    ny: l(a.ny, b.ny),
    nz: l(a.nz, b.nz),
    ax: l(a.ax, b.ax),
    ay: l(a.ay, b.ay),
    az: l(a.az, b.az),
  };
}

/**
 * The active colour palette.
 *
 * The 3D view, the 2D canvas and the Plotly charts all read their colours
 * from here rather than from CSS, because none of them can resolve CSS custom
 * properties.
 */
export const selectPalette = (s: AppState): ThemePalette => PALETTES[s.theme];
