/**
 * Environment: everything the force model needs to know about the universe at
 * a given mission time, expressed in the chosen inertial integration frame.
 *
 * The integration CENTRE is configurable: 'earth', 'moon' or 'sun'. All body
 * positions are returned relative to that centre, with axes parallel to J2000
 * equatorial.
 *
 * That switch is the only structural thing interplanetary work needed. Adding
 * the heliocentric centre changed this file and nothing in the gravity, SRP,
 * attitude or integrator code: `sunToCraft` already returned the right vector
 * (it becomes simply `r` when the Sun is at the origin), `pressureAt` already
 * scaled as 1/r^2 with no assumption that r is near 1 AU, and the cone/clock
 * attitude frame was always Sun-relative. See docs/interplanetary-model.md.
 */

import { MU_EARTH, MU_MOON, MU_SUN, R_EARTH, R_MOON, R_SUN } from '../constants.ts';
import { type Vec3, ZERO, add, neg, norm, sub } from '../vec3.ts';
import { type MoonModel, moonState } from './moon.ts';
import { type PlanetId, PLANET_FACTS, earthHeliocentric, planetState } from './planets.ts';
import { sunState } from './sun.ts';
import { missionTimeToJd } from './time.ts';

export type CentralBody = 'earth' | 'moon' | 'sun';

export const CENTRAL_BODY_LABELS: Record<CentralBody, string> = {
  earth: 'Earth-centred inertial (ECI, J2000 equatorial axes)',
  moon: 'Moon-centred inertial (MCI, J2000 equatorial axes)',
  sun: 'Heliocentric inertial (HCI, J2000 equatorial axes)',
};

/** Short frame name, for readouts where the full label will not fit. */
export const CENTRAL_BODY_FRAME: Record<CentralBody, string> = {
  earth: 'ECI',
  moon: 'MCI',
  sun: 'HCI',
};

export const CENTRAL_BODY_NAMES: Record<CentralBody, string> = {
  earth: 'Earth',
  moon: 'Moon',
  sun: 'Sun',
};

/** Gravitational parameter of an integration centre [m^3/s^2]. */
export const CENTRAL_MU: Record<CentralBody, number> = {
  earth: MU_EARTH,
  moon: MU_MOON,
  sun: MU_SUN,
};

/**
 * Reference radius of an integration centre [m].
 *
 * For the Sun this is the photospheric radius. "Altitude above the Sun" is not
 * a quantity anyone uses, but it is what makes the minimum-altitude floor mean
 * something for a close solar pass, and the UI reports heliocentric RADIUS in
 * AU rather than altitude.
 */
export const CENTRAL_RADIUS: Record<CentralBody, number> = {
  earth: R_EARTH,
  moon: R_MOON,
  sun: R_SUN,
};

export interface BodyState {
  /** Display name. Free text because the planet list is open-ended. */
  name: string;
  /** Position relative to the integration centre [m]. */
  position: Vec3;
  /**
   * Velocity relative to the integration centre [m/s].
   *
   * Left at zero for a body whose motion the model does not need: the Sun in
   * a planet-centred frame, and every perturbing planet (third-body gravity
   * uses position only). It is populated for the Earth and the Moon, where
   * the lunar-encounter analysis needs a relative velocity.
   */
  velocity: Vec3;
  /** Gravitational parameter [m^3/s^2]. */
  mu: number;
  /** Mean radius [m]. Sun radius is in constants. */
  radius: number;
  /** True for the body at the origin. */
  isCentral: boolean;
}

export interface EnvironmentSnapshot {
  /** Mission elapsed time [s]. */
  t: number;
  /** Absolute Julian date. */
  jd: number;
  /** Integration centre. */
  centre: CentralBody;
  /** Gravitational parameter of the central body [m^3/s^2]. */
  muCentral: number;
  /** Mean radius of the central body [m]. */
  radiusCentral: number;
  earth: BodyState;
  moon: BodyState;
  sun: BodyState;
  /**
   * Perturbing planets, in the order requested by the configuration.
   *
   * Empty unless the configuration asks for them. Each one costs a Kepler
   * solve per acceleration evaluation, so they are not computed speculatively.
   */
  planets: BodyState[];
  /** Earth -> Moon vector [m], independent of the integration centre. */
  earthToMoon: Vec3;
}

export interface EnvironmentConfig {
  /** Mission epoch as a Julian date. */
  epochJd: number;
  /** Integration centre. */
  centre: CentralBody;
  /** Lunar ephemeris fidelity. */
  moonModel: MoonModel;
  /**
   * Planets to include as perturbing third bodies.
   *
   * The Earth is never listed here - it is always present as `env.earth`,
   * from the solar series rather than the planetary table, so that the same
   * Earth is used in every frame. See planets.ts.
   */
  planets?: PlanetId[];
}

/**
 * Build the environment snapshot at mission time `t` [s].
 *
 * Both ephemerides are analytic and cheap (a handful of trig calls), so this
 * is safe to call at every RK stage rather than interpolating.
 */
export function evaluateEnvironment(cfg: EnvironmentConfig, t: number): EnvironmentSnapshot {
  const jd = missionTimeToJd(cfg.epochJd, t);

  const sun = sunState(jd); // Earth -> Sun
  const moon = moonState(jd, cfg.moonModel); // Earth -> Moon

  const earthToMoon = moon.position;

  let earthPos: Vec3;
  let earthVel: Vec3;
  let moonPos: Vec3;
  let moonVel: Vec3;
  let sunPos: Vec3;

  if (cfg.centre === 'earth') {
    earthPos = ZERO;
    earthVel = ZERO;
    moonPos = moon.position;
    moonVel = moon.velocity;
    sunPos = sun.position;
  } else if (cfg.centre === 'moon') {
    // Moon-centred: shift everything by -r_EarthMoon.
    earthPos = neg(moon.position);
    earthVel = neg(moon.velocity);
    moonPos = ZERO;
    moonVel = ZERO;
    sunPos = sub(sun.position, moon.position);
  } else {
    // Heliocentric. The Earth comes from the SAME solar series used by every
    // geocentric calculation, negated - not from the planetary table - so the
    // Earth does not move when the integration centre is switched.
    const earth = earthHeliocentric(jd);
    earthPos = earth.position;
    earthVel = earth.velocity;
    moonPos = add(earth.position, moon.position);
    moonVel = add(earth.velocity, moon.velocity);
    sunPos = ZERO;
  }

  const isEarthCentre = cfg.centre === 'earth';
  const isSunCentre = cfg.centre === 'sun';

  // Perturbing planets. Positions are heliocentric from the table, then
  // shifted into whatever frame is in force.
  const planets: BodyState[] = [];
  const wanted = cfg.planets;
  if (wanted && wanted.length > 0) {
    // Offset from the Sun to the integration centre, so a heliocentric planet
    // position can be expressed in the current frame.
    const centreFromSun: Vec3 = isSunCentre ? ZERO : neg(sunPos);
    for (const id of wanted) {
      if (id === 'earth') continue; // always present as env.earth
      const st = planetState(id, jd);
      const facts = PLANET_FACTS[id];
      planets.push({
        name: facts.name,
        position: sub(st.position, centreFromSun),
        velocity: st.velocity,
        mu: facts.mu,
        radius: facts.radius,
        isCentral: false,
      });
    }
  }

  return {
    t,
    jd,
    centre: cfg.centre,
    muCentral: CENTRAL_MU[cfg.centre],
    radiusCentral: CENTRAL_RADIUS[cfg.centre],
    earth: {
      name: 'Earth',
      position: earthPos,
      velocity: earthVel,
      mu: MU_EARTH,
      radius: R_EARTH,
      isCentral: isEarthCentre,
    },
    moon: {
      name: 'Moon',
      position: moonPos,
      velocity: moonVel,
      mu: MU_MOON,
      radius: R_MOON,
      isCentral: cfg.centre === 'moon',
    },
    sun: {
      name: 'Sun',
      position: sunPos,
      velocity: ZERO,
      mu: MU_SUN,
      radius: R_SUN,
      isCentral: isSunCentre,
    },
    planets,
    earthToMoon,
  };
}

/**
 * Unit vector from the Sun to the spacecraft - the direction photons travel.
 * This is the vector the SRP model and the Sun-relative attitude frame use.
 */
export function sunToCraft(env: EnvironmentSnapshot, rCraft: Vec3): Vec3 {
  return sub(rCraft, env.sun.position);
}

/** Distance from the Sun to the spacecraft [m]. */
export function solarDistance(env: EnvironmentSnapshot, rCraft: Vec3): number {
  return norm(sunToCraft(env, rCraft));
}
