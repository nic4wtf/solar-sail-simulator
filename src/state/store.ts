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

export type CameraTarget = 'earth' | 'moon' | 'spacecraft' | 'free';

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
  /** Playback speed multiplier applied to sample advance. */
  playbackSpeed: number;
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
  setPlaybackSpeed: (speed: number) => void;

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
  playbackSpeed: 1,
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
        progress: 1,
        dirty: false,
      });
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
    set({
      runState: 'playing',
      cursor: cursor >= result.samples.length - 1 ? 0 : cursor,
    });
  },

  pause: () => {
    if (get().runState === 'playing') set({ runState: 'ready' });
  },

  stop: () => {
    if (get().result) set({ runState: 'ready', cursor: 0 });
  },

  setCursor: (index) => {
    const { result } = get();
    if (!result) return;
    const max = result.samples.length - 1;
    set({ cursor: Math.max(0, Math.min(max, Math.round(index))) });
  },

  stepCursor: (delta) => {
    const { result, cursor, runState } = get();
    if (!result) return;
    const max = result.samples.length - 1;
    const next = cursor + delta;
    if (next >= max) {
      set({ cursor: max, runState: runState === 'playing' ? 'ready' : runState });
    } else {
      set({ cursor: Math.max(0, next) });
    }
  },

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

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
 * The active colour palette.
 *
 * The 3D view, the 2D canvas and the Plotly charts all read their colours
 * from here rather than from CSS, because none of them can resolve CSS custom
 * properties.
 */
export const selectPalette = (s: AppState): ThemePalette => PALETTES[s.theme];
