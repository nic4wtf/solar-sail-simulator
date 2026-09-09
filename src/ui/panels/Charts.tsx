/**
 * Charts drawer.
 *
 * Grouped by what the user is asking, not by data type: "is the orbit
 * changing", "where is it", "what is the sail doing". Each group is one
 * Plotly figure with several traces, so legend clicks toggle traces and the
 * shared x axis makes correlation obvious.
 *
 * Every element chart offers BOTH the osculating trace and the mean trace,
 * because the difference between them is the single most common source of
 * misreading a solar-sail result.
 */

import { useMemo, useState } from 'react';
import { RAD, SEC_PER_DAY } from '../../core/constants.ts';
import { meanElementSeries } from '../../sim/analysis.ts';
import type { TrajectorySample } from '../../sim/types.ts';
import { useStore } from '../../state/store.ts';
import { PLOT_COLORS, Plot, cursorShape } from '../viz/Plot.tsx';
import { EmptyState } from '../widgets/Controls.tsx';

type ChartGroup = 'elements' | 'mission' | 'sail' | 'state' | 'geometry';

const GROUP_LABELS: Record<ChartGroup, string> = {
  elements: 'Orbital elements',
  mission: 'Altitude and energy',
  sail: 'Sail',
  state: 'Position and velocity',
  geometry: 'Geometry',
};

export function Charts() {
  const result = useStore((s) => s.result);
  const cursor = useStore((s) => s.cursor);
  const comparisons = useStore((s) => s.comparisons);
  const [group, setGroup] = useState<ChartGroup>('elements');
  const [collapsed, setCollapsed] = useState(false);

  const samples = result?.samples;

  const mean = useMemo(() => (samples ? meanElementSeries(samples) : null), [samples]);

  // Time axis in days: the natural unit for every scenario in this release.
  const t = useMemo(
    () => (samples ? samples.map((s) => s.t / SEC_PER_DAY) : []),
    [samples],
  );
  const tMean = useMemo(
    () => (mean?.valid ? mean.t.map((x) => x / SEC_PER_DAY) : []),
    [mean],
  );

  const cursorT = samples && samples.length > 0
    ? samples[Math.min(cursor, samples.length - 1)].t / SEC_PER_DAY
    : 0;

  const shapes = [cursorShape(cursorT)];
  const xaxis = { title: { text: 'Mission elapsed time [days]' } };

  const data = useMemo(() => {
    if (!samples || samples.length === 0) return [];

    const line = (
      y: (number | null)[],
      name: string,
      color: string,
      opts: Record<string, unknown> = {},
    ) => ({
      x: t,
      y,
      type: 'scatter',
      mode: 'lines',
      name,
      line: { color, width: 1.4 },
      ...opts,
    });

    /**
     * An osculating trace over a long run aliases into a solid band: a 7-day
     * LEO run covers ~106 revolutions, and the J2 short-period terms oscillate
     * twice per revolution, so ~212 cycles are compressed into the plot width
     * and completely bury the mean trace underneath.
     *
     * Osculating traces are therefore registered but hidden, so the legend
     * still advertises them and one click brings them back.
     */
    const osculating = (
      y: (number | null)[],
      name: string,
      color: string,
      opts: Record<string, unknown> = {},
    ) => ({
      ...line(y, name, color, opts),
      visible: 'legendonly',
    });

    const meanLine = (
      y: number[],
      name: string,
      color: string,
      opts: Record<string, unknown> = {},
    ) => ({
      x: tMean,
      y,
      type: 'scatter',
      mode: 'lines',
      name,
      line: { color, width: 2.2 },
      ...opts,
    });

    // Comparison traces from stored runs, dashed and dimmed.
    const comparisonTraces = (
      pick: (s: TrajectorySample) => number,
      scale = 1,
    ) =>
      comparisons.map((c, i) => ({
        x: c.result.samples.map((s) => s.t / SEC_PER_DAY),
        y: c.result.samples.map((s) => pick(s) * scale),
        type: 'scatter',
        mode: 'lines',
        name: `${c.label}`,
        line: { color: PLOT_COLORS[(i + 3) % PLOT_COLORS.length], width: 1, dash: 'dot' },
        opacity: 0.75,
      }));

    const showOsc = !mean?.valid;
    const elementTrace = showOsc ? line : osculating;

    switch (group) {
      case 'elements':
        return [
          elementTrace(
            samples.map((s) => s.sma / 1000),
            'Semi-major axis, osculating',
            '#2f6499',
            { yaxis: 'y' },
          ),
          ...(mean?.valid
            ? [
                meanLine(
                  mean.sma.map((x) => x / 1000),
                  'Semi-major axis, mean',
                  PLOT_COLORS[0],
                  { yaxis: 'y' },
                ),
              ]
            : []),
          elementTrace(
            samples.map((s) => s.ecc),
            'Eccentricity, osculating',
            '#a06b1f',
            { yaxis: 'y2' },
          ),
          ...(mean?.valid
            ? [meanLine(mean.ecc, 'Eccentricity, mean', PLOT_COLORS[1], { yaxis: 'y2' })]
            : []),
          elementTrace(
            samples.map((s) => s.inc * RAD),
            'Inclination, osculating',
            '#4a8a4d',
            { yaxis: 'y3' },
          ),
          ...(mean?.valid
            ? [
                meanLine(
                  mean.inc.map((x) => x * RAD),
                  'Inclination, mean',
                  PLOT_COLORS[2],
                  { yaxis: 'y3' },
                ),
              ]
            : []),
          ...comparisonTraces((s) => s.sma / 1000),
        ];

      case 'mission':
        return [
          line(
            samples.map((s) => s.altitude / 1000),
            'Altitude',
            PLOT_COLORS[0],
          ),
          line(
            samples.map((s) => s.periapsis / 1000),
            'Periapsis radius',
            PLOT_COLORS[1],
          ),
          line(
            samples.map((s) => (Number.isFinite(s.apoapsis) ? s.apoapsis / 1000 : null)),
            'Apoapsis radius',
            PLOT_COLORS[2],
          ),
          line(
            samples.map((s) => s.energy / 1000),
            'Specific energy [kJ/kg]',
            PLOT_COLORS[3],
            { yaxis: 'y2' },
          ),
          ...comparisonTraces((s) => s.altitude / 1000),
        ];

      case 'sail':
        return [
          line(
            samples.map((s) => s.sailAccel * 1e6),
            'Sail acceleration magnitude',
            PLOT_COLORS[0],
          ),
          line(
            samples.map((s) => s.sailAccelS * 1e6),
            'Along-track component',
            PLOT_COLORS[2],
          ),
          line(
            samples.map((s) => s.sailAccelR * 1e6),
            'Radial component',
            PLOT_COLORS[1],
          ),
          line(
            samples.map((s) => s.sailAccelW * 1e6),
            'Cross-track component',
            PLOT_COLORS[4],
          ),
          line(
            samples.map((s) => s.incidence * RAD),
            'Sun incidence angle [deg]',
            PLOT_COLORS[3],
            { yaxis: 'y2' },
          ),
          line(
            samples.map((s) => s.illumination),
            'Illumination fraction',
            PLOT_COLORS[5],
            { yaxis: 'y3' },
          ),
          line(
            samples.map((s) => s.deltaVEquivalent),
            'Impulse budget [m/s]',
            PLOT_COLORS[6],
            { yaxis: 'y4' },
          ),
        ];

      case 'state':
        return [
          line(samples.map((s) => s.x / 1000), 'X', PLOT_COLORS[0]),
          line(samples.map((s) => s.y / 1000), 'Y', PLOT_COLORS[1]),
          line(samples.map((s) => s.z / 1000), 'Z', PLOT_COLORS[2]),
          line(samples.map((s) => s.vx / 1000), 'Vx [km/s]', PLOT_COLORS[3], {
            yaxis: 'y2',
          }),
          line(samples.map((s) => s.vy / 1000), 'Vy [km/s]', PLOT_COLORS[4], {
            yaxis: 'y2',
          }),
          line(samples.map((s) => s.vz / 1000), 'Vz [km/s]', PLOT_COLORS[5], {
            yaxis: 'y2',
          }),
          line(samples.map((s) => s.speed / 1000), 'Speed [km/s]', PLOT_COLORS[6], {
            yaxis: 'y2',
            line: { color: PLOT_COLORS[6], width: 2.2 },
          }),
        ];

      case 'geometry':
        return [
          line(
            samples.map((s) => s.moonDistance / 1000),
            'Distance to the Moon',
            PLOT_COLORS[0],
          ),
          line(
            samples.map((s) => s.earthDistance / 1000),
            'Distance to the Earth',
            PLOT_COLORS[1],
          ),
          line(
            samples.map((s) => s.betaAngle * RAD),
            'Beta angle (Sun above orbit plane) [deg]',
            PLOT_COLORS[2],
            { yaxis: 'y2' },
          ),
          line(
            samples.map((s) => s.steer1 * RAD),
            'Steering angle 1 [deg]',
            PLOT_COLORS[3],
            { yaxis: 'y2' },
          ),
          line(
            samples.map((s) => s.steer2 * RAD),
            'Steering angle 2 [deg]',
            PLOT_COLORS[4],
            { yaxis: 'y2' },
          ),
          line(
            samples.map((s) => s.sunDistance / 1.495978707e11),
            'Distance to the Sun [AU]',
            PLOT_COLORS[5],
            { yaxis: 'y3' },
          ),
        ];
    }
  }, [samples, t, tMean, mean, group, comparisons]);

  const layout = useMemo(() => {
    // Multi-axis layouts. Each extra y axis is given its own slice of the
    // right-hand margin so the labels never collide.
    switch (group) {
      case 'elements':
        return {
          shapes,
          xaxis: { ...xaxis, domain: [0, 0.8] },
          yaxis: { title: { text: 'sma [km]' } },
          yaxis2: {
            title: { text: 'ecc' },
            overlaying: 'y',
            side: 'right',
            showgrid: false,
          },
          yaxis3: {
            title: { text: 'inc [deg]' },
            overlaying: 'y',
            side: 'right',
            position: 0.92,
            anchor: 'free',
            showgrid: false,
          },
          margin: { l: 66, r: 110, t: 26, b: 44 },
        };
      case 'mission':
        return {
          shapes,
          xaxis,
          yaxis: { title: { text: 'distance [km]' } },
          yaxis2: {
            title: { text: 'energy [kJ/kg]' },
            overlaying: 'y',
            side: 'right',
            showgrid: false,
          },
          margin: { l: 70, r: 76, t: 26, b: 44 },
        };
      case 'sail':
        return {
          shapes,
          xaxis: { ...xaxis, domain: [0, 0.78] },
          yaxis: { title: { text: 'accel [um/s^2]' } },
          yaxis2: {
            title: { text: 'incidence [deg]' },
            overlaying: 'y',
            side: 'right',
            showgrid: false,
          },
          yaxis3: {
            title: { text: 'illum' },
            overlaying: 'y',
            side: 'right',
            position: 0.88,
            anchor: 'free',
            showgrid: false,
            range: [0, 1.05],
          },
          yaxis4: {
            title: { text: 'impulse [m/s]' },
            overlaying: 'y',
            side: 'right',
            position: 0.97,
            anchor: 'free',
            showgrid: false,
          },
          margin: { l: 66, r: 128, t: 26, b: 44 },
        };
      case 'state':
        return {
          shapes,
          xaxis,
          yaxis: { title: { text: 'position [km]' } },
          yaxis2: {
            title: { text: 'velocity [km/s]' },
            overlaying: 'y',
            side: 'right',
            showgrid: false,
          },
          margin: { l: 74, r: 76, t: 26, b: 44 },
        };
      case 'geometry':
        return {
          shapes,
          xaxis: { ...xaxis, domain: [0, 0.82] },
          yaxis: { title: { text: 'distance [km]' } },
          yaxis2: {
            title: { text: 'angle [deg]' },
            overlaying: 'y',
            side: 'right',
            showgrid: false,
          },
          yaxis3: {
            title: { text: 'AU' },
            overlaying: 'y',
            side: 'right',
            position: 0.93,
            anchor: 'free',
            showgrid: false,
          },
          margin: { l: 74, r: 112, t: 26, b: 44 },
        };
    }
  }, [group, shapes, xaxis]);

  if (collapsed) {
    return (
      <div className="charts">
        <div className="charts-head">
          <button className="drawer-toggle" onClick={() => setCollapsed(false)}>
            ▴ Show charts
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="charts">
      <div className="charts-head">
        <button className="drawer-toggle" onClick={() => setCollapsed(true)} title="Collapse">
          ▾
        </button>
        <div className="seg">
          {(Object.keys(GROUP_LABELS) as ChartGroup[]).map((g) => (
            <button
              key={g}
              className={group === g ? 'active' : ''}
              onClick={() => setGroup(g)}
            >
              {GROUP_LABELS[g]}
            </button>
          ))}
        </div>
        <span className="small muted" style={{ marginLeft: 'auto' }}>
          {mean && !mean.valid && mean.note
            ? 'Mean elements unavailable - showing osculating elements directly'
            : group === 'elements'
              ? 'Showing revolution-averaged (mean) elements. Click a legend entry to add the osculating trace.'
              : 'Click legend entries to toggle traces. Drag to zoom, double-click to reset.'}
        </span>
      </div>

      <div className="charts-body">
        {!samples || samples.length === 0 ? (
          <EmptyState title="No data to plot">
            Press <strong>Run</strong> to propagate the current configuration.
          </EmptyState>
        ) : (
          <Plot data={data} layout={layout} height={252} />
        )}
      </div>
    </div>
  );
}
