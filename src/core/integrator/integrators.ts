/**
 * Numerical integrators for the second-order system
 *
 *   dr/dt = v
 *   dv/dt = a(t, r, v)
 *
 * Two schemes are provided:
 *
 *   RK4    - classical fixed-step Runge-Kutta. Fourth-order accurate, four
 *            acceleration evaluations per step. Predictable cost, which is
 *            what makes the "simulate then play back" model workable.
 *
 *   RKF45  - Dormand-Prince 5(4) embedded pair with adaptive step size and
 *            PI step control. Six evaluations per accepted step (the seventh
 *            stage is reused via the FSAL property). Necessary for highly
 *            eccentric orbits and lunar transfers, where a fixed step that is
 *            fine at apogee is hopeless at perigee.
 *
 * The acceleration is allowed to depend on velocity (it does: the attitude
 * rules use the velocity direction), so no velocity-free shortcuts such as
 * plain leapfrog are usable here.
 */

import { type Vec3 } from '../vec3.ts';

export type IntegratorKind = 'rk4' | 'rkf45';

export const INTEGRATOR_LABELS: Record<IntegratorKind, string> = {
  rk4: 'RK4 (fixed step, 4th order)',
  rkf45: 'Dormand-Prince 5(4) (adaptive step)',
};

export const INTEGRATOR_HELP: Record<IntegratorKind, string> = {
  rk4:
    'Classical fixed-step Runge-Kutta. Four acceleration evaluations per step. Cost is exactly predictable, and accuracy is controlled entirely by the timestep you choose.',
  rkf45:
    'Embedded 5th/4th-order pair with automatic step-size control to a specified tolerance. Use this for eccentric orbits and lunar transfers, where the required step varies by orders of magnitude along the trajectory.',
};

/** Acceleration function signature. */
export type AccelFn = (t: number, r: Vec3, v: Vec3) => Vec3;

export interface StateRV {
  r: Vec3;
  v: Vec3;
}

// ---------------------------------------------------------------------------
// RK4
// ---------------------------------------------------------------------------

/**
 * One classical RK4 step of size `h`.
 *
 * Written out longhand on scalars rather than with the Vec3 helpers: this is
 * the innermost loop of the whole application and avoiding ~30 short-lived
 * arrays per step measurably reduces GC pressure over a 250,000-step run.
 */
export function rk4Step(f: AccelFn, t: number, r: Vec3, v: Vec3, h: number): StateRV {
  const [rx, ry, rz] = r;
  const [vx, vy, vz] = v;

  // Stage 1
  const a1 = f(t, r, v);
  // Stage 2
  const r2: Vec3 = [rx + 0.5 * h * vx, ry + 0.5 * h * vy, rz + 0.5 * h * vz];
  const v2: Vec3 = [vx + 0.5 * h * a1[0], vy + 0.5 * h * a1[1], vz + 0.5 * h * a1[2]];
  const a2 = f(t + 0.5 * h, r2, v2);
  // Stage 3
  const r3: Vec3 = [rx + 0.5 * h * v2[0], ry + 0.5 * h * v2[1], rz + 0.5 * h * v2[2]];
  const v3: Vec3 = [vx + 0.5 * h * a2[0], vy + 0.5 * h * a2[1], vz + 0.5 * h * a2[2]];
  const a3 = f(t + 0.5 * h, r3, v3);
  // Stage 4
  const r4: Vec3 = [rx + h * v3[0], ry + h * v3[1], rz + h * v3[2]];
  const v4: Vec3 = [vx + h * a3[0], vy + h * a3[1], vz + h * a3[2]];
  const a4 = f(t + h, r4, v4);

  const h6 = h / 6;
  return {
    r: [
      rx + h6 * (vx + 2 * v2[0] + 2 * v3[0] + v4[0]),
      ry + h6 * (vy + 2 * v2[1] + 2 * v3[1] + v4[1]),
      rz + h6 * (vz + 2 * v2[2] + 2 * v3[2] + v4[2]),
    ],
    v: [
      vx + h6 * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]),
      vy + h6 * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]),
      vz + h6 * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2]),
    ],
  };
}

// ---------------------------------------------------------------------------
// Dormand-Prince 5(4)
// ---------------------------------------------------------------------------

// Runge-Kutta coefficients (Dormand & Prince, 1980).
const DP_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const DP_A: number[][] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
// 5th-order solution weights (identical to DP_A[6] - the FSAL property).
const DP_B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
// 4th-order embedded solution weights, for the error estimate.
const DP_B4 = [
  5179 / 57600,
  0,
  7571 / 16695,
  393 / 640,
  -92097 / 339200,
  187 / 2100,
  1 / 40,
];

export interface AdaptiveStepResult {
  /** Accepted state, or the unchanged input when the step was rejected. */
  state: StateRV;
  /** Time actually advanced (0 when rejected). */
  dt: number;
  /** Suggested next step size. */
  nextH: number;
  /** Whether the step met the tolerance. */
  accepted: boolean;
  /** Normalised error estimate (1.0 = exactly at tolerance). */
  error: number;
}

/**
 * One adaptive Dormand-Prince step.
 *
 * Error is measured on position and velocity jointly, each scaled by
 * `absTol + relTol * |component|`, and combined as an RMS norm. Step growth is
 * limited to 5x and shrinkage to 0.2x per attempt, with the customary 0.9
 * safety factor.
 */
export function dopri45Step(
  f: AccelFn,
  t: number,
  r: Vec3,
  v: Vec3,
  h: number,
  relTol: number,
  absTolPos: number,
  absTolVel: number,
): AdaptiveStepResult {
  // Stage derivatives: kR[i] = dr/dt at stage i, kV[i] = dv/dt at stage i.
  const kR: Vec3[] = [];
  const kV: Vec3[] = [];

  for (let i = 0; i < 7; i++) {
    let sr: Vec3 = [r[0], r[1], r[2]];
    let sv: Vec3 = [v[0], v[1], v[2]];
    const a = DP_A[i];
    for (let j = 0; j < a.length; j++) {
      const c = h * a[j];
      if (c === 0) continue;
      sr = [sr[0] + c * kR[j][0], sr[1] + c * kR[j][1], sr[2] + c * kR[j][2]];
      sv = [sv[0] + c * kV[j][0], sv[1] + c * kV[j][1], sv[2] + c * kV[j][2]];
    }
    kR.push(sv);
    kV.push(f(t + DP_C[i] * h, sr, sv));
  }

  // 5th- and 4th-order solutions
  const r5: Vec3 = [r[0], r[1], r[2]];
  const v5: Vec3 = [v[0], v[1], v[2]];
  const r4: Vec3 = [r[0], r[1], r[2]];
  const v4: Vec3 = [v[0], v[1], v[2]];
  for (let i = 0; i < 7; i++) {
    const b5 = h * DP_B5[i];
    const b4 = h * DP_B4[i];
    for (let d = 0; d < 3; d++) {
      r5[d] += b5 * kR[i][d];
      v5[d] += b5 * kV[i][d];
      r4[d] += b4 * kR[i][d];
      v4[d] += b4 * kV[i][d];
    }
  }

  // Scaled RMS error over the six state components
  let sum = 0;
  for (let d = 0; d < 3; d++) {
    const sr = absTolPos + relTol * Math.abs(r5[d]);
    const sv = absTolVel + relTol * Math.abs(v5[d]);
    sum += ((r5[d] - r4[d]) / sr) ** 2 + ((v5[d] - v4[d]) / sv) ** 2;
  }
  const error = Math.sqrt(sum / 6);

  const SAFETY = 0.9;
  const MIN_SCALE = 0.2;
  const MAX_SCALE = 5;
  const accepted = error <= 1;

  // Standard order-based step controller: h_new = h * (1/err)^(1/5)
  const scale =
    error === 0
      ? MAX_SCALE
      : Math.min(MAX_SCALE, Math.max(MIN_SCALE, SAFETY * error ** -0.2));

  return {
    state: accepted ? { r: r5, v: v5 } : { r, v },
    dt: accepted ? h : 0,
    nextH: h * scale,
    accepted,
    error,
  };
}

/**
 * Rough guidance on the largest sensible fixed timestep for an orbit.
 *
 * RK4 local error scales as h^5 and the natural timescale is the orbital
 * period, so accuracy is governed by steps-per-revolution rather than by the
 * step in seconds. Empirically (see docs/validation.md) RK4 holds the
 * semi-major axis to better than 1e-6 relative over a week at ~500
 * steps/revolution, degrades gently to ~1e-4 at 100, and becomes unusable
 * below ~30.
 *
 * For an eccentric orbit the binding constraint is the much faster motion at
 * periapsis, so the period is scaled by (1-e)^1.5 - the ratio of periapsis
 * angular rate to the mean rate.
 */
export function recommendedTimestep(periodSeconds: number, eccentricity = 0): number {
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) return 60;
  const e = Math.min(0.99, Math.max(0, eccentricity));
  const periapsisFactor = (1 - e) ** 1.5;
  return (periodSeconds * periapsisFactor) / 500;
}

/** Steps per revolution implied by a timestep. */
export function stepsPerRevolution(periodSeconds: number, dt: number): number {
  return dt > 0 && Number.isFinite(periodSeconds) ? periodSeconds / dt : Infinity;
}
