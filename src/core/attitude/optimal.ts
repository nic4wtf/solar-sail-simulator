/**
 * Locally optimal solar-sail steering.
 *
 * PROBLEM: given the Sun line `u` and a desired thrust direction `d`, which
 * sail normal `n` maximises the force component along `d`?
 *
 * For an ideal sail the force is 2 P A cos^2(alpha) n, so with `theta` the
 * angle between u and d, and `alpha` the angle between u and n measured in the
 * (u, d) plane, we maximise
 *
 *     g(alpha) = cos^2(alpha) * cos(theta - alpha)
 *
 * Setting dg/dalpha = 0 and dividing by cos(alpha) gives the compact
 * stationarity condition
 *
 *     tan(theta - alpha) = 2 tan(alpha)
 *
 * which is the classical result (McInnes 1999, sec. 4.4; Macdonald & McInnes,
 * "Analytical Control Laws for Planet-Centred Solar Sailing", JGCD 2005).
 *
 * Notable values:
 *   theta = 0    -> alpha = 0        (push straight along the Sun line)
 *   theta = 90   -> alpha = 35.26 deg (the famous maximum-transverse angle)
 *
 * There is no closed form for general theta, so the condition is solved by
 * bisection. The admissible interval is
 *
 *     alpha in ( max(0, theta - 90deg), min(theta, 90deg) )
 *
 * because cos(alpha) > 0 is required for the sail to be illuminated and
 * cos(theta - alpha) > 0 for the projection onto `d` to be positive. The
 * residual is positive at the lower end and negative at the upper end, so
 * bisection converges unconditionally.
 *
 * The angle derived from the IDEAL force law is also used for the non-ideal
 * optical sail. That is standard practice: the transverse component of a real
 * sail shifts the true optimum by only a degree or two, far less than the
 * error introduced by the steering law being instantaneous rather than
 * globally optimal.
 */

import {
  type Vec3,
  ZERO,
  angleBetween,
  cross,
  dot,
  norm,
  rotateAbout,
  scale,
  sub,
  unit,
} from '../vec3.ts';

const HALF_PI = Math.PI / 2;

/**
 * Optimal incidence angle [rad] for maximising the force along a direction
 * making angle `theta` [rad] with the Sun line.
 *
 * Returns 0 for theta = 0, and NaN-free clamped results for theta outside
 * (0, pi).
 */
export function optimalIncidenceAngle(theta: number): number {
  if (!Number.isFinite(theta)) return 0;
  if (theta <= 1e-12) return 0;
  if (theta >= Math.PI - 1e-12) {
    // The desired direction points into the Sun: no positive component is
    // achievable. Return the edge-on limit, which produces (almost) no force.
    return HALF_PI;
  }

  let lo = Math.max(0, theta - HALF_PI);
  let hi = Math.min(theta, HALF_PI);
  if (hi - lo < 1e-15) return lo;

  // Residual of the stationarity condition, written to avoid tan() blowing up:
  //   sin(theta - a) cos(a) - 2 sin(a) cos(theta - a) = 0
  const residual = (a: number) =>
    Math.sin(theta - a) * Math.cos(a) - 2 * Math.sin(a) * Math.cos(theta - a);

  // 60 bisections take the interval below 1e-18 rad; 40 is already at the
  // double-precision floor for angles of order 1.
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (residual(mid) > 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Sail normal that locally maximises the force along `desired`.
 *
 * @param sunToCraft unit vector from the Sun to the spacecraft
 * @param desired    desired thrust direction (need not be unit)
 */
export function optimalNormal(sunToCraft: Vec3, desired: Vec3): Vec3 {
  const u = unit(sunToCraft);
  const d = unit(desired);
  if (norm(u) === 0 || norm(d) === 0) return u;

  const theta = angleBetween(u, d);
  if (theta <= 1e-9) return u; // already aligned: face the Sun

  const alpha = optimalIncidenceAngle(theta);

  // Rotate u toward d by alpha, about the axis perpendicular to both.
  let axis = cross(u, d);
  if (norm(axis) < 1e-12) {
    // u and d are anti-parallel (theta = pi). Any perpendicular axis gives an
    // equally (un)helpful answer; pick a stable one.
    const helper: Vec3 = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    axis = cross(u, helper);
    if (norm(axis) < 1e-12) return u;
  }
  return unit(rotateAbout(u, unit(axis), alpha));
}

/**
 * Resolve a named thrust direction into an inertial unit vector.
 * Returns [0,0,0] when the direction is undefined (e.g. orbit normal for
 * purely radial motion).
 */
export function thrustDirectionVector(
  direction:
    | 'prograde'
    | 'retrograde'
    | 'radialOut'
    | 'radialIn'
    | 'normal'
    | 'antiNormal',
  r: Vec3,
  v: Vec3,
): Vec3 {
  switch (direction) {
    case 'prograde':
      return unit(v);
    case 'retrograde':
      return scale(unit(v), -1);
    case 'radialOut':
      return unit(r);
    case 'radialIn':
      return scale(unit(r), -1);
    case 'normal': {
      const h = cross(r, v);
      return norm(h) > 0 ? unit(h) : ZERO;
    }
    case 'antiNormal': {
      const h = cross(r, v);
      return norm(h) > 0 ? scale(unit(h), -1) : ZERO;
    }
  }
}

/**
 * Achievable fraction of the ideal on-axis force along `desired`, for the
 * optimal normal. 1.0 means the full 2PA is delivered along the target
 * direction; 0 means nothing useful can be produced.
 *
 * Used by the Feasibility panel to explain WHY a geometry is or is not
 * productive - this is the quantity that collapses when the Sun line is
 * unfavourable, and it is exactly the effect that a naive
 * "pressure x area / mass" estimate misses.
 */
export function steeringEfficiency(sunToCraft: Vec3, desired: Vec3): number {
  const u = unit(sunToCraft);
  const d = unit(desired);
  if (norm(u) === 0 || norm(d) === 0) return 0;
  const theta = angleBetween(u, d);
  if (theta >= HALF_PI + 1e-9) {
    // Still possible to get a positive projection up to theta = pi, but it
    // falls off very fast; the formula below handles it.
  }
  const alpha = optimalIncidenceAngle(theta);
  const eff = Math.cos(alpha) ** 2 * Math.cos(theta - alpha);
  return Math.max(0, eff);
}

/**
 * Angle between the sail normal and the Sun line for the optimal solution,
 * exposed for the docs page and the validation tests.
 */
export function optimalNormalIncidence(sunToCraft: Vec3, desired: Vec3): number {
  return optimalIncidenceAngle(angleBetween(unit(sunToCraft), unit(desired)));
}

/**
 * Component of a vector along a unit direction - small helper used by the
 * analysis code to report how much of the sail acceleration is actually
 * useful.
 */
export function componentAlong(v: Vec3, dir: Vec3): number {
  const d = unit(dir);
  return norm(d) === 0 ? 0 : dot(v, d);
}

/** Component of `v` perpendicular to `dir` (vector). */
export function componentPerp(v: Vec3, dir: Vec3): Vec3 {
  const d = unit(dir);
  return norm(d) === 0 ? v : sub(v, scale(d, dot(v, d)));
}
