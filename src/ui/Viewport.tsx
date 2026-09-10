/**
 * Viewport: the 3D/2D view plus its overlays (toolbar, live telemetry HUD,
 * vector legend, eclipse flag) and the playback timeline beneath it.
 */

import { RAD, SEC_PER_DAY } from '../core/constants.ts';
import {
  formatAccel,
  formatDuration,
  formatLength,
  formatVelocity,
  fixed,
} from '../core/units.ts';
import { selectCurrentSample, useStore, type CameraTarget } from '../state/store.ts';
import { Scene3D } from './viz/Scene3D.tsx';
import { View2D } from './viz/View2D.tsx';

const CAMERA_LABELS: Record<CameraTarget, string> = {
  earth: 'Earth',
  moon: 'Moon',
  spacecraft: 'Craft',
  free: 'Free',
};



export function Viewport() {
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const cameraTarget = useStore((s) => s.cameraTarget);
  const setCameraTarget = useStore((s) => s.setCameraTarget);
  const showVectors = useStore((s) => s.showVectors);
  const toggleVectors = useStore((s) => s.toggleVectors);
  const showOrbitTrail = useStore((s) => s.showOrbitTrail);
  const toggleOrbitTrail = useStore((s) => s.toggleOrbitTrail);
  const showFullTrajectory = useStore((s) => s.showFullTrajectory);
  const toggleFullTrajectory = useStore((s) => s.toggleFullTrajectory);
  const result = useStore((s) => s.result);

  const isMoonRelevant =
    result?.config.centralBody === 'moon' || (result?.config.forces.moonGravity ?? false);

  return (
    <div className="viewport">
      {viewMode === '3d' ? <Scene3D /> : <View2D />}

      <div className="viewport-toolbar">
        <div className="seg">
          <button
            className={viewMode === '3d' ? 'active' : ''}
            onClick={() => setViewMode('3d')}
          >
            3D
          </button>
          <button
            className={viewMode === '2d' ? 'active' : ''}
            onClick={() => setViewMode('2d')}
          >
            2D
          </button>
        </div>

        {viewMode === '3d' && (
          <div className="seg">
            <span className="seg-label">Camera</span>
            {(['earth', 'moon', 'spacecraft', 'free'] as CameraTarget[]).map((c) => (
              <button
                key={c}
                className={cameraTarget === c ? 'active' : ''}
                onClick={() => setCameraTarget(c)}
                disabled={c === 'moon' && !isMoonRelevant}
                title={
                  c === 'moon' && !isMoonRelevant
                    ? 'Enable lunar gravity or choose a lunar scenario'
                    : c === 'free'
                      ? 'Stop following any body; drag to look around freely'
                      : `Keep the camera centred on the ${CAMERA_LABELS[c]}`
                }
              >
                {CAMERA_LABELS[c]}
              </button>
            ))}
          </div>
        )}

        <div className="seg">
          <button className={showVectors ? 'active' : ''} onClick={toggleVectors}>
            Vectors
          </button>
          <button className={showOrbitTrail ? 'active' : ''} onClick={toggleOrbitTrail}>
            Trail
          </button>
          <button
            className={showFullTrajectory ? 'active' : ''}
            onClick={toggleFullTrajectory}
            title="Show the whole propagated trajectory, including the part not yet reached"
          >
            Full path
          </button>
        </div>
      </div>

      <EclipseFlag />
      <Hud />
      {showVectors && <Legend />}
      <Timeline />
    </div>
  );
}

function EclipseFlag() {
  const sample = useStore(selectCurrentSample);
  if (!sample || sample.illumination >= 1) return null;
  const pct = sample.illumination * 100;
  return (
    <div className="eclipse-flag">
      {sample.illumination <= 0 ? 'Umbra - no sunlight' : `Penumbra - ${pct.toFixed(0)}% sunlit`}
    </div>
  );
}

function Hud() {
  const sample = useStore(selectCurrentSample);
  const result = useStore((s) => s.result);
  const runState = useStore((s) => s.runState);
  const progress = useStore((s) => s.progress);

  if (runState === 'propagating') {
    return (
      <div className="hud">
        <div className="hud-title">Propagating</div>
        <div className="hud-row">
          <span className="hud-label">Progress</span>
          <span className="hud-value">{(progress * 100).toFixed(0)}%</span>
        </div>
      </div>
    );
  }

  if (!sample || !result) {
    return (
      <div className="hud">
        <div className="hud-title">No trajectory</div>
        <div className="hud-row">
          <span className="hud-label">Press Run to propagate</span>
        </div>
      </div>
    );
  }

  const isEarth = result.config.centralBody === 'earth';

  return (
    <div className="hud">
      <div className="hud-title">Live state</div>
      <Row label="Mission time" value={formatDuration(sample.t)} />
      <Row label="Day" value={fixed(sample.t / SEC_PER_DAY, 3)} />
      <Row label="Altitude" value={formatLength(sample.altitude)} />
      <Row label="Speed" value={formatVelocity(sample.speed)} />
      <Row label="Sail accel" value={formatAccel(sample.sailAccel)} />
      <Row label="Sun incidence" value={`${fixed(sample.incidence * RAD, 1)} deg`} />
      <Row label="Sunlit" value={`${(sample.illumination * 100).toFixed(0)}%`} />
      <Row label="Semi-major axis" value={formatLength(sample.sma)} />
      <Row label="Eccentricity" value={fixed(sample.ecc, 5)} />
      <Row label="Inclination" value={`${fixed(sample.inc * RAD, 3)} deg`} />
      {Number.isFinite(sample.period) && sample.period > 0 && (
        <>
          <Row label="Revolution" value={`${Math.floor(sample.t / sample.period) + 1}`} />
          <Row
            label="Orbit phase"
            value={`${fixed(sample.argLat * RAD, 1)} deg`}
          />
        </>
      )}
      {(result.config.forces.moonGravity || !isEarth) && (
        <Row label="Moon distance" value={formatLength(sample.moonDistance)} />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="hud-row">
      <span className="hud-label">{label}</span>
      <span className="hud-value">{value}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <div className="legend-row">
        <span className="legend-swatch" style={{ background: 'var(--c-sun)' }} />
        Sun direction
      </div>
      <div className="legend-row">
        <span className="legend-swatch" style={{ background: 'var(--c-normal)' }} />
        Sail normal
      </div>
      <div className="legend-row">
        <span className="legend-swatch" style={{ background: 'var(--c-velocity)' }} />
        Velocity
      </div>
      <div className="legend-row">
        <span className="legend-swatch" style={{ background: 'var(--c-accel)' }} />
        Sail acceleration
      </div>
      <div className="legend-row">
        <span className="legend-swatch" style={{ background: 'var(--c-trail)' }} />
        Path travelled
      </div>
    </div>
  );
}

/**
 * Format a playback rate given in simulation seconds per real second.
 *
 * Shown in the unit a user thinks in ("10 min/s") rather than as a bare
 * multiplier, because the useful question is how much mission time passes per
 * second of watching.
 */
function formatRate(rate: number): string {
  if (rate < 1) return `${rate.toFixed(2)} s/s`;
  if (rate < 60) return `${Math.round(rate)} s/s`;
  if (rate < 3600) return `${(rate / 60).toFixed(rate / 60 < 10 ? 1 : 0)} min/s`;
  if (rate < 86400) return `${(rate / 3600).toFixed(rate / 3600 < 10 ? 1 : 0)} h/s`;
  return `${(rate / 86400).toFixed(rate / 86400 < 10 ? 1 : 0)} d/s`;
}

/** Preset rates, in simulation seconds per real second. */
const RATE_PRESETS: Array<{ rate: number; label: string }> = [
  { rate: 1, label: '1:1' },
  { rate: 60, label: '1 min/s' },
  { rate: 600, label: '10 min/s' },
  { rate: 3600, label: '1 h/s' },
  { rate: 86400, label: '1 d/s' },
];

function Timeline() {
  const result = useStore((s) => s.result);
  const cursor = useStore((s) => s.cursor);
  const setCursor = useStore((s) => s.setCursor);
  const stepCursor = useStore((s) => s.stepCursor);
  const playbackRate = useStore((s) => s.playbackRate);
  const setPlaybackRate = useStore((s) => s.setPlaybackRate);

  const count = result?.samples.length ?? 0;
  const sample = result && count > 0 ? result.samples[Math.min(cursor, count - 1)] : null;

  // How long one revolution takes to watch at the current rate. This is the
  // number that actually answers "is this slow enough to see the attitude
  // change through the orbit?".
  const period = sample?.period;
  const secondsPerRev =
    period && Number.isFinite(period) && playbackRate > 0 ? period / playbackRate : null;

  // Samples per revolution bounds how much attitude detail exists to be seen,
  // no matter how slowly it is played.
  const outputInterval = result?.config.integration.outputInterval;
  const samplesPerRev =
    period && Number.isFinite(period) && outputInterval ? period / outputInterval : null;

  /** Set the rate so one revolution takes `seconds` of real time. */
  const fitRevolution = (seconds: number) => {
    if (period && Number.isFinite(period)) setPlaybackRate(period / seconds);
    else if (result) setPlaybackRate(result.summary.finalTime / seconds);
  };

  // Log slider: 1 s/s to 1e6 s/s spans real time to ~11 days per second.
  const LOG_MIN = 0;
  const LOG_MAX = 6;
  const logValue = Math.log10(Math.max(1, playbackRate));

  return (
    <div className="timeline">
      <span className="timeline-time">{sample ? formatDuration(sample.t) : '--'}</span>

      <input
        className="timeline-scrub"
        type="range"
        min={0}
        max={Math.max(0, count - 1)}
        value={Math.min(cursor, Math.max(0, count - 1))}
        disabled={count === 0}
        onChange={(e) => setCursor(Number(e.target.value))}
        aria-label="Playback position"
      />

      <span className="timeline-time">
        {result ? formatDuration(result.summary.finalTime) : '--'}
      </span>

      {/* Frame stepping, for parking on a specific point in the orbit. */}
      <div className="seg">
        <button
          onClick={() => stepCursor(-1)}
          disabled={count === 0}
          title="Previous sample (Left arrow)"
          aria-label="Previous sample"
        >
          &#9666;
        </button>
        <button
          onClick={() => stepCursor(1)}
          disabled={count === 0}
          title="Next sample (Right arrow)"
          aria-label="Next sample"
        >
          &#9656;
        </button>
      </div>

      <div className="rate-control">
        <span className="seg-label">Rate</span>
        <input
          className="rate-slider"
          type="range"
          min={LOG_MIN}
          max={LOG_MAX}
          step={0.01}
          value={Math.min(LOG_MAX, Math.max(LOG_MIN, logValue))}
          onChange={(e) => setPlaybackRate(10 ** Number(e.target.value))}
          aria-label="Playback rate"
          title="Simulation time per real second"
        />
        <span className="rate-readout" title="Simulation time elapsed per real second">
          {formatRate(playbackRate)}
        </span>
      </div>

      <div className="seg">
        {RATE_PRESETS.map((p) => (
          <button
            key={p.rate}
            className={Math.abs(playbackRate - p.rate) < 1e-6 ? 'active' : ''}
            onClick={() => setPlaybackRate(p.rate)}
            title={`${formatRate(p.rate)} of mission time per real second`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => fitRevolution(30)}
          disabled={!result}
          title={
            period && Number.isFinite(period)
              ? 'Set the rate so one revolution takes 30 seconds to watch'
              : 'This trajectory is not periodic, so the whole run is fitted to 30 seconds'
          }
        >
          {period && Number.isFinite(period) ? '1 rev / 30 s' : 'Run / 30 s'}
        </button>
      </div>

      {secondsPerRev !== null && (
        <span
          className="timeline-note"
          title={
            samplesPerRev !== null
              ? `${samplesPerRev.toFixed(0)} recorded samples per revolution. The views interpolate between them, so slowing down further than this cannot reveal more attitude detail - reduce the output interval in the Simulation panel and re-run instead.`
              : undefined
          }
        >
          1 rev &asymp; {secondsPerRev < 1 ? secondsPerRev.toFixed(2) : secondsPerRev.toFixed(1)} s
          {samplesPerRev !== null && samplesPerRev < 25 && secondsPerRev > 8 && (
            <span className="timeline-warn"> &middot; only {samplesPerRev.toFixed(0)} samples/rev</span>
          )}
        </span>
      )}
    </div>
  );
}
