/**
 * Lunar ephemeris.
 *
 * Two selectable fidelity levels, both analytic and both cheap enough to call
 * inside the integrator. The point of having two is partly architectural: the
 * `MoonModel` switch is the seam where a real ephemeris (JPL DE / SPICE
 * kernel) would be added later without touching the force model.
 *
 *   'circular' - circular orbit at the mean distance, in a plane inclined
 *                5.145 deg to the ecliptic, with the regression of the
 *                ascending node (18.6 yr). Ignoring the lunar eccentricity
 *                (0.0549) costs up to ~21,000 km RADIALLY, but the dominant
 *                error is ALONG-TRACK: dropping the equation of the centre
 *                (6.29 deg amplitude) displaces the Moon by up to
 *                384,400 km * sin(6.29 deg) = ~42,000 km. Total position
 *                error reaches ~47,000 km.
 *
 *   'series'   - truncated ELP2000 trigonometric series (Meeus,
 *                "Astronomical Algorithms", Ch. 47, abridged). Retains the
 *                equation of the centre, evection, variation, annual equation
 *                and the leading latitude/distance terms. Accuracy is roughly
 *                0.02 deg in longitude (~130 km) and ~100 km in range over
 *                1950-2050. This is the DEFAULT.
 *
 * Both return the geocentric Earth -> Moon vector in J2000 EQUATORIAL axes,
 * matching the ECI integration frame. See docs/lunar-model.md.
 */

import { DEG, MOON_INC_ECLIPTIC, MOON_SMA } from '../constants.ts';
import { type Vec3, norm, scale, sub } from '../vec3.ts';
import { daysSinceJ2000 } from './time.ts';

export type MoonModel = 'circular' | 'series';

export const MOON_MODEL_LABELS: Record<MoonModel, string> = {
  circular: 'Circular (mean distance, node regression)',
  series: 'Truncated ELP2000 series (Meeus abridged)',
};

export const MOON_MODEL_ACCURACY: Record<MoonModel, string> = {
  circular:
    'Position error up to ~47,000 km. Ignoring the lunar eccentricity costs ~21,000 km radially, and dropping the equation of the centre displaces the Moon a further ~42,000 km along its orbit.',
  series: 'Position error ~150 km over 1950-2050.',
};

export interface MoonState {
  /** Earth -> Moon position in J2000 equatorial axes [m]. */
  position: Vec3;
  /** Earth -> Moon velocity in J2000 equatorial axes [m/s] (finite difference). */
  velocity: Vec3;
  /** Earth-Moon distance [m]. */
  distance: number;
}

/** Mean obliquity of the ecliptic of date [rad], same expression as sun.ts. */
function obliquity(d: number): number {
  return (23.439 - 4.0e-7 * d) * DEG;
}

/** Rotate an ecliptic-frame vector into equatorial axes. */
function eclipticToEquatorial(v: Vec3, eps: number): Vec3 {
  const ce = Math.cos(eps);
  const se = Math.sin(eps);
  return [v[0], ce * v[1] - se * v[2], se * v[1] + ce * v[2]];
}

/** Earth -> Moon position [m] in equatorial axes, position only. */
export function moonPosition(jd: number, model: MoonModel = 'series'): Vec3 {
  const d = daysSinceJ2000(jd);
  const ecl = model === 'circular' ? circularEcliptic(d) : seriesEcliptic(d);
  return eclipticToEquatorial(ecl, obliquity(d));
}

/**
 * Earth -> Moon state. Velocity is obtained by a central finite difference of
 * the analytic position over +/- 60 s. The truncation error of that difference
 * is ~1e-5 m/s, negligible next to the ephemeris error itself, and it avoids
 * having to differentiate the series by hand.
 */
export function moonState(jd: number, model: MoonModel = 'series'): MoonState {
  const h = 60 / 86400; // 60 s expressed in days
  const position = moonPosition(jd, model);
  const pPlus = moonPosition(jd + h, model);
  const pMinus = moonPosition(jd - h, model);
  const velocity = scale(sub(pPlus, pMinus), 1 / 120);
  return { position, velocity, distance: norm(position) };
}

// ---------------------------------------------------------------------------
// Model 1: circular orbit with node regression
// ---------------------------------------------------------------------------

function circularEcliptic(d: number): Vec3 {
  // Mean longitude of the Moon and of the ascending node [deg]
  const Lp = (218.3164477 + 13.17639648 * d) * DEG;
  const node = (125.0445479 - 0.0529539 * d) * DEG;

  // Argument of latitude measured in the orbit plane from the ascending node.
  const u = Lp - node;
  const i = MOON_INC_ECLIPTIC;
  const r = MOON_SMA;

  const cu = Math.cos(u);
  const su = Math.sin(u);
  const cn = Math.cos(node);
  const sn = Math.sin(node);
  const ci = Math.cos(i);
  const si = Math.sin(i);

  return [
    r * (cn * cu - sn * su * ci),
    r * (sn * cu + cn * su * ci),
    r * (su * si),
  ];
}

// ---------------------------------------------------------------------------
// Model 2: truncated ELP2000 series (Meeus Ch. 47, abridged)
// ---------------------------------------------------------------------------

function seriesEcliptic(d: number): Vec3 {
  // Fundamental (Delaunay) arguments [rad]
  const Lp = (218.3164477 + 13.17639648 * d) * DEG; // Moon mean longitude
  const D = (297.8501921 + 12.19074912 * d) * DEG; // mean elongation Moon-Sun
  const M = (357.5291092 + 0.98560028 * d) * DEG; // Sun mean anomaly
  const Mp = (134.9633964 + 13.06499295 * d) * DEG; // Moon mean anomaly
  const F = (93.272095 + 13.22935024 * d) * DEG; // argument of latitude

  const sin = Math.sin;
  const cos = Math.cos;

  // Ecliptic longitude [deg]. Leading term is the equation of the centre
  // (6.289 sin M'), then evection, variation and the annual equation.
  const lonDeg =
    6.289 * sin(Mp) +
    1.274 * sin(2 * D - Mp) +
    0.658 * sin(2 * D) +
    0.214 * sin(2 * Mp) -
    0.186 * sin(M) -
    0.114 * sin(2 * F) +
    0.059 * sin(2 * D - 2 * Mp) +
    0.057 * sin(2 * D - M - Mp) +
    0.053 * sin(2 * D + Mp) +
    0.046 * sin(2 * D - M) -
    0.041 * sin(M - Mp) -
    0.035 * sin(D) -
    0.031 * sin(M + Mp);
  const lambda = Lp + lonDeg * DEG;

  // Ecliptic latitude [deg].
  //
  // NOTE the argument of the third term: it is sin(M' - F), NOT sin(F - M').
  // Getting that sign wrong is easy and quietly wrong-looking: the pair
  //   0.281 sin(M' + F) + 0.277 sin(M' - F)
  // combines to approximately 0.557 cos(F) sin(M'), which does not reinforce
  // the leading 5.128 sin(F) term. With the sign flipped the pair becomes
  // 0.557 sin(F) cos(M') instead, which DOES reinforce it and pushes the peak
  // ecliptic latitude to 5.82 deg. The true maximum is about 5.30 deg (the
  // lunar orbital inclination oscillates between 5.00 and 5.30 deg), so the
  // error shows up as a half-degree excursion of the lunar orbit plane.
  const latDeg =
    5.128 * sin(F) +
    0.281 * sin(Mp + F) +
    0.278 * sin(Mp - F) +
    0.173 * sin(2 * D - F) +
    0.055 * sin(2 * D - Mp + F) +
    0.046 * sin(2 * D - Mp - F) +
    0.033 * sin(2 * D + F) +
    0.017 * sin(2 * Mp + F);
  const beta = latDeg * DEG;

  // Geocentric distance [km]
  const distKm =
    385000.56 -
    20905.355 * cos(Mp) -
    3699.111 * cos(2 * D - Mp) -
    2955.968 * cos(2 * D) -
    569.925 * cos(2 * Mp) +
    246.158 * cos(2 * D - 2 * Mp) -
    204.586 * cos(M - Mp) -
    170.733 * cos(2 * D + Mp) -
    152.138 * cos(2 * D + M - Mp) -
    129.62 * cos(D) +
    108.743 * cos(D + Mp);
  const r = distKm * 1000;

  const cb = Math.cos(beta);
  return [r * cb * Math.cos(lambda), r * cb * Math.sin(lambda), r * Math.sin(beta)];
}
