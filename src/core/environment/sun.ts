/**
 * Low-precision analytic solar ephemeris.
 *
 * Source: the "Low precision formulae for the Sun" of the Astronomical
 * Almanac (also Vallado Alg. 29 / Meeus Ch. 25 abridged). Accuracy is about
 * 0.01 deg in ecliptic longitude and ~2e-5 AU in range over 1950-2050, which
 * is several orders of magnitude better than we need: a 0.01 deg error in the
 * Sun direction changes the sail incidence angle by 0.01 deg and hence the
 * force by <1e-4 relative.
 *
 * Returns the geocentric Earth -> Sun vector in the J2000 EQUATORIAL frame,
 * i.e. the same axes as the ECI integration frame.
 */

import { AU, DEG } from '../constants.ts';
import { type Vec3, norm, scale } from '../vec3.ts';
import { daysSinceJ2000 } from './time.ts';

export interface SunState {
  /** Earth -> Sun position vector in J2000 equatorial axes [m]. */
  position: Vec3;
  /** Earth-Sun distance [m]. */
  distance: number;
  /** Apparent ecliptic longitude [rad]. */
  eclipticLongitude: number;
  /** Mean obliquity of date [rad]. */
  obliquity: number;
}

/**
 * Earth -> Sun state at the given Julian date.
 *
 * The returned vector points FROM the Earth TO the Sun. The photon travel
 * direction at the spacecraft (Sun -> spacecraft) is computed by the
 * environment as `r_craft - r_sun`.
 */
export function sunState(jd: number): SunState {
  const d = daysSinceJ2000(jd);

  // Mean longitude and mean anomaly of the Sun [deg]
  const L = 280.46 + 0.9856474 * d;
  const g = (357.528 + 0.9856003 * d) * DEG;

  // Ecliptic longitude, including the two largest periodic terms [deg]
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;

  // Earth-Sun distance [AU] - eccentricity of the Earth orbit
  const rAu = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  const r = rAu * AU;

  // Mean obliquity of the ecliptic of date [rad]
  const eps = (23.439 - 4.0e-7 * d) * DEG;

  // Ecliptic -> equatorial. Solar ecliptic latitude is < 1 arcsec, ignored.
  const cosL = Math.cos(lambda);
  const sinL = Math.sin(lambda);
  const position: Vec3 = [
    r * cosL,
    r * Math.cos(eps) * sinL,
    r * Math.sin(eps) * sinL,
  ];

  return { position, distance: r, eclipticLongitude: lambda, obliquity: eps };
}

/**
 * Unit vector from the Earth toward the Sun. Convenience for UI/visualisation
 * where only the direction matters.
 */
export function sunDirection(jd: number): Vec3 {
  const s = sunState(jd);
  return scale(s.position, 1 / norm(s.position));
}
