/**
 * Planetary ephemerides.
 *
 * ---------------------------------------------------------------------------
 * MODEL
 * ---------------------------------------------------------------------------
 * Standish's "Keplerian Elements for Approximate Positions of the Major
 * Planets" (JPL Solar System Dynamics): six osculating elements per planet
 * plus a linear rate per Julian century, referred to the mean ecliptic and
 * equinox of J2000. Position is then obtained by solving Kepler's equation
 * and converting exactly as for any other orbit — which is why this module
 * reuses `elementsToRv` rather than writing its own conversion.
 *
 * The 1800-2050 coefficient set is used. Over that span the position error is
 * a few arcseconds for the inner planets and under an arcminute for the outer
 * ones, i.e. of order 10^-5 AU for Venus and Mars. For comparison, the sail
 * force at 1 AU is known to about 1% from the optical coefficients alone, so
 * the ephemeris is nowhere near the limiting error in an interplanetary sail
 * study.
 *
 * ---------------------------------------------------------------------------
 * WHY THE EARTH IS NOT TAKEN FROM THIS TABLE
 * ---------------------------------------------------------------------------
 * The table's Earth row is the Earth-MOON BARYCENTRE, and the environment
 * already has an Earth: the low-precision solar series in `sun.ts`, which is
 * what every geocentric calculation in the simulator has always used. Taking
 * the Earth from a second source in heliocentric mode would mean the Earth
 * jumped by tens of thousands of kilometres when the integration centre was
 * switched, which is exactly the kind of frame inconsistency that produces a
 * plausible and wrong trajectory.
 *
 * So `earthHeliocentric()` below simply negates the Earth -> Sun vector, and
 * one Earth is used everywhere. The barycentre row is still tabulated, and
 * `interplanetary.test.ts` cross-checks the two against each other over fifty
 * years, which bounds the disagreement rather than hiding it.
 *
 * ---------------------------------------------------------------------------
 * FRAME, AND THE PRECESSION THAT ALMOST GOT MISSED
 * ---------------------------------------------------------------------------
 * The elements are referred to the ecliptic and mean equinox of J2000. But
 * `sun.ts` and `moon.ts` do not work in that frame: both evaluate APPARENT
 * coordinates referred to the equinox OF DATE, which is the correct
 * convention for the low-precision series they implement. The giveaway is in
 * the rate constants - the solar series advances at 0.9856474 deg/day (the
 * tropical year, because its origin precesses) while the Standish table
 * advances the Earth at 0.9856092 deg/day (the sidereal year, because its
 * origin does not).
 *
 * The difference is exactly the general precession in longitude, 50.29
 * arcseconds a year. Left alone it rotates the planets against the Sun and
 * Moon by 0.7 degrees over the 2000-2050 span this tool is used across -
 * 1.8 million kilometres at 1 AU, and completely invisible in a trajectory
 * plot, which would simply look like a slightly different launch date.
 *
 * So the elements are precessed into the equinox of date before use, by
 * adding the accumulated general precession to the node, the longitude of
 * perihelion and the mean longitude together. Adding it to all three rotates
 * the orbit bodily about the ecliptic pole and leaves the argument of
 * perihelion and the mean anomaly untouched, which is what a change of origin
 * for longitudes must do. The conversion to equatorial axes then uses the
 * obliquity OF DATE, matching the other two ephemerides.
 *
 * `interplanetary.test.ts` pins this down by cross-checking the table's
 * Earth-Moon barycentre against the solar series over fifty years; without
 * the correction that check fails by a factor of thirty.
 */

import { AU, MU_SUN, SEC_PER_DAY } from '../constants.ts';
import { type Vec3, norm, scale, sub } from '../vec3.ts';
import { elementsToRv, solveKepler, wrap2Pi } from '../orbital/elements.ts';
import { centuriesSinceJ2000, daysSinceJ2000 } from './time.ts';
import { sunState } from './sun.ts';

export type PlanetId =
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune';

/** Physical facts about a planet, independent of where it is. */
export interface PlanetFacts {
  id: PlanetId;
  name: string;
  /** Gravitational parameter [m^3/s^2]. Planet + its moons where relevant. */
  mu: number;
  /** Mean radius [m]. */
  radius: number;
  /**
   * Radius of the sphere of influence with respect to the Sun [m],
   * a (m_planet / m_sun)^(2/5).
   *
   * Not used by the force model - the simulator integrates in one frame
   * throughout and does not patch conics - but it is the number that says
   * whether a heliocentric result near a planet should be believed.
   */
  soiRadius: number;
}

const DEG = Math.PI / 180;

/**
 * Standish's elements and their centennial rates.
 *
 * Order: a [AU], e [-], I [deg], L [deg], longPeri [deg], longNode [deg].
 * `rates` are per Julian century. Valid 1800-2050.
 */
interface ElementSet {
  a: number;
  e: number;
  i: number;
  /** Mean longitude L [deg]. */
  l: number;
  /** Longitude of perihelion, varpi = argp + raan [deg]. */
  peri: number;
  /** Longitude of the ascending node [deg]. */
  node: number;
}

interface PlanetTableRow {
  facts: PlanetFacts;
  epoch: ElementSet;
  rate: ElementSet;
}

const TABLE: Record<PlanetId, PlanetTableRow> = {
  mercury: {
    facts: { id: 'mercury', name: 'Mercury', mu: 2.2032e13, radius: 2.4397e6, soiRadius: 1.12e8 },
    epoch: { a: 0.38709927, e: 0.20563593, i: 7.00497902, l: 252.2503235, peri: 77.45779628, node: 48.33076593 },
    rate: { a: 0.00000037, e: 0.00001906, i: -0.00594749, l: 149472.67411175, peri: 0.16047689, node: -0.12534081 },
  },
  venus: {
    facts: { id: 'venus', name: 'Venus', mu: 3.24859e14, radius: 6.0518e6, soiRadius: 6.16e8 },
    epoch: { a: 0.72333566, e: 0.00677672, i: 3.39467605, l: 181.9790995, peri: 131.60246718, node: 76.67984255 },
    rate: { a: 0.0000039, e: -0.00004107, i: -0.0007889, l: 58517.81538729, peri: 0.00268329, node: -0.27769418 },
  },
  earth: {
    // Earth-Moon barycentre. Tabulated for the cross-check only - see the
    // module comment. `earthHeliocentric()` is what the environment uses.
    facts: { id: 'earth', name: 'Earth', mu: 3.986004418e14, radius: 6.371e6, soiRadius: 9.24e8 },
    epoch: { a: 1.00000261, e: 0.01671123, i: -0.00001531, l: 100.46457166, peri: 102.93768193, node: 0 },
    rate: { a: 0.00000562, e: -0.00004392, i: -0.01294668, l: 35999.37244981, peri: 0.32327364, node: 0 },
  },
  mars: {
    facts: { id: 'mars', name: 'Mars', mu: 4.282837e13, radius: 3.3895e6, soiRadius: 5.77e8 },
    epoch: { a: 1.52371034, e: 0.0933941, i: 1.84969142, l: -4.55343205, peri: -23.94362959, node: 49.55953891 },
    rate: { a: 0.00001847, e: 0.00007882, i: -0.00813131, l: 19140.30268499, peri: 0.44441088, node: -0.29257343 },
  },
  jupiter: {
    facts: { id: 'jupiter', name: 'Jupiter', mu: 1.26686534e17, radius: 6.9911e7, soiRadius: 4.82e10 },
    epoch: { a: 5.202887, e: 0.04838624, i: 1.30439695, l: 34.39644051, peri: 14.72847983, node: 100.47390909 },
    rate: { a: -0.00011607, e: -0.00013253, i: -0.00183714, l: 3034.74612775, peri: 0.21252668, node: 0.20469106 },
  },
  saturn: {
    facts: { id: 'saturn', name: 'Saturn', mu: 3.7931187e16, radius: 5.8232e7, soiRadius: 5.45e10 },
    epoch: { a: 9.53667594, e: 0.05386179, i: 2.48599187, l: 49.95424423, peri: 92.59887831, node: 113.66242448 },
    rate: { a: -0.0012506, e: -0.00050991, i: 0.00193609, l: 1222.49362201, peri: -0.41897216, node: -0.28867794 },
  },
  uranus: {
    facts: { id: 'uranus', name: 'Uranus', mu: 5.793939e15, radius: 2.5362e7, soiRadius: 5.18e10 },
    epoch: { a: 19.18916464, e: 0.04725744, i: 0.77263783, l: 313.23810451, peri: 170.9542763, node: 74.01692503 },
    rate: { a: -0.00196176, e: -0.00004397, i: -0.00242939, l: 428.48202785, peri: 0.40805281, node: 0.04240589 },
  },
  neptune: {
    facts: { id: 'neptune', name: 'Neptune', mu: 6.836529e15, radius: 2.4622e7, soiRadius: 8.66e10 },
    epoch: { a: 30.06992276, e: 0.00859048, i: 1.77004347, l: -55.12002969, peri: 44.96476227, node: 131.78422574 },
    rate: { a: 0.00026291, e: 0.00005105, i: 0.00035372, l: 218.45945325, peri: -0.32241464, node: -0.00508664 },
  },
};

export const PLANET_IDS = Object.keys(TABLE) as PlanetId[];

export const PLANET_FACTS: Record<PlanetId, PlanetFacts> = Object.fromEntries(
  PLANET_IDS.map((id) => [id, TABLE[id].facts]),
) as Record<PlanetId, PlanetFacts>;

/** Lowest and highest year for which the coefficient set is published. */
export const PLANET_EPHEMERIS_VALID_FROM = 1800;
export const PLANET_EPHEMERIS_VALID_TO = 2050;

export interface PlanetState {
  /** Sun -> planet position in J2000 equatorial axes [m]. */
  position: Vec3;
  /** Sun -> planet velocity in J2000 equatorial axes [m/s]. */
  velocity: Vec3;
  /** Heliocentric distance [m]. */
  distance: number;
}

/**
 * General precession in ecliptic longitude since J2000 [rad].
 *
 * IAU 2006 series, truncated at the quadratic term:
 *   p_A = 5028.796195" T + 1.1054348" T^2
 * The neglected cubic contributes under a milliarcsecond over the span this
 * ephemeris is published for.
 */
function precessionInLongitude(t: number): number {
  const arcsec = 5028.796195 * t + 1.1054348 * t * t;
  return (arcsec / 3600) * DEG;
}

/** Mean obliquity of the ecliptic of date [rad], same expression as sun.ts. */
function obliquityOfDate(jd: number): number {
  return (23.439 - 4.0e-7 * daysSinceJ2000(jd)) * DEG;
}

/** Rotate an ecliptic-frame vector into equatorial axes. */
function eclipticToEquatorial(v: Vec3, eps: number): Vec3 {
  const ce = Math.cos(eps);
  const se = Math.sin(eps);
  return [v[0], ce * v[1] - se * v[2], se * v[1] + ce * v[2]];
}

/**
 * Osculating heliocentric elements of a planet at Julian date `jd`, referred
 * to the ecliptic and mean equinox OF DATE. Angles in radians, `sma` in
 * metres.
 */
export function planetElements(id: PlanetId, jd: number): {
  sma: number;
  ecc: number;
  inc: number;
  raan: number;
  argp: number;
  trueAnomaly: number;
  meanAnomaly: number;
} {
  const row = TABLE[id];
  const t = centuriesSinceJ2000(jd);

  const a = (row.epoch.a + row.rate.a * t) * AU;
  const e = row.epoch.e + row.rate.e * t;
  const inc = (row.epoch.i + row.rate.i * t) * DEG;

  // Shift all three longitudes into the equinox of date together. The
  // argument of perihelion (peri - node) and the mean anomaly (l - peri) are
  // both differences, so both come through unchanged - which is exactly the
  // property that makes this a change of origin rather than a change of orbit.
  const pA = precessionInLongitude(t);
  const l = (row.epoch.l + row.rate.l * t) * DEG + pA;
  const peri = (row.epoch.peri + row.rate.peri * t) * DEG + pA;
  const node = (row.epoch.node + row.rate.node * t) * DEG + pA;

  // argp = longitude of perihelion - longitude of ascending node
  const argp = wrap2Pi(peri - node);
  // Mean anomaly = mean longitude - longitude of perihelion
  const meanAnomaly = wrap2Pi(l - peri);

  return {
    sma: a,
    ecc: e,
    inc,
    raan: wrap2Pi(node),
    argp,
    trueAnomaly: trueFromMean(meanAnomaly, e),
    meanAnomaly,
  };
}

/**
 * True anomaly from mean anomaly.
 *
 * `solveKepler` is the shared Newton iteration already used by the attitude
 * and elements code; reusing it means the planets and the spacecraft solve
 * Kepler's equation the same way.
 */
function trueFromMean(m: number, e: number): number {
  const bigE = solveKepler(m, e);
  return wrap2Pi(
    2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(bigE / 2), Math.sqrt(1 - e) * Math.cos(bigE / 2)),
  );
}

/**
 * Sun -> planet state in J2000 equatorial axes.
 *
 * Velocity is the analytic two-body velocity of the osculating orbit, not a
 * finite difference: the elements are already in hand, so there is nothing to
 * gain by differencing. The secular drift of the elements themselves
 * contributes of order 1e-7 of the orbital speed and is ignored.
 */
export function planetState(id: PlanetId, jd: number): PlanetState {
  const el = planetElements(id, jd);
  const { r, v } = elementsToRv(el, MU_SUN);
  const eps = obliquityOfDate(jd);
  const position = eclipticToEquatorial(r, eps);
  const velocity = eclipticToEquatorial(v, eps);
  return { position, velocity, distance: norm(position) };
}

/**
 * Sun -> Earth state in J2000 equatorial axes, from the SAME solar series
 * every geocentric calculation uses.
 *
 * This is the Earth the simulator believes in; see the module comment for why
 * it is not the table row above. The velocity is a central finite difference
 * of the analytic position over +/- 60 s, matching how `moonState` does it.
 */
export function earthHeliocentric(jd: number): PlanetState {
  const h = 60 / SEC_PER_DAY;
  const position = scale(sunState(jd).position, -1);
  const plus = scale(sunState(jd + h).position, -1);
  const minus = scale(sunState(jd - h).position, -1);
  return {
    position,
    velocity: scale(sub(plus, minus), 1 / 120),
    distance: norm(position),
  };
}

/** Sidereal orbital period of a planet [s], from its osculating elements. */
export function planetPeriod(id: PlanetId, jd = 2451545.0): number {
  const el = planetElements(id, jd);
  return 2 * Math.PI * Math.sqrt(el.sma ** 3 / MU_SUN);
}

/**
 * Synodic period between two planets [s] - the interval between successive
 * identical relative configurations, and therefore the spacing of launch
 * opportunities for a transfer between them.
 */
export function synodicPeriod(a: PlanetId, b: PlanetId): number {
  const pa = planetPeriod(a);
  const pb = planetPeriod(b);
  const diff = Math.abs(1 / pa - 1 / pb);
  return diff > 0 ? 1 / diff : Infinity;
}
