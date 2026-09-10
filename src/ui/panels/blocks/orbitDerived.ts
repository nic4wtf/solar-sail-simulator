/**
 * Derived figures for the initial state.
 *
 * Three panels used to compute this independently - the mission builder, the
 * spacecraft panel and the simulation panel all need the initial period,
 * eccentricity and speeds - and the three copies had already started to
 * differ in how they handled an unbound state. One implementation now.
 *
 * It works from the actual initial Cartesian state rather than from the
 * elements, so a Cartesian initial condition (the lunar transfer, the lunar
 * approach) is described exactly as accurately as an element-based one.
 */

import {
  CENTRAL_BODY_FRAME,
  CENTRAL_BODY_NAMES,
  CENTRAL_MU,
  CENTRAL_RADIUS,
} from '../../../core/environment/environment.ts';
import { circularSpeed, escapeSpeed, periodFromSma } from '../../../core/orbital/elements.ts';
import { initialStateVector } from '../../../sim/propagator.ts';
import type { SimulationConfig } from '../../../sim/types.ts';

export interface DerivedOrbit {
  /** Radius from the central body [m]. */
  radius: number;
  /** Altitude above the central body reference radius [m]. */
  altitude: number;
  /** Initial speed [m/s]. */
  speed: number;
  /** Semi-major axis [m], Infinity if unbound. */
  sma: number;
  /** Eccentricity [-]. 1 or above for an unbound trajectory. */
  ecc: number;
  /** Orbital period [s], Infinity if unbound. */
  period: number;
  /** Circular speed at this radius [m/s]. */
  vCirc: number;
  /** Escape speed at this radius [m/s]. */
  vEsc: number;
  /** Periapsis radius [m]. */
  periapsis: number;
  /** Apoapsis radius [m], Infinity if unbound. */
  apoapsis: number;
  /** True when the initial state is not a closed orbit. */
  unbound: boolean;
}

/** Central-body constants for the configured integration centre. */
export function centralBodyFacts(config: SimulationConfig): {
  isEarth: boolean;
  /** True when the Sun is the integration centre. */
  isHeliocentric: boolean;
  name: string;
  radius: number;
  mu: number;
  frame: string;
} {
  const centre = config.centralBody;
  return {
    isEarth: centre === 'earth',
    isHeliocentric: centre === 'sun',
    name: CENTRAL_BODY_NAMES[centre],
    radius: CENTRAL_RADIUS[centre],
    mu: CENTRAL_MU[centre],
    frame: CENTRAL_BODY_FRAME[centre],
  };
}

/**
 * Derived orbit figures, or null when the configuration cannot produce a
 * state vector at all (which the element inputs make hard, but a hand-edited
 * JSON file can still manage).
 */
export function deriveInitialOrbit(config: SimulationConfig): DerivedOrbit | null {
  const { radius: bodyRadius, mu } = centralBodyFacts(config);
  try {
    const { r, v } = initialStateVector(config);
    const rMag = Math.hypot(r[0], r[1], r[2]);
    const vMag = Math.hypot(v[0], v[1], v[2]);
    if (!(rMag > 0) || !Number.isFinite(vMag)) return null;

    const energy = (vMag * vMag) / 2 - mu / rMag;
    const bound = energy < 0;
    const sma = bound ? -mu / (2 * energy) : Infinity;

    const hx = r[1] * v[2] - r[2] * v[1];
    const hy = r[2] * v[0] - r[0] * v[2];
    const hz = r[0] * v[1] - r[1] * v[0];
    const h = Math.hypot(hx, hy, hz);
    const p = (h * h) / mu;
    const ecc = bound ? Math.sqrt(Math.max(0, 1 - p / sma)) : 1;

    return {
      radius: rMag,
      altitude: rMag - bodyRadius,
      speed: vMag,
      sma,
      ecc,
      period: bound ? periodFromSma(sma, mu) : Infinity,
      vCirc: circularSpeed(rMag, mu),
      vEsc: escapeSpeed(rMag, mu),
      periapsis: bound ? sma * (1 - ecc) : rMag,
      apoapsis: bound ? sma * (1 + ecc) : Infinity,
      unbound: !bound,
    };
  } catch {
    return null;
  }
}
