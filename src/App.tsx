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

import { useEffect } from 'react';
import { useStore, type PanelTab } from './state/store.ts';
import { Viewport } from './ui/Viewport.tsx';
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

  // Auto-run once on mount, so the application opens on a working simulation.
  useEffect(() => {
    if (!result && runState === 'idle') void run();
    // Intentionally mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leftTab = LEFT_TABS.some((t) => t.id === activeTab) ? activeTab : 'mission';
  const rightTab = RIGHT_TABS.some((t) => t.id === activeTab) ? activeTab : 'results';

  return (
    <div className="app">
      <TopBar />
      <div className="app-main">
        {/* ---------------- Left: configuration ---------------- */}
        <div className="panel">
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
        <div className="centre-column">
          <Viewport />
          <Charts />
        </div>

        {/* ---------------- Right: results / analysis ---------------- */}
        <div className="panel">
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
          <span className="brand-version">v1.0</span>
        </div>

        <span className="small muted" title={config.name}>
          {config.name}
          {dirty && hasResult && (
            <span style={{ color: 'var(--warn)' }}> - configuration changed, re-run</span>
          )}
        </span>

        <div className="topbar-spacer" />

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
            className="btn btn-icon"
            onClick={stop}
            disabled={!hasResult || propagating}
            title="Stop and rewind to the start"
          >
            &#9632;
          </button>
          <button
            className="btn btn-icon"
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
