/**
 * The propagator.
 *
 * DESIGN: a run is propagated to completion FIRST, into a flat array of
 * samples, and only then played back by the UI. That gives complete charts the
 * instant a run finishes, makes the timeline scrubbable, decouples the
 * visualisation frame rate from the integration timestep entirely (spec S29),
 * and makes sensitivity sweeps and A/B comparison of attitude laws trivial
 * because a result is just data.
 *
 * A 7-day LEO run at a 10 s RK4 step is ~60,000 steps / 242,000 acceleration
 * evaluations, which completes in a few hundred milliseconds. To keep the page
 * responsive for the much longer runs the propagator yields to the event loop
 * every `YIELD_INTERVAL_STEPS` steps and reports progress, so even a 90-day
 * lunar propagation never blocks input.
 */

import {
  MOON_SOI_RADIUS,
  MU_MOON,
  R_EARTH,
  R_MOON,
  SEC_PER_DAY,
} from '../core/constants.ts';
import { type Vec3, dot, norm, sub, unit, clamp } from '../core/vec3.ts';
import { rvToElements } from '../core/orbital/elements.ts';
import { toRsw } from '../core/orbital/frames.ts';
import { elementsToRv } from '../core/orbital/elements.ts';
import { evaluateEnvironment } from '../core/environment/environment.ts';
import { isoToJd } from '../core/environment/time.ts';
import {
  type DynamicsConfig,
  acceleration,
  evaluateForces,
  srpMagnitudeOnly,
} from '../core/forces/forceModel.ts';
import { dopri45Step, rk4Step } from '../core/integrator/integrators.ts';
import { totalMass } from '../core/sail/sail.ts';
import type {
  SimEvent,
  SimulationConfig,
  SimulationResult,
  SimulationSummary,
  TerminationReason,
  TrajectorySample,
} from './types.ts';

/** Hard cap on recorded samples, to bound memory and plot cost. */
export const MAX_SAMPLES = 20000;

/** Hard cap on integration steps, as a runaway guard. */
const MAX_STEPS = 20_000_000;

/** How often to hand control back to the browser. */
const YIELD_INTERVAL_STEPS = 20000;

export interface PropagateOptions {
  /** Called with a 0..1 fraction. */
  onProgress?: (fraction: number) => void;
  /** Return true to abort. Checked at each yield point. */
  shouldCancel?: () => boolean;
  /** Set false to run fully synchronously (tests, sensitivity sweeps). */
  yieldToEventLoop?: boolean;
}

/** Build the dynamics configuration used by the force model. */
export function buildDynamics(config: SimulationConfig): DynamicsConfig {
  return {
    environment: {
      epochJd: isoToJd(config.epoch),
      centre: config.centralBody,
      moonModel: config.moonModel,
    },
    toggles: config.forces,
    sail: config.sail,
    attitude: config.attitude,
    mass: totalMass(config.spacecraft),
  };
}

/**
 * Initial Cartesian state in the integration frame.
 *
 * When given as elements, `altitude` is the PERIAPSIS altitude above the
 * central body reference radius, which is the convention users expect from
 * "500 km orbit, e = 0.1".
 */
export function initialStateVector(config: SimulationConfig): { r: Vec3; v: Vec3 } {
  if (config.initial.mode === 'cartesian') {
    return { r: [...config.initial.position], v: [...config.initial.velocity] };
  }
  const bodyRadius = config.centralBody === 'earth' ? R_EARTH : R_MOON;
  const mu = config.centralBody === 'earth' ? 3.986004418e14 : MU_MOON;
  const ecc = clamp(config.initial.eccentricity, 0, 0.999);
  const rp = bodyRadius + config.initial.altitude;
  const sma = rp / (1 - ecc);
  return elementsToRv(
    {
      sma,
      ecc,
      inc: config.initial.inclination,
      raan: config.initial.raan,
      argp: config.initial.argumentOfPeriapsis,
      trueAnomaly: config.initial.trueAnomaly,
    },
    mu,
  );
}

const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Propagate a configured mission.
 *
 * Always resolves - failures are reported through `summary.termination` and
 * the `events` list rather than by throwing, so the UI can show a partial
 * trajectory alongside an explanation.
 */
export async function propagate(
  config: SimulationConfig,
  options: PropagateOptions = {},
): Promise<SimulationResult> {
  const startWall = performance.now();
  const dyn = buildDynamics(config);
  const { integration: integ } = config;
  const bodyRadius = config.centralBody === 'earth' ? R_EARTH : R_MOON;
  const yieldEnabled = options.yieldToEventLoop !== false;

  // Count acceleration evaluations by wrapping the hot function.
  let evaluations = 0;
  const accel = (t: number, r: Vec3, v: Vec3): Vec3 => {
    evaluations++;
    return acceleration(dyn, t, r, v);
  };

  let { r, v } = initialStateVector(config);
  let t = 0;

  const samples: TrajectorySample[] = [];
  const events: SimEvent[] = [];

  // Ensure the sample budget is respected even if the user asks for a very
  // fine output interval over a very long run.
  const requestedSamples = Math.floor(integ.duration / Math.max(1e-9, integ.outputInterval)) + 1;
  const outputInterval =
    requestedSamples > MAX_SAMPLES ? integ.duration / (MAX_SAMPLES - 1) : integ.outputInterval;
  if (requestedSamples > MAX_SAMPLES) {
    events.push({
      kind: 'maxSamples',
      t: 0,
      severity: 'info',
      message: `Output interval widened from ${integ.outputInterval.toFixed(0)} s to ${outputInterval.toFixed(0)} s to stay within the ${MAX_SAMPLES}-sample limit. The integration timestep is unchanged, so accuracy is unaffected.`,
    });
  }

  // Running accumulators
  let deltaV = 0;
  let sailAccelSum = 0;
  let sailAccelCount = 0;
  let eclipseTime = 0;
  let minAltitude = Infinity;
  let maxAltitude = -Infinity;
  let minMoonDistance = Infinity;
  let minMoonDistanceTime = 0;
  let moonRelSpeedAtClosest = 0;
  let enteredLunarSoi = false;
  let insideSoi = false;

  let steps = 0;
  let rejectedSteps = 0;
  let minStep = Infinity;
  let maxStep = 0;
  let h = Math.max(1e-6, integ.timestep);
  let termination: TerminationReason = 'completed';
  let nextOutputTime = 0;

  /** Record a sample at the current state. */
  const record = () => {
    const b = evaluateForces(dyn, t, r, v);
    const el = rvToElements(r, v, b.env.muCentral);
    const rMag = norm(r);
    const speed = norm(v);
    const aSrp = b.srp;
    const aSrpMag = norm(aSrp);
    const rsw = toRsw(aSrp, r, v);

    const moonVec = sub(r, b.env.moon.position);
    const earthVec = sub(r, b.env.earth.position);
    const moonDist = norm(moonVec);
    const earthDist = norm(earthVec);

    // Beta angle: elevation of the Sun above the orbit plane.
    const toSun = unit(sub(b.env.sun.position, r));
    const hVec: Vec3 = [
      r[1] * v[2] - r[2] * v[1],
      r[2] * v[0] - r[0] * v[2],
      r[0] * v[1] - r[1] * v[0],
    ];
    const hHat = unit(hVec);
    const betaAngle = Math.asin(clamp(dot(toSun, hHat), -1, 1));

    samples.push({
      t,
      jd: b.env.jd,
      x: r[0],
      y: r[1],
      z: r[2],
      vx: v[0],
      vy: v[1],
      vz: v[2],
      speed,
      radius: rMag,
      altitude: rMag - bodyRadius,
      sma: el.sma,
      ecc: el.ecc,
      inc: el.inc,
      raan: el.raan,
      argp: el.argp,
      trueAnomaly: el.trueAnomaly,
      argLat: el.argLat,
      periapsis: el.periapsis,
      apoapsis: el.apoapsis,
      period: el.period,
      energy: el.energy,
      angularMomentum: el.angularMomentum,
      nx: b.attitude.normal[0],
      ny: b.attitude.normal[1],
      nz: b.attitude.normal[2],
      ax: aSrp[0],
      ay: aSrp[1],
      az: aSrp[2],
      sailAccel: aSrpMag,
      sailAccelR: rsw[0],
      sailAccelS: rsw[1],
      sailAccelW: rsw[2],
      pressure: b.srpDetail.pressure,
      incidence: b.srpDetail.incidence,
      steer1: b.attitude.angles[0],
      steer2: b.attitude.angles[1],
      illumination: b.illumination,
      earthDistance: earthDist,
      moonDistance: moonDist,
      sunDistance: b.srpDetail.solarDistance,
      betaAngle,
      deltaVEquivalent: deltaV,
    });

    // Extremes and mission metrics
    const alt = rMag - bodyRadius;
    if (alt < minAltitude) minAltitude = alt;
    if (alt > maxAltitude) maxAltitude = alt;
    if (moonDist < minMoonDistance) {
      minMoonDistance = moonDist;
      minMoonDistanceTime = t;
      moonRelSpeedAtClosest = norm(sub(v, b.env.moon.velocity));
    }

    if (moonDist < MOON_SOI_RADIUS && !insideSoi) {
      insideSoi = true;
      enteredLunarSoi = true;
      events.push({
        kind: 'lunarSoiEntry',
        t,
        severity: 'info',
        message: `Entered the lunar sphere of influence (${(moonDist / 1000).toFixed(0)} km from the Moon) at day ${(t / SEC_PER_DAY).toFixed(2)}.`,
      });
    } else if (moonDist >= MOON_SOI_RADIUS && insideSoi) {
      insideSoi = false;
      events.push({
        kind: 'lunarSoiExit',
        t,
        severity: 'info',
        message: `Left the lunar sphere of influence at day ${(t / SEC_PER_DAY).toFixed(2)}.`,
      });
    }

    sailAccelSum += aSrpMag;
    sailAccelCount++;
  };

  record();
  nextOutputTime = outputInterval;

  const totalDuration = Math.max(1e-9, integ.duration);
  let sinceYield = 0;

  while (t < integ.duration && steps < MAX_STEPS) {
    // Clamp only to the remaining duration, so the run ends exactly on time.
    //
    // The step is deliberately NOT clamped to the sample grid: doing so would
    // silently shorten the timestep the user asked for whenever the output
    // interval was not an exact multiple of it (and would fight the adaptive
    // step controller). Samples are instead recorded on the first step that
    // crosses each output time, and every sample carries its own `t`.
    const remaining = integ.duration - t;
    let hTry = Math.min(h, remaining);

    let accepted = true;
    if (integ.integrator === 'rk4') {
      const next = rk4Step(accel, t, r, v, hTry);
      r = next.r;
      v = next.v;
    } else {
      const res = dopri45Step(
        accel,
        t,
        r,
        v,
        hTry,
        integ.relTol,
        integ.absTolPosition,
        integ.absTolVelocity,
      );
      accepted = res.accepted;
      if (accepted) {
        r = res.state.r;
        v = res.state.v;
        // Do not let the controller grow the step past the user's ceiling.
        h = Math.min(res.nextH, integ.timestep);
      } else {
        rejectedSteps++;
        h = res.nextH;
        hTry = 0;
      }
    }

    steps++;
    sinceYield++;

    if (accepted) {
      // Accumulate the impulse budget and the eclipse time over the step,
      // evaluated at the step end point. `srpMagnitudeOnly` is the trimmed
      // SRP path - the full diagnostic evaluation is reserved for recorded
      // samples, where it is amortised over many steps.
      const lite = srpMagnitudeOnly(dyn, t, r, v);
      deltaV += lite.accel * hTry;
      if (lite.illumination < 1) eclipseTime += hTry * (1 - lite.illumination);

      t += hTry;
      minStep = Math.min(minStep, hTry);
      maxStep = Math.max(maxStep, hTry);
    }

    // --- Termination checks ------------------------------------------
    if (!Number.isFinite(r[0]) || !Number.isFinite(v[0])) {
      termination = 'numericalFailure';
      events.push({
        kind: 'numericalFailure',
        t,
        severity: 'error',
        message:
          'The integration produced a non-finite state. This usually means the timestep is far too large for the current orbit, or the trajectory passed extremely close to a body. Try the adaptive integrator or a smaller timestep.',
      });
      break;
    }

    const rMag = norm(r);
    if (rMag < bodyRadius + integ.minAltitude) {
      termination = 'impact';
      record();
      events.push({
        kind: 'impact',
        t,
        severity: 'error',
        message: `Altitude fell below the ${(integ.minAltitude / 1000).toFixed(0)} km floor at day ${(t / SEC_PER_DAY).toFixed(3)}. Propagation stopped - the spacecraft re-entered or impacted.`,
      });
      break;
    }

    // Record on schedule. A single (large) step can cross several output
    // times; advance the grid past them rather than emitting duplicates.
    if (t >= nextOutputTime - 1e-9) {
      record();
      while (nextOutputTime <= t + 1e-9) nextOutputTime += outputInterval;
      if (samples.length >= MAX_SAMPLES) {
        termination = 'maxSamples';
        events.push({
          kind: 'maxSamples',
          t,
          severity: 'warning',
          message: `Reached the ${MAX_SAMPLES}-sample limit at day ${(t / SEC_PER_DAY).toFixed(2)} and stopped early. Increase the output interval to cover the full duration.`,
        });
        break;
      }
    }

    if (sinceYield >= YIELD_INTERVAL_STEPS) {
      sinceYield = 0;
      options.onProgress?.(Math.min(1, t / totalDuration));
      if (options.shouldCancel?.()) {
        termination = 'cancelled';
        break;
      }
      if (yieldEnabled) await sleep();
    }
  }

  // Always capture the final state.
  if (samples.length === 0 || samples[samples.length - 1].t < t - 1e-9) record();
  options.onProgress?.(1);

  // Moon-relative state at the FINAL time, for the capture test. The
  // Moon-relative speed at closest approach is a different quantity and must
  // not be substituted here.
  let finalMoonDistance = Infinity;
  let finalMoonRelSpeed = 0;
  if (Number.isFinite(r[0])) {
    const envEnd = evaluateEnvironment(dyn.environment, t);
    finalMoonDistance = norm(sub(r, envEnd.moon.position));
    finalMoonRelSpeed = norm(sub(v, envEnd.moon.velocity));
  }

  const summary = buildSummary({
    finalMoonDistance,
    finalMoonRelSpeed,
    config,
    samples,
    termination,
    steps,
    evaluations,
    rejectedSteps,
    minStep: Number.isFinite(minStep) ? minStep : 0,
    maxStep,
    wallClockMs: performance.now() - startWall,
    deltaV,
    meanSailAccel: sailAccelCount > 0 ? sailAccelSum / sailAccelCount : 0,
    eclipseFraction: t > 0 ? eclipseTime / t : 0,
    minAltitude,
    maxAltitude,
    minMoonDistance,
    minMoonDistanceTime,
    moonRelSpeedAtClosest,
    enteredLunarSoi,
    finalTime: t,
  });

  // Post-run narrative events.
  if (summary.escaped && termination === 'completed') {
    events.push({
      kind: 'escape',
      t: summary.finalTime,
      severity: 'info',
      message:
        'The final state has positive specific orbital energy with respect to the central body: the spacecraft is on an escape trajectory.',
    });
  }
  if (Number.isFinite(summary.minMoonDistance) && summary.minMoonDistance < 1e9) {
    events.push({
      kind: 'lunarClosestApproach',
      t: summary.minMoonDistanceTime,
      severity: 'info',
      message: `Closest lunar approach: ${(summary.minMoonDistance / 1000).toFixed(0)} km at day ${(summary.minMoonDistanceTime / SEC_PER_DAY).toFixed(2)}, relative speed ${(summary.moonRelativeSpeedAtClosest / 1000).toFixed(3)} km/s.`,
    });
  }
  if (Number.isFinite(minAltitude) && minAltitude < 200e3 && termination !== 'impact') {
    events.push({
      kind: 'minAltitude',
      t: 0,
      severity: 'warning',
      message: `Minimum altitude reached ${(minAltitude / 1000).toFixed(0)} km. Below roughly 400 km atmospheric drag would dominate the sail force, and drag is NOT modelled.`,
    });
  }

  return { config, samples, events, summary };
}

interface SummaryInput {
  config: SimulationConfig;
  samples: TrajectorySample[];
  termination: TerminationReason;
  steps: number;
  evaluations: number;
  rejectedSteps: number;
  minStep: number;
  maxStep: number;
  wallClockMs: number;
  deltaV: number;
  meanSailAccel: number;
  eclipseFraction: number;
  minAltitude: number;
  maxAltitude: number;
  minMoonDistance: number;
  minMoonDistanceTime: number;
  moonRelSpeedAtClosest: number;
  enteredLunarSoi: boolean;
  finalTime: number;
  finalMoonDistance: number;
  finalMoonRelSpeed: number;
}

function buildSummary(inp: SummaryInput): SimulationSummary {
  const { samples } = inp;
  const first = samples[0];
  const last = samples[samples.length - 1];

  // Is the final state bound to the MOON? Two-body energy test on the
  // Moon-relative state at the FINAL time, and only meaningful inside the
  // lunar sphere of influence.
  //
  // This is an energy check and nothing more: a negative Moon-relative energy
  // says the osculating orbit closes at that instant, NOT that the orbit is
  // stable, long-lived, or survives the Earth tide. The UI wording is
  // deliberately cautious for the same reason.
  let boundToMoonAtEnd = false;
  if (inp.finalMoonDistance < MOON_SOI_RADIUS && inp.finalMoonDistance > 0) {
    const vRel = inp.finalMoonRelSpeed;
    boundToMoonAtEnd = (vRel * vRel) / 2 - MU_MOON / inp.finalMoonDistance < 0;
  }

  return {
    termination: inp.termination,
    finalTime: inp.finalTime,
    steps: inp.steps,
    evaluations: inp.evaluations,
    wallClockMs: inp.wallClockMs,
    rejectedSteps: inp.rejectedSteps,
    minStep: inp.minStep,
    maxStep: inp.maxStep,

    initialSma: first?.sma ?? 0,
    finalSma: last?.sma ?? 0,
    initialEcc: first?.ecc ?? 0,
    finalEcc: last?.ecc ?? 0,
    initialInc: first?.inc ?? 0,
    finalInc: last?.inc ?? 0,
    initialPeriapsis: first?.periapsis ?? 0,
    finalPeriapsis: last?.periapsis ?? 0,
    initialApoapsis: first?.apoapsis ?? 0,
    finalApoapsis: last?.apoapsis ?? 0,
    initialEnergy: first?.energy ?? 0,
    finalEnergy: last?.energy ?? 0,

    minAltitude: Number.isFinite(inp.minAltitude) ? inp.minAltitude : 0,
    maxAltitude: Number.isFinite(inp.maxAltitude) ? inp.maxAltitude : 0,
    minMoonDistance: inp.minMoonDistance,
    minMoonDistanceTime: inp.minMoonDistanceTime,
    moonRelativeSpeedAtClosest: inp.moonRelSpeedAtClosest,

    deltaVEquivalent: inp.deltaV,
    meanSailAccel: inp.meanSailAccel,
    eclipseFraction: inp.eclipseFraction,
    escaped: (last?.energy ?? -1) >= 0,
    enteredLunarSoi: inp.enteredLunarSoi,
    boundToMoonAtEnd,
  };
}
