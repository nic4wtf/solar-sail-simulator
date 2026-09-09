/**
 * Classical orbital elements <-> Cartesian state conversion.
 *
 * Reference: Vallado, "Fundamentals of Astrodynamics and Applications",
 * 4th ed., Algorithms 9 (RV2COE) and 10 (COE2RV).
 *
 * All angles in radians, all lengths in metres, all times in seconds.
 * Elements are osculating (instantaneous two-body elements of the current
 * state vector) - under perturbations they change continuously, which is
 * exactly what we plot.
 */

import { type Vec3, cross, dot, norm, sub, scale, unit, clamp } from '../vec3.ts';

export interface OrbitalElements {
  /** Semi-major axis [m]. Negative for hyperbolic orbits. */
  sma: number;
  /** Eccentricity [-]. */
  ecc: number;
  /** Inclination [rad], 0..pi. */
  inc: number;
  /** Right ascension of the ascending node [rad], 0..2pi. */
  raan: number;
  /** Argument of periapsis [rad], 0..2pi. */
  argp: number;
  /** True anomaly [rad], 0..2pi. */
  trueAnomaly: number;
  /** Argument of latitude = argp + trueAnomaly [rad]. Defined for circular orbits. */
  argLat: number;
  /** Periapsis radius [m]. */
  periapsis: number;
  /** Apoapsis radius [m]. Infinity for e >= 1. */
  apoapsis: number;
  /** Orbital period [s]. Infinity for e >= 1. */
  period: number;
  /** Specific orbital energy [J/kg] = v^2/2 - mu/r. */
  energy: number;
  /** Specific angular momentum magnitude [m^2/s]. */
  angularMomentum: number;
  /** Semi-latus rectum [m]. */
  semiLatusRectum: number;
}

const TWO_PI = 2 * Math.PI;

/** Normalise an angle into [0, 2pi). */
export function wrap2Pi(a: number): number {
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** Normalise an angle into (-pi, pi]. */
export function wrapPi(a: number): number {
  const r = wrap2Pi(a);
  return r > Math.PI ? r - TWO_PI : r;
}

/**
 * Cartesian state -> classical elements.
 *
 * Handles the degenerate cases (circular, equatorial, circular-equatorial) by
 * falling back to the standard substitute angles, so `argLat` is always usable
 * as an orbital phase variable even for a perfectly circular equatorial orbit.
 */
export function rvToElements(r: Vec3, v: Vec3, mu: number): OrbitalElements {
  const rMag = norm(r);
  const vMag = norm(v);
  const h = cross(r, v);
  const hMag = norm(h);

  // Node vector n = k_hat x h (points at the ascending node)
  const n: Vec3 = [-h[1], h[0], 0];
  const nMag = norm(n);

  // Eccentricity vector e = ((v^2 - mu/r) r - (r.v) v) / mu
  const rdotv = dot(r, v);
  const eVec: Vec3 = scale(
    sub(scale(r, vMag * vMag - mu / rMag), scale(v, rdotv)),
    1 / mu,
  );
  const ecc = norm(eVec);

  const energy = (vMag * vMag) / 2 - mu / rMag;
  // sma from energy: valid for elliptic (E<0) and hyperbolic (E>0)
  const sma = Math.abs(energy) < 1e-14 ? Infinity : -mu / (2 * energy);
  const semiLatusRectum = (hMag * hMag) / mu;

  const inc = hMag > 0 ? Math.acos(clamp(h[2] / hMag, -1, 1)) : 0;

  const CIRC_TOL = 1e-10;
  const EQ_TOL = 1e-10;
  const isCircular = ecc < CIRC_TOL;
  const isEquatorial = nMag < EQ_TOL * Math.max(1, hMag);

  let raan: number;
  let argp: number;
  let trueAnomaly: number;

  if (isEquatorial && isCircular) {
    // Truly degenerate: use the "true longitude" measured from the x-axis.
    raan = 0;
    argp = 0;
    trueAnomaly = wrap2Pi(Math.atan2(r[1], r[0]) * (h[2] < 0 ? -1 : 1));
  } else if (isEquatorial) {
    // Equatorial elliptical: RAAN undefined, use true longitude of periapsis.
    raan = 0;
    argp = wrap2Pi(Math.atan2(eVec[1], eVec[0]) * (h[2] < 0 ? -1 : 1));
    trueAnomaly = trueAnomalyFrom(eVec, r, ecc, rMag, rdotv);
  } else if (isCircular) {
    // Circular inclined: argp undefined, use argument of latitude directly.
    raan = wrap2Pi(Math.atan2(n[1], n[0]));
    argp = 0;
    const nHat = unit(n);
    const cosU = clamp(dot(nHat, r) / rMag, -1, 1);
    trueAnomaly = wrap2Pi(Math.acos(cosU) * (r[2] >= 0 ? 1 : -1));
  } else {
    raan = wrap2Pi(Math.atan2(n[1], n[0]));
    const nHat = unit(n);
    const eHat = unit(eVec);
    const cosArgp = clamp(dot(nHat, eHat), -1, 1);
    argp = wrap2Pi(Math.acos(cosArgp) * (eVec[2] >= 0 ? 1 : -1));
    trueAnomaly = trueAnomalyFrom(eVec, r, ecc, rMag, rdotv);
  }

  const periapsis = ecc < 1 ? sma * (1 - ecc) : semiLatusRectum / (1 + ecc);
  const apoapsis = ecc < 1 ? sma * (1 + ecc) : Infinity;
  const period = ecc < 1 && sma > 0 ? TWO_PI * Math.sqrt((sma * sma * sma) / mu) : Infinity;

  return {
    sma,
    ecc,
    inc,
    raan,
    argp,
    trueAnomaly,
    argLat: wrap2Pi(argp + trueAnomaly),
    periapsis,
    apoapsis,
    period,
    energy,
    angularMomentum: hMag,
    semiLatusRectum,
  };
}

function trueAnomalyFrom(
  eVec: Vec3,
  r: Vec3,
  ecc: number,
  rMag: number,
  rdotv: number,
): number {
  const cosNu = clamp(dot(eVec, r) / (ecc * rMag), -1, 1);
  // rdotv > 0 => moving away from periapsis => nu in (0, pi)
  return wrap2Pi(Math.acos(cosNu) * (rdotv >= 0 ? 1 : -1));
}

/**
 * Classical elements -> Cartesian state.
 * `sma` may be negative for hyperbolic orbits (then ecc > 1).
 */
export function elementsToRv(
  el: {
    sma: number;
    ecc: number;
    inc: number;
    raan: number;
    argp: number;
    trueAnomaly: number;
  },
  mu: number,
): { r: Vec3; v: Vec3 } {
  const { sma, ecc, inc, raan, argp, trueAnomaly: nu } = el;
  const p = sma * (1 - ecc * ecc); // semi-latus rectum
  const rMag = p / (1 + ecc * Math.cos(nu));

  // Position and velocity in the perifocal (PQW) frame
  const cosNu = Math.cos(nu);
  const sinNu = Math.sin(nu);
  const rPqw: Vec3 = [rMag * cosNu, rMag * sinNu, 0];
  const sqrtMuP = Math.sqrt(mu / p);
  const vPqw: Vec3 = [-sqrtMuP * sinNu, sqrtMuP * (ecc + cosNu), 0];

  const R = perifocalToInertial(raan, inc, argp);
  return { r: applyMat(R, rPqw), v: applyMat(R, vPqw) };
}

/** 3x3 rotation matrix (row-major) from perifocal PQW to inertial IJK. */
export function perifocalToInertial(raan: number, inc: number, argp: number): number[] {
  const cO = Math.cos(raan);
  const sO = Math.sin(raan);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const cw = Math.cos(argp);
  const sw = Math.sin(argp);
  return [
    cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * si,
    sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si,
    sw * si, cw * si, ci,
  ];
}

function applyMat(m: number[], v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

// ---------------------------------------------------------------------------
// Anomaly conversions
// ---------------------------------------------------------------------------

/** True -> eccentric anomaly [rad] (elliptic orbits). */
export function trueToEccentricAnomaly(nu: number, ecc: number): number {
  return wrap2Pi(
    2 * Math.atan2(Math.sqrt(1 - ecc) * Math.sin(nu / 2), Math.sqrt(1 + ecc) * Math.cos(nu / 2)),
  );
}

/** Eccentric -> true anomaly [rad] (elliptic orbits). */
export function eccentricToTrueAnomaly(E: number, ecc: number): number {
  return wrap2Pi(
    2 * Math.atan2(Math.sqrt(1 + ecc) * Math.sin(E / 2), Math.sqrt(1 - ecc) * Math.cos(E / 2)),
  );
}

/** True -> mean anomaly [rad] (elliptic orbits, Kepler equation forward). */
export function trueToMeanAnomaly(nu: number, ecc: number): number {
  const E = trueToEccentricAnomaly(nu, ecc);
  return wrap2Pi(E - ecc * Math.sin(E));
}

/**
 * Mean -> eccentric anomaly: solve the Kepler equation `M = E - e sin E`.
 * Newton-Raphson with a starting guess that is robust up to e ~ 0.99.
 */
export function solveKepler(M: number, ecc: number, tol = 1e-12, maxIter = 60): number {
  const m = wrapPi(M);
  let E = ecc < 0.8 ? m + ecc * Math.sin(m) : Math.PI * (m >= 0 ? 1 : -1);
  for (let i = 0; i < maxIter; i++) {
    const f = E - ecc * Math.sin(E) - m;
    const fp = 1 - ecc * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < tol) break;
  }
  return wrap2Pi(E);
}

/** Mean -> true anomaly [rad] (elliptic orbits). */
export function meanToTrueAnomaly(M: number, ecc: number): number {
  return eccentricToTrueAnomaly(solveKepler(M, ecc), ecc);
}

/** Circular orbital speed at radius r [m/s]. */
export const circularSpeed = (r: number, mu: number): number => Math.sqrt(mu / r);

/** Escape speed at radius r [m/s]. */
export const escapeSpeed = (r: number, mu: number): number => Math.sqrt((2 * mu) / r);

/** Orbital period for a given semi-major axis [s]. */
export const periodFromSma = (sma: number, mu: number): number =>
  TWO_PI * Math.sqrt((sma * sma * sma) / mu);

/**
 * Impulsive delta-v for a two-burn Hohmann transfer between circular orbits
 * of radius r0 and r1 [m/s].
 *
 * Used ONLY as a reference yardstick in the feasibility panel ("the sail took
 * N days to do what this much impulsive delta-v would do"), never as the
 * simulated result.
 */
export function hohmannDeltaV(r0: number, r1: number, mu: number): number {
  const aT = (r0 + r1) / 2;
  const v0 = Math.sqrt(mu / r0);
  const v1 = Math.sqrt(mu / r1);
  const vp = Math.sqrt(mu * (2 / r0 - 1 / aT));
  const va = Math.sqrt(mu * (2 / r1 - 1 / aT));
  return Math.abs(vp - v0) + Math.abs(v1 - va);
}
