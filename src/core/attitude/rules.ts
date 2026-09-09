/**
 * The attitude rule library.
 *
 * `evaluateAttitude` is the single entry point used by the force model. Every
 * rule returns a commanded sail normal in the inertial integration frame plus
 * enough metadata for the UI to explain what it did.
 */

import { DEG, RAD } from '../constants.ts';
import { type Vec3, clamp, dot, unit } from '../vec3.ts';
import {
  buildFrame,
  sailNormalConeClock,
  sailNormalFromAngles,
} from '../orbital/frames.ts';
import { wrap2Pi } from '../orbital/elements.ts';
import {
  type AttitudeConfig,
  type AttitudeInput,
  type AttitudeOutput,
  type OrbitFractionKnot,
  type PhaseVariable,
} from './types.ts';
import { optimalNormal, thrustDirectionVector } from './optimal.ts';
import { type CompiledExpression, compileExpression } from './expression.ts';

const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------------------
// Variables exposed to the custom-equation rule
// ---------------------------------------------------------------------------

/**
 * Variable names available in a custom attitude expression, with the units
 * they are supplied in. Shown in the UI next to the expression fields.
 */
export const EXPRESSION_VARIABLES: ReadonlyArray<{ name: string; description: string }> = [
  { name: 't', description: 'Mission elapsed time [s]' },
  { name: 'tDays', description: 'Mission elapsed time [days]' },
  { name: 'tHours', description: 'Mission elapsed time [hours]' },
  { name: 'nu', description: 'True anomaly [deg]' },
  { name: 'u', description: 'Argument of latitude [deg]' },
  { name: 'M', description: 'Mean anomaly [deg]' },
  { name: 'sunPhase', description: 'Orbital phase measured from the projected Sun direction [deg]' },
  { name: 'orbitFraction', description: 'Argument of latitude as a fraction 0..1' },
  { name: 'sma', description: 'Semi-major axis [km]' },
  { name: 'ecc', description: 'Eccentricity [-]' },
  { name: 'inc', description: 'Inclination [deg]' },
  { name: 'raan', description: 'Right ascension of the ascending node [deg]' },
  { name: 'argp', description: 'Argument of periapsis [deg]' },
  { name: 'alt', description: 'Altitude above the central body radius [km]' },
  { name: 'r', description: 'Radius from the central body [km]' },
  { name: 'vel', description: 'Speed [km/s]' },
  { name: 'period', description: 'Orbital period [s]' },
  { name: 'sunAngle', description: 'Angle between the Sun line and the velocity vector [deg]' },
  { name: 'betaAngle', description: 'Angle between the Sun line and the orbit plane [deg]' },
];

export const EXPRESSION_VARIABLE_NAMES = EXPRESSION_VARIABLES.map((v) => v.name);

// ---------------------------------------------------------------------------
// Expression compilation cache
// ---------------------------------------------------------------------------

/**
 * Expressions are compiled lazily and cached by source text, so a propagation
 * that evaluates the rule 250,000 times parses each expression exactly once.
 */
const expressionCache = new Map<string, CompiledExpression | Error>();

function getCompiled(source: string): CompiledExpression | Error {
  let entry = expressionCache.get(source);
  if (entry === undefined) {
    try {
      entry = compileExpression(source, EXPRESSION_VARIABLE_NAMES);
    } catch (err) {
      entry = err instanceof Error ? err : new Error(String(err));
    }
    expressionCache.set(source, entry);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Orbital phase
// ---------------------------------------------------------------------------

/**
 * Orbital phase as a fraction in [0, 1) for the requested phase variable.
 *
 * `sunPhase` is measured from the projection of the Sun direction into the
 * orbit plane: it answers "where am I relative to the incoming sunlight",
 * which is the phase that actually governs solar-sail energy change in a
 * planet-centred orbit.
 */
export function orbitalPhaseFraction(input: AttitudeInput, variable: PhaseVariable): number {
  const { elements: el } = input;
  switch (variable) {
    case 'trueAnomaly':
      return el.trueAnomaly / TWO_PI;
    case 'argLat':
      return el.argLat / TWO_PI;
    case 'meanAnomaly': {
      // Recovering M from nu requires e < 1; fall back to argLat otherwise.
      if (el.ecc >= 1) return el.argLat / TWO_PI;
      const E =
        2 *
        Math.atan2(
          Math.sqrt(1 - el.ecc) * Math.sin(el.trueAnomaly / 2),
          Math.sqrt(1 + el.ecc) * Math.cos(el.trueAnomaly / 2),
        );
      return wrap2Pi(E - el.ecc * Math.sin(E)) / TWO_PI;
    }
    case 'sunPhase': {
      const f = buildFrame('rsw', input.r, input.v, input.sunToCraft);
      // Sun direction as seen from the central body is -sunToCraft (to a very
      // good approximation, since |r| << |r_sun|).
      const toSun: Vec3 = [-input.sunToCraft[0], -input.sunToCraft[1], -input.sunToCraft[2]];
      // Project the Sun direction into the orbit plane and measure the angle
      // from the spacecraft radial direction to it.
      const sR = dot(toSun, f.e1);
      const sS = dot(toSun, f.e2);
      // atan2(along-track, radial) gives 0 when the Sun is straight "up" the
      // radial direction (spacecraft at local noon).
      return wrap2Pi(Math.atan2(sS, sR)) / TWO_PI;
    }
  }
}

// ---------------------------------------------------------------------------
// Schedule interpolation
// ---------------------------------------------------------------------------

/**
 * Linear interpolation over a cyclic schedule of knots.
 *
 * Knots need not be sorted or cover the full range: they are sorted here and
 * the schedule wraps around from the last knot to the first (through
 * fraction = 1 -> 0), so a table ending at 0.75 still produces a continuous,
 * periodic command.
 */
export function interpolateSchedule(
  knots: readonly OrbitFractionKnot[],
  fraction: number,
): [number, number] {
  if (knots.length === 0) return [0, 0];
  if (knots.length === 1) return [knots[0].angle1, knots[0].angle2];

  const sorted = [...knots].sort((a, b) => a.fraction - b.fraction);
  const x = ((fraction % 1) + 1) % 1;

  // Before the first knot or after the last: interpolate across the wrap.
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (x < first.fraction || x >= last.fraction) {
    const span = 1 - last.fraction + first.fraction;
    if (span <= 0) return [first.angle1, first.angle2];
    const along = x >= last.fraction ? x - last.fraction : 1 - last.fraction + x;
    const w = along / span;
    return [
      last.angle1 + (first.angle1 - last.angle1) * w,
      last.angle2 + (first.angle2 - last.angle2) * w,
    ];
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (x >= a.fraction && x < b.fraction) {
      const span = b.fraction - a.fraction;
      const w = span > 0 ? (x - a.fraction) / span : 0;
      return [a.angle1 + (b.angle1 - a.angle1) * w, a.angle2 + (b.angle2 - a.angle2) * w];
    }
  }
  return [last.angle1, last.angle2];
}

// ---------------------------------------------------------------------------
// Time profile
// ---------------------------------------------------------------------------

function timeProfileAngle(
  profile: 'ramp' | 'triangle' | 'sine',
  initial: number,
  rate: number,
  minA: number,
  maxA: number,
  t: number,
): number {
  const lo = Math.min(minA, maxA);
  const hi = Math.max(minA, maxA);

  if (profile === 'ramp') {
    return clamp(initial + rate * t, lo, hi);
  }

  const span = hi - lo;
  if (span <= 0 || rate === 0) return clamp(initial, lo, hi);

  if (profile === 'triangle') {
    // Reflect the unbounded ramp into [lo, hi] - a triangle wave.
    const raw = initial + rate * t;
    const period = 2 * span;
    const p = (((raw - lo) % period) + period) % period;
    return lo + (p <= span ? p : period - p);
  }

  // Sine: sweep the full [lo, hi] band, starting from `initial`.
  const mid = 0.5 * (lo + hi);
  const amp = 0.5 * span;
  const phase0 = Math.asin(clamp(amp === 0 ? 0 : (initial - mid) / amp, -1, 1));
  // `rate` is interpreted as the angular sweep rate, so the sinusoid completes
  // a full cycle in the time the ramp would have taken to cross the band twice.
  const omega = Math.abs(rate) / Math.max(1e-12, amp);
  return mid + amp * Math.sin(phase0 + omega * t);
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Evaluate the configured attitude rule.
 *
 * Always returns a usable unit normal. Rules that cannot be evaluated (an
 * invalid expression, a degenerate frame) fall back to a Sun-facing normal,
 * which is the safe, force-maximising default, and set `degenerate`.
 */
export function evaluateAttitude(
  config: AttitudeConfig,
  input: AttitudeInput,
): AttitudeOutput {
  switch (config.kind) {
    case 'fixed': {
      const frame = buildFrame(config.frame, input.r, input.v, input.sunToCraft);
      const normal =
        config.frame === 'sun'
          ? sailNormalConeClock(frame, config.angle1, config.angle2)
          : sailNormalFromAngles(frame, config.angle1, config.angle2);
      return {
        normal,
        frameName: frame.name,
        angles: [config.angle1, config.angle2],
        angleNames: frame.angleNames,
        degenerate: frame.degenerate,
      };
    }

    case 'timeBased': {
      const frame = buildFrame(config.frame, input.r, input.v, input.sunToCraft);
      const a1 = timeProfileAngle(
        config.profile,
        config.initialAngle,
        config.rate,
        config.minAngle,
        config.maxAngle,
        input.t,
      );
      const normal =
        config.frame === 'sun'
          ? sailNormalConeClock(frame, a1, config.angle2)
          : sailNormalFromAngles(frame, a1, config.angle2);
      return {
        normal,
        frameName: frame.name,
        angles: [a1, config.angle2],
        angleNames: frame.angleNames,
        degenerate: frame.degenerate,
      };
    }

    case 'orbitFraction': {
      const frame = buildFrame(config.frame, input.r, input.v, input.sunToCraft);
      const fraction = orbitalPhaseFraction(input, config.phaseVariable);
      const [a1, a2] = interpolateSchedule(config.knots, fraction);
      const normal =
        config.frame === 'sun'
          ? sailNormalConeClock(frame, a1, a2)
          : sailNormalFromAngles(frame, a1, a2);
      return {
        normal,
        frameName: frame.name,
        angles: [a1, a2],
        angleNames: frame.angleNames,
        degenerate: frame.degenerate,
      };
    }

    case 'sunRelative': {
      const frame = buildFrame('sun', input.r, input.v, input.sunToCraft);
      return {
        normal: sailNormalConeClock(frame, config.cone, config.clock),
        frameName: frame.name,
        angles: [config.cone, config.clock],
        angleNames: frame.angleNames,
        degenerate: frame.degenerate,
      };
    }

    case 'optimalDirection': {
      const desired = thrustDirectionVector(config.direction, input.r, input.v);
      const normal = optimalNormal(input.sunToCraft, desired);
      // Report the achieved cone angle so the plot shows what the law chose.
      const cone = Math.acos(clamp(dot(unit(input.sunToCraft), normal), -1, 1));
      return {
        normal,
        frameName: `Locally optimal about ${config.direction} (Sun-relative)`,
        angles: [cone, 0],
        angleNames: ['Cone angle (solved)', '-'],
        degenerate: false,
      };
    }

    case 'expression': {
      const frame = buildFrame(config.frame, input.r, input.v, input.sunToCraft);
      const c1 = getCompiled(config.angle1Expr);
      const c2 = getCompiled(config.angle2Expr);
      if (c1 instanceof Error || c2 instanceof Error) {
        // Invalid formula: fall back to Sun-facing and flag it.
        return {
          normal: unit(input.sunToCraft),
          frameName: frame.name,
          angles: [0, 0],
          angleNames: frame.angleNames,
          degenerate: true,
        };
      }
      const vars = expressionVariables(input);
      // Expressions are authored in degrees, the natural unit for the UI.
      const a1 = c1.evaluate(vars) * DEG;
      const a2 = c2.evaluate(vars) * DEG;
      const normal =
        config.frame === 'sun'
          ? sailNormalConeClock(frame, a1, a2)
          : sailNormalFromAngles(frame, a1, a2);
      return {
        normal,
        frameName: frame.name,
        angles: [a1, a2],
        angleNames: frame.angleNames,
        degenerate: frame.degenerate,
      };
    }
  }
}

/** Build the variable bag for a custom expression. */
export function expressionVariables(input: AttitudeInput): Record<string, number> {
  const el = input.elements;
  const frame = buildFrame('rsw', input.r, input.v, input.sunToCraft);
  const toSun: Vec3 = [-input.sunToCraft[0], -input.sunToCraft[1], -input.sunToCraft[2]];
  const sunU = unit(toSun);
  const vU = unit(input.v);
  const rMag = Math.hypot(input.r[0], input.r[1], input.r[2]);
  const vMag = Math.hypot(input.v[0], input.v[1], input.v[2]);

  const meanAnomaly =
    el.ecc < 1
      ? (() => {
          const E =
            2 *
            Math.atan2(
              Math.sqrt(1 - el.ecc) * Math.sin(el.trueAnomaly / 2),
              Math.sqrt(1 + el.ecc) * Math.cos(el.trueAnomaly / 2),
            );
          return wrap2Pi(E - el.ecc * Math.sin(E));
        })()
      : el.trueAnomaly;

  const sunPhase = orbitalPhaseFraction(input, 'sunPhase') * TWO_PI;

  return {
    t: input.t,
    tDays: input.t / 86400,
    tHours: input.t / 3600,
    nu: el.trueAnomaly * RAD,
    u: el.argLat * RAD,
    M: meanAnomaly * RAD,
    sunPhase: sunPhase * RAD,
    orbitFraction: el.argLat / TWO_PI,
    sma: el.sma / 1000,
    ecc: el.ecc,
    inc: el.inc * RAD,
    raan: el.raan * RAD,
    argp: el.argp * RAD,
    alt: (rMag - 6378137) / 1000,
    r: rMag / 1000,
    vel: vMag / 1000,
    period: el.period,
    sunAngle: Math.acos(clamp(dot(sunU, vU), -1, 1)) * RAD,
    // Beta angle: 90deg minus the angle between the Sun line and the orbit
    // normal, i.e. the elevation of the Sun above the orbit plane.
    betaAngle: (Math.PI / 2 - Math.acos(clamp(dot(sunU, frame.e3), -1, 1))) * RAD,
  };
}

/** Clear the expression cache - used by the UI when a formula is edited. */
export function clearExpressionCache(): void {
  expressionCache.clear();
}
