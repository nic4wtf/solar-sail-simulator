/**
 * Viewport: the 3D/2D view plus its overlays (toolbar, live telemetry HUD,
 * vector legend, eclipse flag) and the playback timeline beneath it.
 */

import { RAD, SEC_PER_DAY } from '../core/constants.ts';
import {
  formatAccel,
  formatDuration,
  formatAu,
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
  sun: 'Sun',
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

  const centre = result?.config.centralBody ?? 'earth';
  const isHeliocentric = centre === 'sun';
  const isMoonRelevant =
    !isHeliocentric &&
    (centre === 'moon' || (result?.config.forces.moonGravity ?? false));

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
            {(
              [
                // The Sun only appears as a camera target heliocentrically:
                // in a planet-centred frame it is 1 AU away and following it
                // would simply fling the camera out of the scene.
                ...(isHeliocentric ? (['sun'] as CameraTarget[]) : []),
                'earth',
                'moon',
                'spacecraft',
                'free',
              ] as CameraTarget[]
            ).map((c) => {
              const disabled = c === 'moon' && !isMoonRelevant;
              return (
                <button
                  key={c}
                  className={cameraTarget === c ? 'active' : ''}
                  onClick={() => setCameraTarget(c)}
                  disabled={disabled}
                  title={
                    disabled
                      ? isHeliocentric
                        ? 'The Moon is not drawn separately at heliocentric scale'
                        : 'Enable lunar gravity or choose a lunar scenario'
                      : c === 'free'
                        ? 'Stop following any body; drag to look around freely'
                        : `Keep the camera centred on the ${CAMERA_LABELS[c]}`
                  }
                >
                  {CAMERA_LABELS[c]}
                </button>
              );
            })}
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
  const isHeliocentric = result.config.centralBody === 'sun';

  return (
    <div className="hud">
      <div className="hud-title">Live state</div>
      <Row label="Mission time" value={formatDuration(sample.t)} />
      <Row label="Day" value={fixed(sample.t / SEC_PER_DAY, 3)} />
      {isHeliocentric ? (
        <Row label="Solar distance" value={formatAu(sample.radius)} />
      ) : (
        <Row label="Altitude" value={formatLength(sample.altitude)} />
      )}
      <Row label="Speed" value={formatVelocity(sample.speed)} />
      <Row label="Sail accel" value={formatAccel(sample.sailAccel)} />
      <Row label="Sun incidence" value={`${fixed(sample.incidence * RAD, 1)} deg`} />
      <Row label="Sunlit" value={`${(sample.illumination * 100).toFixed(0)}%`} />
      <Row
        label="Semi-major axis"
        value={isHeliocentric ? formatAu(sample.sma) : formatLength(sample.sma)}
      />
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
      {isHeliocentric && Number.isFinite(sample.targetDistance) && (
        <Row label="To target" value={formatAu(sample.targetDistance)} />
      )}
      {!isHeliocentric && (result.config.forces.moonGravity || !isEarth) && (
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

/**
 * Compact wall-clock duration, for the "how long will this take to watch"
 * readouts. `formatDuration` is too verbose here ("0d 00:17:00").
 */
function formatWatch(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--';
  if (seconds < 1) return `${seconds.toFixed(2)} s`;
  if (seconds < 90) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function Timeline() {
  const result = useStore((s) => s.result);
  const cursor = useStore((s) => s.cursor);
  const setCursor = useStore((s) => s.setCursor);
  const stepCursor = useStore((s) => s.stepCursor);
  const playbackRate = useStore((s) => s.playbackRate);

  const count = result?.samples.length ?? 0;
  const sample = result && count > 0 ? result.samples[Math.min(cursor, count - 1)] : null;

  const period = sample?.period;
  const hasPeriod = !!period && Number.isFinite(period) && period > 0;
  const secondsPerRev = hasPeriod && playbackRate > 0 ? period / playbackRate : null;
  const secondsPerRun =
    result && playbackRate > 0 ? result.summary.finalTime / playbackRate : null;

  // Samples per revolution bounds how much attitude detail exists to be seen,
  // however slowly it is played.
  const outputInterval = result?.config.integration.outputInterval;
  const samplesPerRev = hasPeriod && outputInterval ? period / outputInterval : null;

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
          title="Previous sample (Left arrow, Shift for 10)"
          aria-label="Previous sample"
        >
          &#9666;
        </button>
        <button
          onClick={() => stepCursor(1)}
          disabled={count === 0}
          title="Next sample (Right arrow, Shift for 10)"
          aria-label="Next sample"
        >
          &#9656;
        </button>
      </div>

      {/*
        Both timescales at once. A solar-sail study cares about the attitude
        dynamics within a revolution AND the orbit evolution over the mission,
        and those are ~100x apart - so showing only one of these numbers hides
        the trade-off the rate control is making.
      */}
      {(secondsPerRev !== null || secondsPerRun !== null) && (
        <span
          className="timeline-note"
          title={
            samplesPerRev !== null
              ? `${samplesPerRev.toFixed(0)} recorded samples per revolution. The views interpolate between them, so slowing down beyond this cannot reveal more attitude detail - reduce the output interval in the Simulation panel and re-run instead.`
              : undefined
          }
        >
          {secondsPerRev !== null && <>1 rev &asymp; {formatWatch(secondsPerRev)}</>}
          {secondsPerRev !== null && secondsPerRun !== null && ' \u00b7 '}
          {secondsPerRun !== null && <>run &asymp; {formatWatch(secondsPerRun)}</>}
          {samplesPerRev !== null && samplesPerRev < 25 && (secondsPerRev ?? 0) > 8 && (
            <span className="timeline-warn">
              {' '}
              &middot; only {samplesPerRev.toFixed(0)} samples/rev
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * Playback rate control, rendered in the top bar beside the run buttons.
 *
 * Exported so App.tsx can place it there: it belongs with Run/Pause rather
 * than with the scrubber, because choosing a rate is part of setting up a
 * viewing session, not part of navigating within one.
 *
 * The two named presets exist because the interesting timescales in a
 * solar-sail study are about 100x apart and no single rate serves both:
 *
 *   "1 rev"     - one revolution over ~30 s, to watch the sail feather and
 *                 re-point through different parts of the orbit
 *   "Whole run" - the entire run over ~30 s, to watch the orbit itself evolve
 *
 * They are labelled after the timescale rather than the phenomenon so the
 * buttons read the same way as the timeline note, and so neither collides
 * with a panel tab name.
 *
 * The slider covers everything between and beyond, and the timeline reports
 * what the current setting means for both timescales.
 */
export function PlaybackRateControl() {
  const result = useStore((s) => s.result);
  const cursor = useStore((s) => s.cursor);
  const playbackRate = useStore((s) => s.playbackRate);
  const setPlaybackRate = useStore((s) => s.setPlaybackRate);
  const fitPlaybackRate = useStore((s) => s.fitPlaybackRate);

  const sample =
    result && result.samples.length > 0
      ? result.samples[Math.min(cursor, result.samples.length - 1)]
      : null;
  const hasPeriod = !!sample?.period && Number.isFinite(sample.period) && sample.period > 0;

  // Log slider: 1 s/s (real time) to 1e6 s/s (~11.6 days per second).
  const LOG_MIN = 0;
  const LOG_MAX = 6;
  const logValue = Math.log10(Math.max(1, playbackRate));

  // Highlight whichever preset the current rate corresponds to, within 5%.
  const near = (target: number | null) =>
    target !== null && target > 0 && Math.abs(playbackRate / target - 1) < 0.05;
  const revRate = hasPeriod && sample ? sample.period / 30 : null;
  const runRate = result ? result.summary.finalTime / 30 : null;

  return (
    <div className="rate-control" role="group" aria-label="Playback rate">
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
        title="Simulation time elapsed per real second"
      />
      <span className="rate-readout" title="Simulation time elapsed per real second">
        {formatRate(playbackRate)}
      </span>
      <div className="seg rate-presets">
        <button
          className={near(revRate) ? 'active' : ''}
          disabled={!result || !hasPeriod}
          onClick={() => fitPlaybackRate('revolution', 30)}
          title={
            hasPeriod
              ? 'One orbital revolution over 30 seconds - slow enough to watch the sail attitude change through the orbit'
              : 'This trajectory is not periodic, so there is no revolution to fit'
          }
        >
          1 rev
        </button>
        <button
          className={near(runRate) ? 'active' : ''}
          disabled={!result}
          onClick={() => fitPlaybackRate('mission', 30)}
          title="The whole run over 30 seconds - fast enough to watch the orbit itself evolve"
        >
          Whole run
        </button>
      </div>
    </div>
  );
}
