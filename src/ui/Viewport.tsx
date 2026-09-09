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

const SPEEDS = [0.25, 1, 4, 16, 64];

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

function Timeline() {
  const result = useStore((s) => s.result);
  const cursor = useStore((s) => s.cursor);
  const setCursor = useStore((s) => s.setCursor);
  const playbackSpeed = useStore((s) => s.playbackSpeed);
  const setPlaybackSpeed = useStore((s) => s.setPlaybackSpeed);

  const count = result?.samples.length ?? 0;
  const sample = result && count > 0 ? result.samples[Math.min(cursor, count - 1)] : null;

  return (
    <div className="timeline">
      <span className="timeline-time">
        {sample ? formatDuration(sample.t) : '--'}
      </span>
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
      <div className="seg">
        <span className="seg-label">Speed</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={playbackSpeed === s ? 'active' : ''}
            onClick={() => setPlaybackSpeed(s)}
            title={`${s} samples per frame`}
          >
            {s < 1 ? `${s}x` : `${s}x`}
          </button>
        ))}
      </div>
    </div>
  );
}
