/**
 * Application shell.
 *
 * Three-column engineering layout: configuration on the left, the trajectory
 * view (with a charts drawer beneath it) in the centre, results and analysis on
 * the right. The centre column is the visual centrepiece, per spec S24.
 *
 * The app auto-runs the default scenario on first mount so the user sees a
 * working simulation immediately (spec S34) rather than an empty viewport.
 */

import { useEffect, useRef } from 'react';
import { useStore, type MobilePane, type PanelTab } from './state/store.ts';
import { PlaybackRateControl, Viewport } from './ui/Viewport.tsx';
import { Charts } from './ui/panels/Charts.tsx';
import { MissionPanel } from './ui/panels/MissionPanel.tsx';
import { SpacecraftPanel } from './ui/panels/SpacecraftPanel.tsx';
import { SailPanel } from './ui/panels/SailPanel.tsx';
import { AttitudePanel } from './ui/panels/AttitudePanel.tsx';
import { SimulationPanel } from './ui/panels/SimulationPanel.tsx';
import { ResultsPanel } from './ui/panels/ResultsPanel.tsx';
import { SensitivityPanel } from './ui/panels/SensitivityPanel.tsx';
import { DocsPanel } from './ui/panels/DocsPanel.tsx';
import { Notice } from './ui/widgets/Controls.tsx';
import { THEME_CHOICE_LABELS, type ThemeChoice } from './ui/theme.ts';

const LEFT_TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'mission', label: 'Mission' },
  { id: 'spacecraft', label: 'Spacecraft' },
  { id: 'sail', label: 'Solar Sail' },
  { id: 'attitude', label: 'Attitude' },
  { id: 'simulation', label: 'Simulation' },
];

const RIGHT_TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'results', label: 'Results' },
  { id: 'sensitivity', label: 'Sensitivity' },
  { id: 'docs', label: 'Physics / Model' },
];

export default function App() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const run = useStore((s) => s.run);
  const result = useStore((s) => s.result);
  const runState = useStore((s) => s.runState);
  const mobilePane = useStore((s) => s.mobilePane);
  const syncSystemTheme = useStore((s) => s.syncSystemTheme);

  // Auto-run once on mount, so the application opens on a working simulation.
  useEffect(() => {
    if (!result && runState === 'idle') void run();
    // Intentionally mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Playback keyboard shortcuts. Stepping one sample at a time is the only
  // practical way to park on a specific point in the orbit and read the exact
  // attitude there, so it gets arrow keys as well as buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never hijack typing in a field.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const st = useStore.getState();
      if (e.key === ' ') {
        e.preventDefault();
        if (st.runState === 'playing') st.pause();
        else st.play();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        st.pause();
        st.stepCursor(e.shiftKey ? -10 : -1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        st.pause();
        st.stepCursor(e.shiftKey ? 10 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Follow the OS colour-scheme while the user's choice is "system". The
  // store ignores the call for any other choice, so the listener can stay
  // attached unconditionally.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => syncSystemTheme();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [syncSystemTheme]);

  const leftTab = LEFT_TABS.some((t) => t.id === activeTab) ? activeTab : 'mission';
  const rightTab = RIGHT_TABS.some((t) => t.id === activeTab) ? activeTab : 'results';

  /*
   * Switching tabs scrolls the panel back to the top.
   *
   * Without this the new panel opens at whatever offset the previous one was
   * scrolled to, so tapping "Spacecraft" after scrolling through Mission
   * lands you in the middle of the mass budget with a half-visible field
   * above. Barely noticeable in a 340 px desktop column; disorienting on a
   * phone, where the panel IS the screen.
   */
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    leftRef.current?.scrollTo({ top: 0 });
  }, [leftTab]);
  useEffect(() => {
    rightRef.current?.scrollTo({ top: 0 });
  }, [rightTab]);

  return (
    <div className="app">
      <TopBar />
      <div className="app-main" data-pane={mobilePane}>
        {/* ---------------- Left: configuration ---------------- */}
        <div className="panel pane pane-build" ref={leftRef}>
          <div className="panel-tabs">
            {LEFT_TABS.map((t) => (
              <button
                key={t.id}
                className={`panel-tab ${leftTab === t.id ? 'active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {leftTab === 'mission' && <MissionPanel />}
          {leftTab === 'spacecraft' && <SpacecraftPanel />}
          {leftTab === 'sail' && <SailPanel />}
          {leftTab === 'attitude' && <AttitudePanel />}
          {leftTab === 'simulation' && <SimulationPanel />}
        </div>

        {/* ---------------- Centre: view + charts ---------------- */}
        <div className="centre-column pane pane-view">
          <Viewport />
          <Charts />
        </div>

        {/* ---------------- Right: results / analysis ---------------- */}
        <div className="panel pane pane-results" ref={rightRef}>
          <div className="panel-tabs">
            {RIGHT_TABS.map((t) => (
              <button
                key={t.id}
                className={`panel-tab ${rightTab === t.id ? 'active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {rightTab === 'results' && <ResultsPanel />}
          {rightTab === 'sensitivity' && <SensitivityPanel />}
          {rightTab === 'docs' && <DocsPanel />}
        </div>
      </div>
      <MobileNav />
    </div>
  );
}

/**
 * Bottom navigation between the three working areas, shown only on a narrow
 * display.
 *
 * At the bottom rather than the top because that is where a thumb reaches on
 * a phone, and because the top bar is already carrying the Run control. The
 * three destinations mirror the desktop layout's three columns, so the mental
 * model is the same on both.
 */
function MobileNav() {
  const mobilePane = useStore((s) => s.mobilePane);
  const setMobilePane = useStore((s) => s.setMobilePane);
  const dirty = useStore((s) => s.dirty);
  const result = useStore((s) => s.result);

  const items: Array<{ id: MobilePane; label: string; glyph: string; hint: string }> = [
    { id: 'build', label: 'Build', glyph: '\u2699', hint: 'Scenario, orbit, sail and steering' },
    { id: 'view', label: 'View', glyph: '\u25C9', hint: 'Trajectory view and charts' },
    { id: 'results', label: 'Results', glyph: '\u2261', hint: 'Results, sensitivity and physics' },
  ];

  return (
    <nav className="mobile-nav" aria-label="Sections">
      {items.map((it) => (
        <button
          key={it.id}
          className={`mobile-nav-btn ${mobilePane === it.id ? 'active' : ''}`}
          onClick={() => setMobilePane(it.id)}
          aria-current={mobilePane === it.id ? 'page' : undefined}
          title={it.hint}
        >
          <span className="mobile-nav-glyph" aria-hidden="true">
            {it.glyph}
          </span>
          <span className="mobile-nav-label">{it.label}</span>
          {/* A dot on Build when the configuration has moved on from the last
              run, since on a phone the "re-run" note in the top bar is one of
              the things there is no room for. */}
          {it.id === 'build' && dirty && result && <span className="mobile-nav-dot" />}
        </button>
      ))}
    </nav>
  );
}

/**
 * Light / dark / system selector.
 *
 * "System" is a first-class option rather than just an initial default, so a
 * user who switches their OS theme during the day does not have to come back
 * and change it here. The resolved theme is stamped onto <html> by the store.
 */
function ThemeToggle() {
  const choice = useStore((s) => s.themeChoice);
  const resolved = useStore((s) => s.theme);
  const setThemeChoice = useStore((s) => s.setThemeChoice);

  const glyph: Record<ThemeChoice, string> = {
    light: '\u2600',
    dark: '\u263D',
    system: '\u25D0',
  };

  return (
    <div className="seg" role="group" aria-label="Colour theme">
      <span className="seg-label">Theme</span>
      {(['light', 'dark', 'system'] as ThemeChoice[]).map((c) => (
        <button
          key={c}
          className={choice === c ? 'active' : ''}
          onClick={() => setThemeChoice(c)}
          aria-pressed={choice === c}
          title={
            c === 'system'
              ? `Follow the operating system (currently ${resolved})`
              : `${THEME_CHOICE_LABELS[c]} theme`
          }
        >
          <span aria-hidden="true">{glyph[c]}</span>
          <span className="seg-btn-text"> {THEME_CHOICE_LABELS[c]}</span>
        </button>
      ))}
    </div>
  );
}

function TopBar() {
  const runState = useStore((s) => s.runState);
  const progress = useStore((s) => s.progress);
  const dirty = useStore((s) => s.dirty);
  const result = useStore((s) => s.result);
  const runError = useStore((s) => s.runError);
  const config = useStore((s) => s.config);

  const run = useStore((s) => s.run);
  const cancel = useStore((s) => s.cancel);
  const play = useStore((s) => s.play);
  const pause = useStore((s) => s.pause);
  const stop = useStore((s) => s.stop);
  const reset = useStore((s) => s.reset);

  const propagating = runState === 'propagating';
  const hasResult = !!result && result.samples.length > 1;

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <span className="brand-name">Solar Sail Simulator</span>
          <span className="brand-version">v{__APP_VERSION__}</span>
        </div>

        <span className="small muted desktop-only" title={config.name}>
          {config.name}
          {dirty && hasResult && (
            <span style={{ color: 'var(--warn)' }}> - configuration changed, re-run</span>
          )}
        </span>

        <div className="topbar-spacer" />

        {/* Placed beside the run buttons: choosing a rate is part of setting
            up a viewing session, not of navigating within one. On a narrow
            screen there is no room, and it reappears inside the view's own
            toolbar instead - see Viewport. */}
        <div className="desktop-only">
          <PlaybackRateControl />
        </div>

        <ThemeToggle />

        <div className="run-controls">
          {propagating ? (
            <button className="btn" onClick={cancel}>
              Cancel ({(progress * 100).toFixed(0)}%)
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void run()}>
              Run
            </button>
          )}

          <button
            className="btn btn-icon"
            onClick={play}
            disabled={!hasResult || runState === 'playing' || propagating}
            title="Play"
          >
            &#9654;
          </button>
          <button
            className="btn btn-icon"
            onClick={pause}
            disabled={runState !== 'playing'}
            title="Pause"
          >
            &#10073;&#10073;
          </button>
          <button
            className="btn btn-icon desktop-only"
            onClick={stop}
            disabled={!hasResult || propagating}
            title="Stop and rewind to the start"
          >
            &#9632;
          </button>
          {/* Dropped on a narrow screen: rewinding is a drag of the timeline
              scrubber away, and a full reset lives in Build > Save, load and
              reset - neither is worth a permanent button at 390 px. */}
          <button
            className="btn btn-icon desktop-only"
            onClick={reset}
            disabled={propagating}
            title="Reset the whole configuration to the default scenario"
          >
            &#8635;
          </button>
        </div>
      </div>

      <div className="progress-strip">
        {propagating && (
          <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
        )}
      </div>

      {runError && (
        <div style={{ padding: '0 14px' }}>
          <Notice kind="error" title="Simulation failed">
            {runError}
          </Notice>
        </div>
      )}
    </>
  );
}
