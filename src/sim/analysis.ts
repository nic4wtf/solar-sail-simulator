/**
 * Post-processing and analysis.
 *
 * ---------------------------------------------------------------------------
 * WHY MEAN ELEMENTS MATTER HERE
 * ---------------------------------------------------------------------------
 * The propagator records OSCULATING elements - the instantaneous two-body
 * elements of the state vector. Under J2 those oscillate strongly at twice the
 * orbital frequency: in the default 500 km LEO the osculating semi-major axis
 * swings about 11.8 km peak-to-peak, while the sail changes it by tens of
 * metres over the same six hours.
 *
 * So reading "final minus initial osculating semi-major axis" would report
 * J2 geometry as if it were sail performance - off by a factor of several
 * hundred, and with the wrong sign about half the time. Every headline
 * feasibility number in this application is therefore computed from
 * REVOLUTION-AVERAGED (mean) elements, and the plots offer both traces so the
 * distinction is visible rather than hidden.
 */

import { AU, MU_EARTH, MU_MOON, R_EARTH, R_MOON, SEC_PER_DAY } from '../core/constants.ts';
import { hohmannDeltaV } from '../core/orbital/elements.ts';
import { sailPerformance, type SailConfig, type SpacecraftConfig } from '../core/sail/sail.ts';
import { pressureAt } from '../core/sail/sail.ts';
import type { SimulationResult, TrajectorySample } from './types.ts';

// ---------------------------------------------------------------------------
// Mean (revolution-averaged) elements
// ---------------------------------------------------------------------------

export interface MeanElementSeries {
  t: number[];
  sma: number[];
  ecc: number[];
  inc: number[];
  periapsis: number[];
  apoapsis: number[];
  /** True when averaging was possible (bound orbit, several revolutions run). */
  valid: boolean;
  /** Averaging window actually used [s]. */
  window: number;
  /** Explanation for the UI when averaging was not possible. */
  note?: string;
}

const EMPTY_MEAN: MeanElementSeries = {
  t: [],
  sma: [],
  ecc: [],
  inc: [],
  periapsis: [],
  apoapsis: [],
  valid: false,
  window: 0,
};

/**
 * Centred boxcar average of the osculating elements over one orbital period.
 *
 * A one-revolution window removes the J2 short-period terms and leaves the
 * secular drift, which is the part attributable to the sail.
 *
 * Only FULL windows are emitted: the returned series starts half a revolution
 * into the run and ends half a revolution before it finishes. A truncated
 * window is not a mean element, and emitting one would put a misleading
 * transient at each end of every plot, so those samples are simply omitted and
 * downstream code can use the first and last entries directly.
 *
 * Returns `valid: false` when the trajectory is not a bound, multi-revolution
 * orbit (an escape or a lunar transfer), because a "mean element" is then
 * meaningless.
 */
export function meanElementSeries(samples: TrajectorySample[]): MeanElementSeries {
  if (samples.length < 8) {
    return { ...EMPTY_MEAN, note: 'Too few samples to average.' };
  }

  // Use the median period so a single wild osculating value cannot set the
  // window, and so an escape trajectory (period = Infinity) is detected.
  const periods = samples.map((s) => s.period).filter((p) => Number.isFinite(p) && p > 0);
  if (periods.length < samples.length * 0.8) {
    return {
      ...EMPTY_MEAN,
      note: 'The trajectory is not a bound periodic orbit for most of the run, so revolution averaging does not apply. Read the osculating elements directly.',
    };
  }
  periods.sort((a, b) => a - b);
  const period = periods[Math.floor(periods.length / 2)];

  const duration = samples[samples.length - 1].t - samples[0].t;
  if (duration < 2 * period) {
    return {
      ...EMPTY_MEAN,
      note: `The run covers only ${(duration / period).toFixed(1)} revolutions. At least two are needed for revolution averaging.`,
    };
  }

  const times = samples.map((s) => s.t);

  // Exact running integral of the piecewise-linear interpolant of each series.
  //
  // A boxcar average kills the J2 short-period terms only if the window is
  // EXACTLY one period: the averaging kernel has sinc zeros at every integer
  // multiple of 1/P, which is precisely where those terms live. Snapping the
  // window ends to the nearest recorded sample makes the effective window
  // length jitter by up to one output interval (2.7% of a period in the
  // default LEO), which detunes those zeros and leaves a visible ripple of the
  // same order as the sail signal itself.
  //
  // Integrating exactly and evaluating at interpolated endpoints removes that
  // error entirely, for an O(n) setup and O(1) amortised cost per window.
  const integrals = {
    sma: cumulativeIntegral(times, samples.map((s) => s.sma)),
    ecc: cumulativeIntegral(times, samples.map((s) => s.ecc)),
    inc: cumulativeIntegral(times, samples.map((s) => s.inc)),
    periapsis: cumulativeIntegral(times, samples.map((s) => s.periapsis)),
    // Apoapsis is Infinity on a hyperbolic osculating orbit, which would
    // poison the whole integral; substitute NaN and let it propagate to the
    // affected windows only.
    apoapsis: cumulativeIntegral(
      times,
      samples.map((s) => (Number.isFinite(s.apoapsis) ? s.apoapsis : NaN)),
    ),
  };

  const t: number[] = [];
  const sma: number[] = [];
  const ecc: number[] = [];
  const inc: number[] = [];
  const periapsis: number[] = [];
  const apoapsis: number[] = [];

  const half = period / 2;
  const tFirst = times[0];
  const tLast = times[times.length - 1];

  for (let i = 0; i < samples.length; i++) {
    const centre = samples[i].t;
    const t0 = centre - half;
    const t1 = centre + half;
    // Windows that would extend past the data are skipped rather than
    // silently shortened - a half-window average is not a mean element.
    if (t0 < tFirst - 1e-9 || t1 > tLast + 1e-9) continue;

    const span = t1 - t0;
    t.push(centre);
    sma.push((evalIntegral(integrals.sma, times, t1) - evalIntegral(integrals.sma, times, t0)) / span);
    ecc.push((evalIntegral(integrals.ecc, times, t1) - evalIntegral(integrals.ecc, times, t0)) / span);
    inc.push((evalIntegral(integrals.inc, times, t1) - evalIntegral(integrals.inc, times, t0)) / span);
    periapsis.push(
      (evalIntegral(integrals.periapsis, times, t1) -
        evalIntegral(integrals.periapsis, times, t0)) /
        span,
    );
    apoapsis.push(
      (evalIntegral(integrals.apoapsis, times, t1) -
        evalIntegral(integrals.apoapsis, times, t0)) /
        span,
    );
  }

  return { t, sma, ecc, inc, periapsis, apoapsis, valid: t.length > 2, window: period };
}

interface CumulativeIntegral {
  /** Integral from times[0] up to times[i]. */
  c: number[];
  /** The sampled values themselves, needed for within-segment evaluation. */
  y: number[];
}

/** Cumulative trapezoidal integral of a piecewise-linear series. */
function cumulativeIntegral(times: number[], y: number[]): CumulativeIntegral {
  const c = new Array<number>(times.length);
  c[0] = 0;
  for (let i = 1; i < times.length; i++) {
    const dt = times[i] - times[i - 1];
    c[i] = c[i - 1] + 0.5 * (y[i] + y[i - 1]) * dt;
  }
  return { c, y };
}

/**
 * Integral from times[0] to an arbitrary `x`, exact for the piecewise-linear
 * interpolant. Within the containing segment,
 *
 *   C(x) = C_i + (x - t_i) y_i + slope (x - t_i)^2 / 2
 */
function evalIntegral(ci: CumulativeIntegral, times: number[], x: number): number {
  const n = times.length;
  if (x <= times[0]) return 0;
  if (x >= times[n - 1]) return ci.c[n - 1];

  // Binary search for the segment containing x.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= x) lo = mid;
    else hi = mid;
  }

  const dt = times[hi] - times[lo];
  if (dt <= 0) return ci.c[lo];
  const d = x - times[lo];
  const slope = (ci.y[hi] - ci.y[lo]) / dt;
  return ci.c[lo] + d * ci.y[lo] + (slope * d * d) / 2;
}

/**
 * Value of a mean series at (or nearest to) a requested time, ignoring the
 * first and last half-window where the average is truncated.
 */
function meanAt(series: MeanElementSeries, key: 'sma' | 'ecc' | 'inc', time: number): number | null {
  if (!series.valid || series.t.length === 0) return null;
  // The series already contains only full-window averages, so every entry is
  // usable and no further trimming is needed here.
  const first = series.t[0];
  const last = series.t[series.t.length - 1];
  if (time < first - 1e-6 || time > last + 1e-6) return null;

  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < series.t.length; i++) {
    const d = Math.abs(series.t[i] - time);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return series[key][best];
}

// ---------------------------------------------------------------------------
// Feasibility report
// ---------------------------------------------------------------------------

export interface Milestone {
  label: string;
  /** Mission time [s]. */
  t: number;
  /** Change in mean semi-major axis since the start [m], or null if unavailable. */
  deltaSma: number | null;
  /** Change in mean eccentricity since the start [-]. */
  deltaEcc: number | null;
  /** Change in mean inclination since the start [rad]. */
  deltaInc: number | null;
  /** Whether this milestone is inside the propagated duration. */
  covered: boolean;
}

export interface FeasibilityReport {
  // Theory
  /** Area-to-mass ratio [m^2/kg]. */
  areaToMass: number;
  /** Characteristic acceleration at 1 AU, Sun-facing [m/s^2]. */
  characteristicAcceleration: number;
  /** Radiation pressure at the mean heliocentric distance of the run [N/m^2]. */
  pressureAtMission: number;
  /** Dimensionless normal-incidence force coefficient [-]. */
  forceCoefficient: number;
  /** Sail lightness number [-]. */
  lightnessNumber: number;

  // Simulated
  /** Mean sail acceleration actually achieved over the run [m/s^2]. */
  meanAchievedAccel: number;
  /**
   * Ratio of the mean achieved acceleration to the characteristic
   * acceleration. This single number captures everything that geometry,
   * steering and eclipse take away from the brochure figure.
   */
  dutyFactor: number;
  /** Fraction of the run spent eclipsed [-]. */
  eclipseFraction: number;
  /** Accumulated impulse budget, integral of |a| dt [m/s]. */
  deltaVEquivalent: number;

  // Realised orbital change (mean elements)
  /** Change in mean semi-major axis over the whole run [m]. */
  deltaSma: number | null;
  /** Rate of change of the mean semi-major axis [m/day]. */
  smaRatePerDay: number | null;
  /**
   * Resolution floor of the mean semi-major axis estimate [m].
   *
   * Revolution averaging suppresses the J2 short-period oscillation by about
   * three orders of magnitude but not perfectly: the window is the MEDIAN
   * osculating period, while the actual oscillation period drifts slightly
   * under the perturbation itself, so a small residual survives. Measured
   * with the sail disabled in the default LEO, the residual is ~8.5 m against
   * an osculating peak-to-peak of ~12.7 km, i.e. about 0.07%.
   *
   * This is estimated conservatively as 0.1% of the osculating peak-to-peak.
   * A reported change smaller than a few times this figure is not
   * distinguishable from averaging residue.
   */
  smaResolution: number;
  deltaEcc: number | null;
  deltaInc: number | null;
  /** Milestones at 1, 7 and 30 days. */
  milestones: Milestone[];
  /** Mean-element diagnostics, including why averaging may be unavailable. */
  mean: MeanElementSeries;

  /**
   * Impulsive delta-v a Hohmann transfer would need for the same change in
   * semi-major axis [m/s]. A yardstick, NOT the simulated result.
   */
  equivalentHohmannDeltaV: number | null;
  /** Ratio of the impulse budget spent to the useful Hohmann-equivalent. */
  impulseEfficiency: number | null;

  warnings: string[];
}

/**
 * Build the feasibility report for a completed run.
 *
 * Deliberately reports the theoretical figure and the simulated outcome side
 * by side, and never presents one as the other (spec S14, S31).
 */
export function feasibilityReport(
  result: SimulationResult,
  sail: SailConfig,
  spacecraft: SpacecraftConfig,
): FeasibilityReport {
  const perf = sailPerformance(sail, spacecraft);
  const { samples, summary } = result;
  const mean = meanElementSeries(samples);
  const warnings: string[] = [];

  const meanSunDistance =
    samples.length > 0
      ? samples.reduce((acc, s) => acc + s.sunDistance, 0) / samples.length
      : AU;

  const dutyFactor =
    perf.characteristicAcceleration > 0
      ? summary.meanSailAccel / perf.characteristicAcceleration
      : 0;

  // Realised change from the mean-element series, trimmed by half a window at
  // each end where the average is truncated.
  let deltaSma: number | null = null;
  let deltaEcc: number | null = null;
  let deltaInc: number | null = null;
  let smaRatePerDay: number | null = null;

  if (mean.valid && mean.t.length > 1) {
    const a = 0;
    const b = mean.t.length - 1;
    deltaSma = mean.sma[b] - mean.sma[a];
    deltaEcc = mean.ecc[b] - mean.ecc[a];
    deltaInc = mean.inc[b] - mean.inc[a];
    const span = mean.t[b] - mean.t[a];
    if (span > 0) smaRatePerDay = (deltaSma / span) * SEC_PER_DAY;
  }

  // Resolution floor: 0.1% of the osculating peak-to-peak (see the field doc).
  let smaResolution = 0;
  if (samples.length > 1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of samples) {
      if (!Number.isFinite(s.sma)) continue;
      if (s.sma < lo) lo = s.sma;
      if (s.sma > hi) hi = s.sma;
    }
    if (Number.isFinite(lo) && Number.isFinite(hi)) smaResolution = 1e-3 * (hi - lo);
  }

  const startSma = mean.valid && mean.sma.length ? mean.sma[0] : summary.initialSma;
  const milestones: Milestone[] = [1, 7, 30].map((days) => {
    const t = days * SEC_PER_DAY;
    const covered = t <= summary.finalTime + 1e-6;
    const smaThen = covered ? meanAt(mean, 'sma', t) : null;
    const eccThen = covered ? meanAt(mean, 'ecc', t) : null;
    const incThen = covered ? meanAt(mean, 'inc', t) : null;
    const smaStart = mean.valid && mean.sma.length ? mean.sma[0] : null;
    return {
      label: `${days} day${days > 1 ? 's' : ''}`,
      t,
      deltaSma: smaThen !== null && smaStart !== null ? smaThen - smaStart : null,
      deltaEcc:
        eccThen !== null && mean.ecc.length ? eccThen - mean.ecc[0] : null,
      deltaInc:
        incThen !== null && mean.inc.length ? incThen - mean.inc[0] : null,
      covered,
    };
  });

  // Hohmann yardstick for the achieved semi-major axis change.
  const mu = result.config.centralBody === 'earth' ? MU_EARTH : MU_MOON;
  let equivalentHohmannDeltaV: number | null = null;
  let impulseEfficiency: number | null = null;
  if (deltaSma !== null && Math.abs(deltaSma) > 1e-6 && startSma > 0) {
    const target = startSma + deltaSma;
    if (target > 0) {
      equivalentHohmannDeltaV = hohmannDeltaV(startSma, target, mu);
      impulseEfficiency =
        summary.deltaVEquivalent > 0 ? equivalentHohmannDeltaV / summary.deltaVEquivalent : null;
    }
  }

  // --- Warnings --------------------------------------------------------
  if (perf.areaToMass < 0.5) {
    warnings.push(
      `Area-to-mass ratio is ${perf.areaToMass.toFixed(3)} m^2/kg, giving a characteristic acceleration of only ${(perf.characteristicAcceleration * 1e6).toFixed(2)} um/s^2. Solar-sail effects will be very small compared with orbital perturbations.`,
    );
  }
  if (perf.areaToMass > 50) {
    warnings.push(
      `Area-to-mass ratio of ${perf.areaToMass.toFixed(1)} m^2/kg is far beyond any flown or currently planned sail. IKAROS achieved about 0.0018 m^2/kg and NEA Scout about 0.06 m^2/kg. Results are a physics extrapolation, not an engineering projection.`,
    );
  }
  if (summary.eclipseFraction > 0.3) {
    warnings.push(
      `The spacecraft is eclipsed for ${(summary.eclipseFraction * 100).toFixed(0)}% of the run, which is why the achieved acceleration is far below the characteristic value. A dawn-dusk sun-synchronous orbit largely avoids this.`,
    );
  }
  if (dutyFactor > 0 && dutyFactor < 0.25) {
    warnings.push(
      `Only ${(dutyFactor * 100).toFixed(0)}% of the characteristic acceleration is being realised on average. Eclipse, Sun-line geometry and the incidence-angle cosine all reduce it - this is the gap the simulator exists to show.`,
    );
  }
  if (
    deltaSma !== null &&
    smaResolution > 0 &&
    Math.abs(deltaSma) < 3 * smaResolution
  ) {
    warnings.push(
      `The change in mean semi-major axis (${deltaSma.toFixed(1)} m) is comparable to the ${smaResolution.toFixed(1)} m resolution floor of the revolution averaging, so its magnitude and even its sign should not be trusted. Run for longer, or use a larger sail, to lift the result clear of the averaging residue.`,
    );
  }
  if (!mean.valid && mean.note) warnings.push(mean.note);
  if (summary.minAltitude < 400e3 && result.config.centralBody === 'earth') {
    warnings.push(
      'The trajectory dips below 400 km, where atmospheric drag would dominate the sail force. Drag is NOT modelled in this version.',
    );
  }

  return {
    areaToMass: perf.areaToMass,
    characteristicAcceleration: perf.characteristicAcceleration,
    pressureAtMission: pressureAt(sail, meanSunDistance),
    forceCoefficient: perf.forceCoefficient,
    lightnessNumber: perf.lightnessNumber,
    meanAchievedAccel: summary.meanSailAccel,
    dutyFactor,
    eclipseFraction: summary.eclipseFraction,
    deltaVEquivalent: summary.deltaVEquivalent,
    deltaSma,
    smaRatePerDay,
    smaResolution,
    deltaEcc,
    deltaInc,
    milestones,
    mean,
    equivalentHohmannDeltaV,
    impulseEfficiency,
    warnings,
  };
}

/** Reference sails, for context in the feasibility panel. */
export const REFERENCE_SAILS: ReadonlyArray<{
  name: string;
  areaToMass: number;
  note: string;
}> = [
  { name: 'IKAROS (JAXA, 2010)', areaToMass: 196 / 307, note: '196 m^2, 307 kg - first solar sail to demonstrate photon propulsion in deep space. Flown.' },
  { name: 'LightSail 2 (2019)', areaToMass: 32 / 5, note: '32 m^2, 5 kg CubeSat - demonstrated sail-driven orbit raising in LEO. Flown.' },
  { name: 'NEA Scout (2022)', areaToMass: 86 / 14, note: '86 m^2, 14 kg - launched, but never contacted after deployment.' },
  { name: 'ACS3 (NASA, 2024)', areaToMass: 80 / 16, note: '80 m^2, 16 kg composite-boom demonstrator. Flown.' },
  { name: 'Typical study "high-performance" sail', areaToMass: 100, note: 'A common assumption in interplanetary sail studies. Requires areal densities well below anything yet built.' },
];

// ---------------------------------------------------------------------------
// Body reference radius helper
// ---------------------------------------------------------------------------

export const bodyRadiusFor = (centre: 'earth' | 'moon'): number =>
  centre === 'earth' ? R_EARTH : R_MOON;
