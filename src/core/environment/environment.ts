/**
 * Environment: everything the force model needs to know about the universe at
 * a given mission time, expressed in the chosen inertial integration frame.
 *
 * The integration CENTRE is configurable ('earth' or 'moon'). All body
 * positions are returned relative to that centre, with axes parallel to J2000
 * equatorial. This is the seam that lets a heliocentric centre be added later
 * for interplanetary work (see docs/future-work.md) without touching the
 * gravity, SRP, attitude or integrator code.
 */

import { MU_EARTH, MU_MOON, MU_SUN, R_EARTH, R_MOON } from '../constants.ts';
import { type Vec3, ZERO, neg, norm, sub } from '../vec3.ts';
import { type MoonModel, moonState } from './moon.ts';
import { sunState } from './sun.ts';
import { missionTimeToJd } from './time.ts';

export type CentralBody = 'earth' | 'moon';

export const CENTRAL_BODY_LABELS: Record<CentralBody, string> = {
  earth: 'Earth-centred inertial (ECI, J2000 equatorial axes)',
  moon: 'Moon-centred inertial (MCI, J2000 equatorial axes)',
};

export interface BodyState {
  name: 'Earth' | 'Moon' | 'Sun';
  /** Position relative to the integration centre [m]. */
  position: Vec3;
  /** Velocity relative to the integration centre [m/s]. Sun velocity is not modelled. */
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
  } else {
    // Moon-centred: shift everything by -r_EarthMoon.
    earthPos = neg(moon.position);
    earthVel = neg(moon.velocity);
    moonPos = ZERO;
    moonVel = ZERO;
    sunPos = sub(sun.position, moon.position);
  }

  const isEarthCentre = cfg.centre === 'earth';

  return {
    t,
    jd,
    centre: cfg.centre,
    muCentral: isEarthCentre ? MU_EARTH : MU_MOON,
    radiusCentral: isEarthCentre ? R_EARTH : R_MOON,
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
      isCentral: !isEarthCentre,
    },
    sun: {
      name: 'Sun',
      position: sunPos,
      velocity: ZERO,
      mu: MU_SUN,
      radius: 6.957e8,
      isCentral: false,
    },
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
