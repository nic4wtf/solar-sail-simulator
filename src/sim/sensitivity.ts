/**
 * Parameter sensitivity sweep (spec S25).
 *
 * Runs the same scenario N times while varying one parameter, and reports a
 * chosen scalar metric for each. Sweeps run sequentially with a yield between
 * samples so the UI stays responsive and can show progress.
 */

import { AU, DEG, RAD, SEC_PER_DAY } from '../core/constants.ts';
import { totalMass } from '../core/sail/sail.ts';
import { meanElementSeries } from './analysis.ts';
import { propagate } from './propagator.ts';
import type { SimulationConfig, SimulationResult } from './types.ts';

export type SweepParameter =
  | 'areaToMass'
  | 'sailArea'
  | 'spacecraftMass'
  | 'attitudeAngle1'
  | 'duration'
  | 'reflectivity'
  | 'initialAltitude';

export interface SweepParameterSpec {
  label: string;
  /** Unit shown on the axis. */
  unit: string;
  /** Sensible default range. */
  defaultMin: number;
  defaultMax: number;
  /** Note explaining what is held constant while this varies. */
  note: string;
  /** Whether this parameter is applicable to the given configuration. */
  applicable?: (cfg: SimulationConfig) => boolean;
}

export const SWEEP_PARAMETERS: Record<SweepParameter, SweepParameterSpec> = {
  areaToMass: {
    label: 'Area-to-mass ratio',
    unit: 'm^2/kg',
    defaultMin: 0.1,
    defaultMax: 20,
    note: 'Spacecraft mass is held fixed and the sail area is adjusted to hit the requested ratio.',
  },
  sailArea: {
    label: 'Sail area',
    unit: 'm^2',
    defaultMin: 10,
    defaultMax: 2000,
    note: 'Spacecraft mass is held fixed, so the area-to-mass ratio varies proportionally.',
  },
  spacecraftMass: {
    label: 'Spacecraft mass',
    unit: 'kg',
    defaultMin: 10,
    defaultMax: 500,
    note: 'Sail area is held fixed. Propellant mass is set to zero and all mass is treated as dry mass.',
  },
  attitudeAngle1: {
    label: 'Primary steering angle',
    unit: 'deg',
    defaultMin: -90,
    defaultMax: 90,
    note: 'Applies to the fixed, time-based and Sun-relative rules. For an orbit-fraction schedule every knot is offset by the swept value; the locally optimal rule solves for its own angle and ignores this.',
  },
  duration: {
    label: 'Simulation duration',
    unit: 'days',
    defaultMin: 1,
    defaultMax: 60,
    note: 'The output interval is rescaled with the duration to keep the sample count roughly constant.',
  },
  reflectivity: {
    label: 'Sail reflectivity',
    unit: '-',
    defaultMin: 0.5,
    defaultMax: 1,
    note: 'Only affects the non-ideal optical force model. Absorptivity is recomputed as 1 - reflectivity - transmissivity.',
  },
  initialAltitude: {
    label: 'Initial altitude',
    unit: 'km',
    defaultMin: 400,
    defaultMax: 5000,
    note: 'Periapsis altitude. Only applies when the initial state is given as orbital elements; the integration timestep is NOT rescaled, so check the timestep warning at the extremes.',
    applicable: (cfg) => cfg.initial.mode === 'elements',
  },
};

export type SweepMetric =
  | 'deltaMeanSma'
  | 'deltaMeanEcc'
  | 'deltaMeanInc'
  | 'finalMeanSma'
  | 'deltaVEquivalent'
  | 'meanSailAccel'
  | 'minMoonDistance'
  | 'eclipseFraction'
  | 'maxSolarDistance'
  | 'minTargetDistance'
  | 'finalEnergy';

export interface SweepMetricSpec {
  label: string;
  unit: string;
  /** Convert the SI metric value to display units. */
  scale: (x: number) => number;
}

export const SWEEP_METRICS: Record<SweepMetric, SweepMetricSpec> = {
  deltaMeanSma: {
    label: 'Change in mean semi-major axis',
    unit: 'km',
    scale: (x) => x / 1000,
  },
  deltaMeanEcc: { label: 'Change in mean eccentricity', unit: '-', scale: (x) => x },
  deltaMeanInc: { label: 'Change in mean inclination', unit: 'deg', scale: (x) => x * RAD },
  finalMeanSma: { label: 'Final mean semi-major axis', unit: 'km', scale: (x) => x / 1000 },
  deltaVEquivalent: {
    label: 'Impulse budget (integral of sail acceleration)',
    unit: 'm/s',
    scale: (x) => x,
  },
  meanSailAccel: {
    label: 'Mean sail acceleration',
    unit: 'um/s^2',
    scale: (x) => x * 1e6,
  },
  minMoonDistance: { label: 'Closest lunar approach', unit: 'km', scale: (x) => x / 1000 },
  eclipseFraction: { label: 'Eclipse fraction', unit: '%', scale: (x) => x * 100 },

  // Heliocentric metrics. The mean-element metrics above are unusable on a
  // spiral - there are no repeating revolutions to average over - so the
  // interplanetary questions are asked directly of the summary instead.
  maxSolarDistance: {
    label: 'Furthest solar distance reached',
    unit: 'AU',
    scale: (x) => x / AU,
  },
  minTargetDistance: {
    label: 'Closest approach to the target planet',
    unit: 'AU',
    scale: (x) => x / AU,
  },
  finalEnergy: {
    label: 'Final specific orbital energy (positive = escaped)',
    unit: 'MJ/kg',
    scale: (x) => x / 1e6,
  },
};

export interface SweepRequest {
  parameter: SweepParameter;
  /** Range in the parameter's display units. */
  min: number;
  max: number;
  samples: number;
  metric: SweepMetric;
}

export interface SweepPoint {
  /** Parameter value in display units. */
  value: number;
  /** Metric value in display units, or null when unavailable. */
  metric: number | null;
  /** Termination reason for this run. */
  termination: string;
}

export interface SweepResult {
  request: SweepRequest;
  parameterLabel: string;
  parameterUnit: string;
  metricLabel: string;
  metricUnit: string;
  points: SweepPoint[];
  /** Wall-clock time for the whole sweep [ms]. */
  wallClockMs: number;
  notes: string[];
}

/** Apply a swept parameter value to a cloned configuration. */
export function applySweepValue(
  base: SimulationConfig,
  parameter: SweepParameter,
  value: number,
): SimulationConfig {
  const cfg: SimulationConfig = structuredClone(base);

  switch (parameter) {
    case 'areaToMass': {
      const mass = totalMass(cfg.spacecraft);
      cfg.sail.area = Math.max(1e-6, value * mass);
      break;
    }
    case 'sailArea':
      cfg.sail.area = Math.max(1e-6, value);
      break;
    case 'spacecraftMass':
      cfg.spacecraft = { ...cfg.spacecraft, dryMass: Math.max(1e-6, value), propellantMass: 0 };
      break;
    case 'attitudeAngle1': {
      const rad = value * DEG;
      const att = cfg.attitude;
      if (att.kind === 'fixed') att.angle1 = rad;
      else if (att.kind === 'timeBased') att.initialAngle = rad;
      else if (att.kind === 'sunRelative') att.cone = rad;
      else if (att.kind === 'orbitFraction') {
        // Offset the whole schedule, preserving its shape.
        const mean =
          att.knots.reduce((acc, k) => acc + k.angle1, 0) / Math.max(1, att.knots.length);
        const shift = rad - mean;
        att.knots = att.knots.map((k) => ({ ...k, angle1: k.angle1 + shift }));
      }
      break;
    }
    case 'duration': {
      const duration = value * SEC_PER_DAY;
      cfg.integration.duration = duration;
      cfg.integration.outputInterval = Math.max(
        cfg.integration.timestep,
        Math.round(duration / 4000),
      );
      break;
    }
    case 'reflectivity':
      cfg.sail.reflectivity = Math.min(1, Math.max(0, value));
      break;
    case 'initialAltitude':
      if (cfg.initial.mode === 'elements') cfg.initial.altitude = value * 1000;
      break;
  }

  return cfg;
}

/** Extract the requested scalar metric from a completed run. */
export function extractMetric(result: SimulationResult, metric: SweepMetric): number | null {
  const { summary } = result;

  switch (metric) {
    case 'deltaVEquivalent':
      return summary.deltaVEquivalent;
    case 'meanSailAccel':
      return summary.meanSailAccel;
    case 'eclipseFraction':
      return summary.eclipseFraction;
    case 'minMoonDistance':
      return Number.isFinite(summary.minMoonDistance) ? summary.minMoonDistance : null;
    case 'maxSolarDistance':
      return summary.maxSolarDistance > 0 ? summary.maxSolarDistance : null;
    case 'minTargetDistance':
      return Number.isFinite(summary.minTargetDistance) ? summary.minTargetDistance : null;
    case 'finalEnergy':
      return summary.finalEnergy;
    default:
      break;
  }

  // The remaining metrics need revolution-averaged elements.
  const mean = meanElementSeries(result.samples);
  if (!mean.valid) return null;

  // `meanElementSeries` emits only full-window averages, so the first and last
  // entries are both valid endpoints.
  if (mean.t.length < 2) return null;
  const startIdx = 0;
  const endIdx = mean.t.length - 1;

  switch (metric) {
    case 'deltaMeanSma':
      return mean.sma[endIdx] - mean.sma[startIdx];
    case 'deltaMeanEcc':
      return mean.ecc[endIdx] - mean.ecc[startIdx];
    case 'deltaMeanInc':
      return mean.inc[endIdx] - mean.inc[startIdx];
    case 'finalMeanSma':
      return mean.sma[endIdx];
    default:
      return null;
  }
}

export interface SweepOptions {
  onProgress?: (completed: number, total: number) => void;
  shouldCancel?: () => boolean;
}

/**
 * Run a sensitivity sweep.
 *
 * Runs are sequential rather than parallel: each propagation is already
 * hundreds of milliseconds of pure computation, and without Web Workers there
 * is no parallelism to be had on the main thread anyway. Yielding between
 * runs keeps the progress bar live and the Cancel button responsive.
 */
export async function runSweep(
  base: SimulationConfig,
  request: SweepRequest,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const start = performance.now();
  const paramSpec = SWEEP_PARAMETERS[request.parameter];
  const metricSpec = SWEEP_METRICS[request.metric];
  const n = Math.max(2, Math.min(200, Math.round(request.samples)));
  const points: SweepPoint[] = [];
  const notes: string[] = [];

  if (paramSpec.applicable && !paramSpec.applicable(base)) {
    notes.push(
      `${paramSpec.label} does not apply to this configuration (the initial state is given as a Cartesian vector, not as orbital elements).`,
    );
    return {
      request,
      parameterLabel: paramSpec.label,
      parameterUnit: paramSpec.unit,
      metricLabel: metricSpec.label,
      metricUnit: metricSpec.unit,
      points,
      wallClockMs: performance.now() - start,
      notes,
    };
  }

  let unavailable = 0;

  for (let i = 0; i < n; i++) {
    if (options.shouldCancel?.()) {
      notes.push(`Cancelled after ${i} of ${n} runs.`);
      break;
    }

    const value = request.min + ((request.max - request.min) * i) / (n - 1);
    const cfg = applySweepValue(base, request.parameter, value);
    const result = await propagate(cfg, { yieldToEventLoop: true });
    const raw = extractMetric(result, request.metric);
    if (raw === null) unavailable++;

    points.push({
      value,
      metric: raw === null ? null : metricSpec.scale(raw),
      termination: result.summary.termination,
    });

    options.onProgress?.(i + 1, n);
  }

  if (unavailable > 0) {
    notes.push(
      `${unavailable} of ${points.length} runs could not supply this metric. Metrics based on mean elements require a bound orbit propagated for at least two revolutions.`,
    );
  }
  notes.push(paramSpec.note);

  return {
    request,
    parameterLabel: paramSpec.label,
    parameterUnit: paramSpec.unit,
    metricLabel: metricSpec.label,
    metricUnit: metricSpec.unit,
    points,
    wallClockMs: performance.now() - start,
    notes,
  };
}
