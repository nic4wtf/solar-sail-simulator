/**
 * Gravitational accelerations.
 *
 * Everything here is expressed in the central-body-centred inertial frame
 * supplied by the environment.
 */

import { J2_EARTH, J3_EARTH, R_EARTH } from '../constants.ts';
import { type Vec3, ZERO, norm, scale, sub } from '../vec3.ts';

/**
 * Two-body acceleration from the central body.
 *
 *   a = -mu r / |r|^3
 */
export function centralGravity(r: Vec3, mu: number): Vec3 {
  const rMag = norm(r);
  if (rMag === 0) return ZERO;
  const k = -mu / (rMag * rMag * rMag);
  return [r[0] * k, r[1] * k, r[2] * k];
}

/**
 * Third-body perturbation in a frame centred on (and accelerating with) the
 * central body.
 *
 *   a = mu_3 [ (s - r)/|s - r|^3 - s/|s|^3 ]
 *
 * where `s` is the central body -> third body vector and `r` the central body
 * -> spacecraft vector.
 *
 * The FIRST term is the direct pull of the third body on the spacecraft. The
 * SECOND term is the indirect (inertial) term that removes the pull of the
 * third body on the central body, which is what makes the rotating,
 * accelerating central-body frame usable. Dropping it is a classic error that
 * produces a spurious secular drift, so it is deliberately spelled out here.
 *
 * NOTE ON CANCELLATION: for |r| << |s| the two terms nearly cancel and the
 * naive difference loses precision. In double precision with |r|/|s| ~ 1e-2
 * (LEO vs the Moon) about 4 digits are lost, leaving ~12 - far more than the
 * simulation needs, so the direct form is kept for clarity.
 */
export function thirdBodyGravity(r: Vec3, s: Vec3, mu3: number): Vec3 {
  const sMag = norm(s);
  if (sMag === 0) return ZERO;

  const d = sub(s, r);
  const dMag = norm(d);
  if (dMag === 0) return ZERO;

  const kd = mu3 / (dMag * dMag * dMag);
  const ks = mu3 / (sMag * sMag * sMag);

  return [d[0] * kd - s[0] * ks, d[1] * kd - s[1] * ks, d[2] * kd - s[2] * ks];
}

/**
 * J2 (oblateness) perturbation of the Earth, in Earth-centred inertial
 * coordinates.
 *
 *   a_x = -(3/2) J2 (mu/r^2) (Re/r)^2 (1 - 5 z^2/r^2) x/r
 *   a_y = -(3/2) J2 (mu/r^2) (Re/r)^2 (1 - 5 z^2/r^2) y/r
 *   a_z = -(3/2) J2 (mu/r^2) (Re/r)^2 (3 - 5 z^2/r^2) z/r
 *
 * Reference: Vallado eq. 8-38. This is the dominant non-spherical term: in
 * LEO it is ~1e-3 of the central acceleration, roughly 1000x larger than
 * every other harmonic, and it drives the nodal regression and apsidal
 * rotation that visibly shape a sail trajectory over weeks.
 *
 * Requires the position in an EARTH-EQUATORIAL frame - which the ECI
 * integration frame is. When the integration centre is the Moon this term
 * must not be applied (the force model enforces that).
 */
export function j2Earth(r: Vec3, mu: number): Vec3 {
  const rMag = norm(r);
  if (rMag === 0) return ZERO;

  const z2r2 = (r[2] * r[2]) / (rMag * rMag);
  const factor = -1.5 * J2_EARTH * (mu / (rMag * rMag)) * (R_EARTH / rMag) ** 2;

  return [
    factor * (1 - 5 * z2r2) * (r[0] / rMag),
    factor * (1 - 5 * z2r2) * (r[1] / rMag),
    factor * (3 - 5 * z2r2) * (r[2] / rMag),
  ];
}

/**
 * J3 (pear-shape) perturbation of the Earth, in Earth-centred inertial
 * coordinates.
 *
 *   a_x = -(5/2) J3 (mu/r^2) (Re/r)^3 [3 (z/r) - 7 (z/r)^3] (x/r)
 *   a_y = -(5/2) J3 (mu/r^2) (Re/r)^3 [3 (z/r) - 7 (z/r)^3] (y/r)
 *   a_z = -(5/2) J3 (mu/r^2) (Re/r)^3 [6 (z/r)^2 - 7 (z/r)^4 - 3/5]
 *
 * Reference: Vallado eq. 8-39. Derived as the gradient of
 * U_3 = -(mu/r) J3 (Re/r)^3 P3(z/r), the same sign convention as
 * {@link j2Earth}; `conservation.test.ts` checks both against a numerical
 * gradient of their potentials.
 *
 * WHY IT IS HERE. J3 is about 400 times smaller than J2, which sounds
 * dismissable - but in LEO that still leaves it near 4e-5 m/s^2, several
 * times LARGER than the acceleration of a 1 m^2/kg sail. It is
 * north-south asymmetric, so unlike J2 it produces a long-period oscillation
 * in eccentricity and argument of periapsis rather than a clean secular
 * regression. For a sail study that matters in one specific way: those are
 * exactly the elements a sail is trying to move, so leaving J3 out invites
 * mistaking a gravity-field oscillation for a sail effect.
 *
 * It produces no secular change in semi-major axis, so the headline
 * altitude-raising figures are unaffected either way. Off by default.
 */
export function j3Earth(r: Vec3, mu: number): Vec3 {
  const rMag = norm(r);
  if (rMag === 0) return ZERO;

  const zr = r[2] / rMag;
  const zr2 = zr * zr;
  const factor = -2.5 * J3_EARTH * (mu / (rMag * rMag)) * (R_EARTH / rMag) ** 3;
  const lateral = factor * (3 * zr - 7 * zr * zr2);

  return [
    lateral * (r[0] / rMag),
    lateral * (r[1] / rMag),
    factor * (6 * zr2 - 7 * zr2 * zr2 - 0.6),
  ];
}

/**
 * Solar-gravity "tidal" magnitude relative to the central term, used by the
 * UI to explain when solar gravity starts to matter. Returns the ratio
 * |a_thirdbody| / |a_central|.
 */
export function perturbationRatio(aPerturbation: Vec3, aCentral: Vec3): number {
  const c = norm(aCentral);
  return c > 0 ? norm(aPerturbation) / c : 0;
}

/** Scale a vector by a boolean toggle without branching at the call site. */
export const gate = (v: Vec3, enabled: boolean): Vec3 => (enabled ? v : scale(v, 0));
