/**
 * Scenario catalogue and default configurations.
 *
 * A scenario supplies the initial orbit, the integration centre, a sensible
 * force-model selection and integration settings. Presets (presets.ts) go
 * further and also fix the sail and the attitude law to demonstrate a specific
 * question.
 */

import {
  AU,
  DEG,
  MOON_SMA,
  MU_EARTH,
  MU_SUN,
  R_EARTH,
  R_MOON,
  R_SUN,
  SEC_PER_DAY,
} from '../core/constants.ts';
import { type Vec3, add, cross, norm, rotateAbout, scale, sub, unit } from '../core/vec3.ts';
import { moonState } from '../core/environment/moon.ts';
import {
  type PlanetId,
  earthHeliocentric,
  planetPeriod,
  planetState,
  synodicPeriod,
} from '../core/environment/planets.ts';
import { isoToJd } from '../core/environment/time.ts';
import { DEFAULT_SAIL, DEFAULT_SPACECRAFT } from '../core/sail/sail.ts';
import type { ForceToggles } from '../core/forces/forceModel.ts';
import type { AttitudeConfig } from '../core/attitude/types.ts';
import type { IntegrationConfig, SimulationConfig } from './types.ts';

/** Default mission epoch. A March equinox gives a clean Sun geometry. */
export const DEFAULT_EPOCH = '2026-03-20T12:00:00Z';

export type ScenarioGroup = 'earth' | 'lunar' | 'interplanetary';

export const SCENARIO_GROUP_LABELS: Record<ScenarioGroup, string> = {
  earth: 'Earth orbit',
  lunar: 'Lunar',
  interplanetary: 'Interplanetary',
};

export interface Scenario {
  id: string;
  group: ScenarioGroup;
  name: string;
  /** One-line description shown in the picker. */
  description: string;
  /** Longer note about what this scenario is good for, or its caveats. */
  note?: string;
  /** Not yet implemented - shown greyed out with a "future version" badge. */
  future?: boolean;
  /** Build the configuration for this scenario. */
  build?: (epoch: string) => SimulationConfig;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Integration settings tuned for a given orbital period. */
function integrationFor(
  periodSeconds: number,
  durationDays: number,
  eccentricity = 0,
  /**
   * Altitude floor [m]. Must be well below the orbit altitude or the run
   * terminates immediately: a 100 km lunar orbit against the 100 km Earth
   * default would report an impact on the first perturbation.
   */
  minAltitude = 100e3,
): IntegrationConfig {
  // ~360 RK4 steps per revolution keeps the semi-major axis error below about
  // 1e-6 relative over a week (see docs/validation.md), scaled down for
  // eccentric orbits where periapsis motion is much faster.
  const periapsisFactor = (1 - Math.min(0.99, eccentricity)) ** 1.5;
  const raw = (periodSeconds * periapsisFactor) / 360;
  // Snap to a friendly value so the UI dropdown shows a recognisable number.
  const nice = [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const timestep = nice.reduce((best, x) => (x <= raw ? x : best), nice[0]);

  const duration = durationDays * SEC_PER_DAY;
  // Aim for ~4000 samples: enough to resolve every revolution in the plots
  // without making Plotly sluggish.
  const outputInterval = Math.max(timestep, Math.round(duration / 4000));

  return {
    integrator: 'rk4',
    timestep,
    duration,
    outputInterval,
    relTol: 1e-9,
    absTolPosition: 1e-3,
    absTolVelocity: 1e-6,
    minAltitude,
  };
}

/** Circular-orbit period for an altitude above the Earth [s]. */
const earthPeriod = (altitudeM: number): number =>
  2 * Math.PI * Math.sqrt((R_EARTH + altitudeM) ** 3 / MU_EARTH);

const EARTH_FORCES: ForceToggles = {
  centralGravity: true,
  earthJ2: true,
  earthJ3: false,
  moonGravity: false,
  sunGravity: false,
  planetGravity: false,
  solarRadiationPressure: true,
  eclipse: true,
  // Drag is ON for Earth orbits. Below ~600 km it is the largest
  // non-gravitational term by an order of magnitude, so a LEO scenario that
  // omitted it would give an answer with the wrong sign. It costs one
  // exponential per evaluation and switches itself off above 2000 km.
  atmosphericDrag: true,
  earthAlbedo: true,
  earthInfrared: true,
};

/**
 * Heliocentric force model.
 *
 * The Sun is now the central body, so `sunGravity` (a third-body term) is
 * meaningless and off. Drag, J2, J3, albedo and infrared are all
 * Earth-surface terms and are off; the Earth-radiation terms would in any
 * case switch themselves off geometrically once the spacecraft is more than
 * 100 Earth radii away.
 *
 * THE EARTH IS OFF, and that is a judgement rather than an oversight. These
 * scenarios start the spacecraft on the Earth's orbit because that is where a
 * mission would leave from - but they do not model the departure, so the
 * spacecraft's proximity to the Earth at t = 0 is an artefact of the initial
 * condition rather than a fact about the mission. Enabling Earth gravity then
 * models one arbitrary co-orbital geometry: at the 0.1 AU default lead it
 * tugs the osculating semi-major axis by about 0.4% over a year with no sail
 * force at all. The toggle is there, and switching it on is exactly how to
 * see that number for yourself.
 *
 * Eclipse stays ON. It costs almost nothing and it is not vacuous - a
 * trajectory that passes near the Earth still crosses its shadow.
 */
const HELIOCENTRIC_FORCES: ForceToggles = {
  centralGravity: true,
  earthJ2: false,
  earthJ3: false,
  moonGravity: false,
  sunGravity: false,
  planetGravity: true,
  solarRadiationPressure: true,
  eclipse: true,
  atmosphericDrag: false,
  earthAlbedo: false,
  earthInfrared: false,
};

/**
 * Planets carried as perturbing third bodies on a heliocentric run.
 *
 * Venus, Mars and Jupiter. Jupiter because it is by far the largest
 * perturber; Venus and Mars because they are the destinations, and a
 * closest-approach figure computed without the target's own gravity would be
 * wrong exactly where it matters. Mercury, Saturn, Uranus and Neptune are
 * omitted: each costs a Kepler solve per acceleration evaluation and none
 * moves an inner-system trajectory measurably over a year.
 */
const INNER_SYSTEM_PLANETS: PlanetId[] = ['venus', 'mars', 'jupiter'];

const HIGH_EARTH_FORCES: ForceToggles = {
  ...EARTH_FORCES,
  moonGravity: true,
  sunGravity: true,
  // Above a few thousand kilometres both terms are numerically zero (the
  // atmosphere model cuts off at 2000 km, Earth radiation falls as 1/r^2).
  // Switched off so the run does not pay for evaluating them.
  atmosphericDrag: false,
  earthAlbedo: false,
  earthInfrared: false,
};

const LUNAR_FORCES: ForceToggles = {
  centralGravity: true,
  earthJ2: false,
  earthJ3: false,
  moonGravity: true,
  sunGravity: true,
  planetGravity: false,
  solarRadiationPressure: true,
  eclipse: true,
  atmosphericDrag: false,
  earthAlbedo: false,
  earthInfrared: false,
};

/**
 * Default attitude law: a FEATHERING orbit-fraction schedule, expressed as
 * cone angles in the Sun-relative frame and phased on the Sun direction.
 *
 * The physics it encodes is the central trick of planet-centred solar
 * sailing. The sail can only push away from the Sun, so over one revolution
 * the along-track component of that push is prograde for half the orbit and
 * retrograde for the other half, and a constant attitude nets out to almost
 * nothing. Turning the sail EDGE-ON (cone = 90 deg, zero projected area)
 * through the unfavourable half and back to the near-optimal 35 deg through
 * the favourable half leaves a one-sided, secular energy gain.
 *
 * Measured in the default 500 km LEO with a 1 m^2/kg sail over 7 days, using
 * revolution-averaged elements (see docs/validation.md), WITH ATMOSPHERIC
 * DRAG DISABLED so the numbers describe the steering law alone. With drag on
 * - which is the shipping default for Earth orbits - every row shifts down by
 * about 16 km and they all become negative, because a 1 m^2/kg sail at 500 km
 * is a deorbit device. The RANKING is what this table is for, and drag does
 * not change it:
 *
 *   law                       d(mean sma)   impulse spent   duty factor
 *   ------------------------- -----------   -------------   -----------
 *   locally optimal prograde     +2375 m        1.83 m/s        36.5%
 *   THIS feathering schedule      +901 m        0.96 m/s        19.2%
 *   constant Sun-facing            -11 m        3.16 m/s        63.0%
 *   constant radial (pitch 0)       -8 m        1.20 m/s        23.9%
 *   naive +/-35 deg schedule      -699 m        1.04 m/s        20.7%
 *   constant 35 deg pitch         -948 m        1.37 m/s        27.3%
 *
 * The constant Sun-facing row is the whole argument for this tool: it has by
 * far the HIGHEST instantaneous acceleration and spends the MOST impulse, and
 * it changes the orbit by essentially nothing, because an unsteered force
 * cancels over each revolution. Three of the six laws lower the orbit.
 *
 * `optimalDirection: prograde` does better than this schedule because it
 * solves for the best normal continuously rather than switching between two
 * states, but the feathering schedule is the one that shows the user WHY,
 * which is the point of a default.
 */
export const DEFAULT_ATTITUDE: AttitudeConfig = {
  kind: 'orbitFraction',
  frame: 'sun',
  phaseVariable: 'sunPhase',
  knots: [
    { fraction: 0.0, angle1: 90 * DEG, angle2: 0 },
    { fraction: 0.45, angle1: 90 * DEG, angle2: 0 },
    { fraction: 0.55, angle1: 35 * DEG, angle2: 0 },
    { fraction: 0.95, angle1: 35 * DEG, angle2: 0 },
  ],
};

/** A circular (or elliptical) Earth orbit configuration. */
function earthOrbit(opts: {
  id: string;
  name: string;
  epoch: string;
  altitudeKm: number;
  ecc?: number;
  incDeg?: number;
  raanDeg?: number;
  argpDeg?: number;
  nuDeg?: number;
  durationDays: number;
  forces?: ForceToggles;
  attitude?: AttitudeConfig;
}): SimulationConfig {
  const ecc = opts.ecc ?? 0;
  const period = earthPeriod(opts.altitudeKm * 1000) / (1 - ecc) ** 1.5;
  return {
    version: 1,
    name: opts.name,
    scenarioId: opts.id,
    epoch: opts.epoch,
    centralBody: 'earth',
    moonModel: 'series',
    atmosphereActivity: 'mean',
    perturbingPlanets: [],
    initial: {
      mode: 'elements',
      altitude: opts.altitudeKm * 1000,
      eccentricity: ecc,
      inclination: (opts.incDeg ?? 51.6) * DEG,
      raan: (opts.raanDeg ?? 0) * DEG,
      argumentOfPeriapsis: (opts.argpDeg ?? 0) * DEG,
      trueAnomaly: (opts.nuDeg ?? 0) * DEG,
    },
    spacecraft: { ...DEFAULT_SPACECRAFT },
    sail: { ...DEFAULT_SAIL },
    attitude: opts.attitude ?? structuredClone(DEFAULT_ATTITUDE),
    forces: opts.forces ?? { ...EARTH_FORCES },
    integration: integrationFor(period, opts.durationDays, ecc),
  };
}

// ---------------------------------------------------------------------------
// Lunar transfer aiming
// ---------------------------------------------------------------------------

export interface LunarTransferAim {
  /** Initial position at perigee, ECI [m]. */
  r: Vec3;
  /** Initial velocity at perigee, ECI [m/s]. */
  v: Vec3;
  /** Apogee radius, equal to the predicted lunar distance at arrival [m]. */
  apogeeRadius: number;
  /** Time from perigee to apogee [s]. */
  timeOfFlight: number;
  /** Inclination of the resulting transfer orbit [rad]. */
  inclination: number;
}

/**
 * Aim a ballistic Earth-departure ellipse at the Moon.
 *
 * This is a GEOMETRIC AIMING HEURISTIC, not a trajectory optimiser:
 *
 *   1. Guess the time of flight as half the period of an ellipse whose apogee
 *      is at the mean lunar distance.
 *   2. Look up where the Moon will be at that time.
 *   3. Set the apogee radius to that lunar distance and re-derive the period.
 *   4. Repeat - the iteration converges in three or four passes because the
 *      lunar distance varies by only +/-5.5% over a month.
 *
 * The apsidal line is then placed along the predicted lunar direction (apogee
 * at the Moon, perigee opposite) and the transfer plane is chosen to contain
 * the lunar orbital angular momentum, so the transfer is coplanar with the
 * Moon's orbit at arrival.
 *
 * The spacecraft therefore arrives near the Moon with a small miss distance
 * (typically a few thousand km once third-body perturbations during the
 * cruise are accounted for), which is the right starting point for the
 * question the tool actually asks: can the SAIL usefully shift the encounter?
 * It is emphatically NOT a launch-quality targeting solution.
 */
export function aimAtMoon(
  epoch: string,
  perigeeAltitudeM: number,
  moonModel: 'circular' | 'series' = 'series',
): LunarTransferAim {
  const epochJd = isoToJd(epoch);
  const rp = R_EARTH + perigeeAltitudeM;

  let apogeeRadius = MOON_SMA;
  let tof = 0;
  let moonAtArrival = moonState(epochJd, moonModel);

  for (let iter = 0; iter < 6; iter++) {
    const sma = (rp + apogeeRadius) / 2;
    tof = Math.PI * Math.sqrt(sma ** 3 / MU_EARTH); // half period
    moonAtArrival = moonState(epochJd + tof / SEC_PER_DAY, moonModel);
    apogeeRadius = norm(moonAtArrival.position);
  }

  const sma = (rp + apogeeRadius) / 2;

  // Apogee points at the Moon; start the mission at perigee, opposite.
  const apogeeDir = unit(moonAtArrival.position);
  const perigeeDir = scale(apogeeDir, -1);

  // Transfer plane contains the lunar orbital angular momentum, so the
  // encounter geometry is coplanar with the Moon's motion.
  const hMoon = cross(moonAtArrival.position, moonAtArrival.velocity);
  const hHat = unit(hMoon);

  // Perigee speed from the vis-viva equation.
  const vp = Math.sqrt(MU_EARTH * (2 / rp - 1 / sma));
  const velDir = unit(cross(hHat, perigeeDir));

  // Inclination of the resulting orbit, for the readout.
  const inclination = Math.acos(Math.min(1, Math.max(-1, hHat[2])));

  return {
    r: scale(perigeeDir, rp),
    v: scale(velDir, vp),
    apogeeRadius,
    timeOfFlight: tof,
    inclination,
  };
}

/** Earth -> Moon transfer configuration built from the aiming helper. */
function lunarTransfer(epoch: string, opts?: { perigeeAltKm?: number }): SimulationConfig {
  const perigeeAlt = (opts?.perigeeAltKm ?? 400) * 1000;
  const aim = aimAtMoon(epoch, perigeeAlt, 'series');
  const durationDays = Math.ceil((aim.timeOfFlight / SEC_PER_DAY) * 1.6);

  return {
    version: 1,
    name: 'Earth to Moon transfer',
    scenarioId: 'lunar-transfer',
    epoch,
    centralBody: 'earth',
    moonModel: 'series',
    atmosphereActivity: 'mean',
    perturbingPlanets: [],
    initial: { mode: 'cartesian', position: aim.r, velocity: aim.v },
    spacecraft: { ...DEFAULT_SPACECRAFT },
    sail: { ...DEFAULT_SAIL },
    // A fixed Sun-relative attitude is the clearest way to see whether the
    // sail shifts the encounter: the command does not change, so any change in
    // the arrival geometry is attributable to the sail alone.
    attitude: { kind: 'sunRelative', cone: 35 * DEG, clock: 0 },
    forces: { ...LUNAR_FORCES, earthJ2: true },
    integration: {
      // The perigee-to-apogee radius ratio is ~57:1, so a fixed step cannot
      // serve both ends of this trajectory. Adaptive integration is the only
      // sensible default here.
      integrator: 'rkf45',
      timestep: 120,
      duration: durationDays * SEC_PER_DAY,
      outputInterval: Math.round((durationDays * SEC_PER_DAY) / 4000),
      relTol: 1e-10,
      absTolPosition: 1e-2,
      absTolVelocity: 1e-5,
      minAltitude: 100e3,
    },
  };
}


// ---------------------------------------------------------------------------
// Heliocentric departure
// ---------------------------------------------------------------------------

/**
 * Build a heliocentric initial state on the Earth's own orbit.
 *
 * The spacecraft is placed on the Earth's heliocentric orbit, LEADING the
 * Earth along track by `leadDistance` metres, optionally with a hyperbolic
 * excess velocity `vInfinity` [m/s] along the direction of motion.
 *
 * WHY ALONG-TRACK RATHER THAN "AT THE EARTH". Placing the spacecraft at the
 * Earth's position means placing it inside a singularity, and placing it one
 * sphere of influence away radially - the obvious patched-conic boundary -
 * turns out to be worse than it looks: with zero excess velocity the
 * spacecraft is then marginally bound to the Earth, and spends the run in a
 * quasi-satellite dance that moves the osculating semi-major axis by 2.5% of
 * an AU with no sail force at all. That is real physics, and it is a terrible
 * baseline to measure a sail against.
 *
 * Displacing ALONG TRACK instead puts the spacecraft on the Earth's orbit
 * exactly - same semi-major axis, same eccentricity, same period, apsides
 * rotated by the lead angle - and gets it far enough away that the Earth
 * stops mattering. At the 0.1 AU default the Earth's pull is about 1% of a
 * 100 m^2/kg sail's acceleration, and falls from there.
 *
 * WHAT THIS IS NOT. There is no departure hyperbola, no parking orbit, no
 * launch-window search and no C3 budget. The spacecraft simply appears on the
 * Earth's orbit already travelling at the given excess. That is a real
 * simplification, and it is the right one for the question this tool asks:
 * "what can the SAIL do once it is out there" must not depend on a launch
 * vehicle the tool does not model. With `vInfinity = 0` the spacecraft starts
 * on the Earth's orbit and every subsequent change is the sail and nothing
 * else.
 */
export function heliocentricDeparture(
  epoch: string,
  opts: { vInfinity?: number; leadDistance?: number } = {},
): { r: Vec3; v: Vec3; earthSpeed: number; earthDistance: number } {
  const jd = isoToJd(epoch);
  const earth = earthHeliocentric(jd);
  const vInf = opts.vInfinity ?? 0;
  const lead = opts.leadDistance ?? 0.1 * AU;

  const rMag = norm(earth.position);
  const hHat = unit(cross(earth.position, earth.velocity));
  // Arc length -> angle. Rotating the whole state about the orbit normal
  // keeps it on an orbit of identical shape and period.
  const theta = lead / rMag;

  const r = rotateAbout(earth.position, hHat, theta);
  const v = rotateAbout(earth.velocity, hHat, theta);
  const vHat = unit(v);

  return {
    r,
    v: add(v, scale(vHat, vInf)),
    earthSpeed: norm(earth.velocity),
    earthDistance: norm(sub(r, earth.position)),
  };
}

/** Integration settings for a heliocentric run of the given duration. */
function heliocentricIntegration(durationDays: number, timestep = 3600): IntegrationConfig {
  const duration = durationDays * SEC_PER_DAY;
  return {
    // Heliocentric arcs span two orders of magnitude in solar distance on a
    // solar-pass trajectory and almost none on a cruise, so the adaptive
    // scheme is the only sensible default: it takes hour-scale steps in
    // cruise and shortens automatically at perihelion.
    integrator: 'rkf45',
    timestep,
    duration,
    outputInterval: Math.max(600, Math.round(duration / 4000)),
    relTol: 1e-10,
    absTolPosition: 1e3,
    absTolVelocity: 1e-4,
    // A floor at 5 solar radii. Below that the model has no business being
    // believed: the corona is dense, the thermal environment would destroy
    // any real sail, and this model has neither.
    minAltitude: 4 * R_SUN,
  };
}

/** A heliocentric scenario departing from the Earth. */
function heliocentric(opts: {
  id: string;
  name: string;
  epoch: string;
  durationDays: number;
  attitude: AttitudeConfig;
  target?: PlanetId;
  vInfinity?: number;
  leadDistance?: number;
  sailArea?: number;
  dryMass?: number;
}): SimulationConfig {
  const dep = heliocentricDeparture(opts.epoch, {
    vInfinity: opts.vInfinity,
    leadDistance: opts.leadDistance,
  });

  return {
    version: 1,
    name: opts.name,
    scenarioId: opts.id,
    epoch: opts.epoch,
    centralBody: 'sun',
    moonModel: 'series',
    atmosphereActivity: 'mean',
    perturbingPlanets: [...INNER_SYSTEM_PLANETS],
    targetBody: opts.target,
    initial: { mode: 'cartesian', position: dep.r, velocity: dep.v },
    spacecraft: { ...DEFAULT_SPACECRAFT, dryMass: opts.dryMass ?? DEFAULT_SPACECRAFT.dryMass },
    sail: { ...DEFAULT_SAIL, area: opts.sailArea ?? DEFAULT_SAIL.area },
    attitude: opts.attitude,
    forces: { ...HELIOCENTRIC_FORCES },
    integration: heliocentricIntegration(opts.durationDays),
  };
}

/**
 * Rough time of flight for a Hohmann transfer between two circular orbits
 * [s]. Used only to size scenario durations, never presented as a result.
 */
function hohmannTimeOfFlight(r0: number, r1: number): number {
  const a = (r0 + r1) / 2;
  return Math.PI * Math.sqrt(a ** 3 / MU_SUN);
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const SCENARIOS: Scenario[] = [
  // --- Earth -----------------------------------------------------------
  {
    id: 'leo-circular',
    group: 'earth',
    name: 'Circular LEO',
    description: '500 km circular orbit at 51.6 deg inclination.',
    note: 'The default scenario. Solar-sail acceleration here is small compared with J2 and is interrupted by eclipse for roughly a third of every revolution.',
    build: (epoch) =>
      earthOrbit({
        id: 'leo-circular',
        name: 'Circular LEO 500 km',
        epoch,
        altitudeKm: 500,
        durationDays: 7,
      }),
  },
  {
    id: 'leo-400',
    group: 'earth',
    name: 'LEO 400 km',
    description: '400 km circular, 51.6 deg.',
    note: 'Below roughly 400 km atmospheric drag exceeds the sail force by orders of magnitude, and drag is not modelled. Treat results here as illustrative only.',
    build: (epoch) =>
      earthOrbit({ id: 'leo-400', name: 'LEO 400 km', epoch, altitudeKm: 400, durationDays: 7 }),
  },
  {
    id: 'leo-800',
    group: 'earth',
    name: 'LEO 800 km',
    description: '800 km circular, 98.6 deg (near sun-synchronous).',
    build: (epoch) =>
      earthOrbit({
        id: 'leo-800',
        name: 'LEO 800 km',
        epoch,
        altitudeKm: 800,
        incDeg: 98.6,
        durationDays: 14,
      }),
  },
  {
    id: 'leo-1000',
    group: 'earth',
    name: 'LEO 1000 km',
    description: '1000 km circular, 51.6 deg.',
    build: (epoch) =>
      earthOrbit({
        id: 'leo-1000',
        name: 'LEO 1000 km',
        epoch,
        altitudeKm: 1000,
        durationDays: 14,
      }),
  },
  {
    id: 'leo-sso-dawn-dusk',
    group: 'earth',
    name: 'Sun-synchronous dawn-dusk',
    description: '700 km, 98.2 deg, RAAN chosen for a high beta angle.',
    note: 'A dawn-dusk sun-synchronous orbit keeps the Sun near the orbit plane normal, so the spacecraft is almost never eclipsed. Compare this against the same sail in the default LEO to see how much eclipse costs.',
    build: (epoch) =>
      earthOrbit({
        id: 'leo-sso-dawn-dusk',
        name: 'SSO dawn-dusk 700 km',
        epoch,
        altitudeKm: 700,
        incDeg: 98.2,
        raanDeg: 90,
        durationDays: 14,
      }),
  },
  {
    id: 'earth-elliptical',
    group: 'earth',
    name: 'Elliptical Earth orbit',
    description: '500 km perigee, e = 0.3, 28.5 deg.',
    build: (epoch) =>
      earthOrbit({
        id: 'earth-elliptical',
        name: 'Elliptical Earth orbit',
        epoch,
        altitudeKm: 500,
        ecc: 0.3,
        incDeg: 28.5,
        durationDays: 14,
      }),
  },
  {
    id: 'meo',
    group: 'earth',
    name: 'MEO',
    description: '20,200 km circular, 55 deg (GNSS-like).',
    build: (epoch) =>
      earthOrbit({
        id: 'meo',
        name: 'MEO 20,200 km',
        epoch,
        altitudeKm: 20200,
        incDeg: 55,
        durationDays: 30,
        forces: { ...HIGH_EARTH_FORCES },
      }),
  },
  {
    id: 'geo',
    group: 'earth',
    name: 'GEO',
    description: '35,786 km circular, 0 deg.',
    note: 'At GEO the sail acceleration is a much larger fraction of the local gravity than in LEO, eclipses are short and rare, and lunisolar third-body gravity matters - so both are enabled here.',
    build: (epoch) =>
      earthOrbit({
        id: 'geo',
        name: 'GEO',
        epoch,
        altitudeKm: 35786,
        incDeg: 0.05,
        durationDays: 30,
        forces: { ...HIGH_EARTH_FORCES },
      }),
  },
  {
    id: 'heo-molniya',
    group: 'earth',
    name: 'Highly elliptical (Molniya-like)',
    description: '500 km perigee, e = 0.74, 63.4 deg.',
    note: 'Apogee spends a long time at high altitude where the sail is most effective and drag-free. Use the adaptive integrator: a fixed step cannot serve both perigee and apogee.',
    build: (epoch) => {
      const cfg = earthOrbit({
        id: 'heo-molniya',
        name: 'Molniya-like HEO',
        epoch,
        altitudeKm: 500,
        ecc: 0.74,
        incDeg: 63.4,
        argpDeg: 270,
        durationDays: 30,
        forces: { ...HIGH_EARTH_FORCES },
      });
      cfg.integration.integrator = 'rkf45';
      cfg.integration.timestep = 60;
      // Perigee is at 500 km, so this orbit passes through the atmosphere
      // twice a revolution even though it spends most of its time far above
      // it. HIGH_EARTH_FORCES switches drag off for the high orbits it is
      // named for; this one needs it back.
      cfg.forces.atmosphericDrag = true;
      cfg.forces.earthAlbedo = true;
      cfg.forces.earthInfrared = true;
      return cfg;
    },
  },
  {
    id: 'earth-custom',
    group: 'earth',
    name: 'Custom Earth orbit',
    description: 'Set every element yourself.',
    build: (epoch) =>
      earthOrbit({
        id: 'earth-custom',
        name: 'Custom Earth orbit',
        epoch,
        altitudeKm: 1000,
        ecc: 0.1,
        incDeg: 45,
        durationDays: 14,
      }),
  },
  {
    id: 'earth-escape',
    group: 'earth',
    name: 'Earth escape experiment',
    description: 'High orbit, sail steered to maximise orbital energy.',
    note: 'Investigates whether sustained solar sailing can raise orbital energy to escape. Starts high, where the sail acceleration is a meaningful fraction of local gravity.',
    build: (epoch) => {
      const cfg = earthOrbit({
        id: 'earth-escape',
        name: 'Earth escape experiment',
        epoch,
        altitudeKm: 30000,
        ecc: 0.2,
        incDeg: 10,
        durationDays: 180,
        forces: { ...HIGH_EARTH_FORCES },
        attitude: { kind: 'optimalDirection', direction: 'prograde' },
      });
      cfg.integration.integrator = 'rkf45';
      cfg.integration.timestep = 300;
      cfg.spacecraft = { ...cfg.spacecraft, dryMass: 50, propellantMass: 0 };
      cfg.sail = { ...DEFAULT_SAIL, area: 1000 };
      return cfg;
    },
  },

  // --- Lunar -----------------------------------------------------------
  {
    id: 'lunar-transfer',
    group: 'lunar',
    name: 'Earth to Moon transfer',
    description: 'Ballistic departure ellipse aimed at the Moon, with sail steering.',
    note: 'The departure ellipse is aimed with a geometric heuristic, not an optimiser. The question this scenario answers is whether the sail measurably shifts the lunar encounter, not whether the transfer is optimal.',
    build: (epoch) => lunarTransfer(epoch),
  },
  {
    id: 'lunar-approach',
    group: 'lunar',
    name: 'Lunar approach',
    description: 'Starts near the lunar sphere of influence, Moon-centred.',
    note: 'Moon-centred integration with Earth and Sun as third bodies. Useful for looking at approach geometry and relative velocity.',
    build: (epoch) => {
      const epochJd = isoToJd(epoch);
      const moon = moonState(epochJd, 'series');
      // Start 50,000 km from the Moon, inside the SOI, moving inward at
      // roughly the typical arrival relative speed.
      const inward = unit(scale(moon.position, -1)); // toward the Earth
      const r0 = scale(inward, 5.0e7);
      const alongMoon = unit(moon.velocity);
      const v0: Vec3 = [
        -inward[0] * 400 + alongMoon[0] * 200,
        -inward[1] * 400 + alongMoon[1] * 200,
        -inward[2] * 400 + alongMoon[2] * 200,
      ];
      return {
        version: 1,
        name: 'Lunar approach',
        scenarioId: 'lunar-approach',
        epoch,
        centralBody: 'moon',
        moonModel: 'series',
        atmosphereActivity: 'mean',
        perturbingPlanets: [],
        initial: { mode: 'cartesian', position: r0, velocity: v0 },
        spacecraft: { ...DEFAULT_SPACECRAFT },
        sail: { ...DEFAULT_SAIL },
        attitude: { kind: 'sunRelative', cone: 0, clock: 0 },
        forces: { ...LUNAR_FORCES },
        integration: {
          integrator: 'rkf45',
          timestep: 60,
          duration: 5 * SEC_PER_DAY,
          outputInterval: 120,
          relTol: 1e-10,
          absTolPosition: 1e-2,
          absTolVelocity: 1e-5,
          minAltitude: 20e3,
        },
      };
    },
  },
  {
    id: 'lunar-orbit',
    group: 'lunar',
    name: 'Lunar orbit',
    description: '100 km circular orbit about the Moon.',
    note: 'Moon-centred. The Earth tide is a large perturbation at this distance, so it is enabled by default. The Moon has no J2 term in this model.',
    build: (epoch) => lunarOrbit(epoch, 100, 0, 20),
  },
  {
    id: 'lunar-custom',
    group: 'lunar',
    name: 'Custom lunar orbit',
    description: 'Set the lunar orbit elements yourself.',
    build: (epoch) => lunarOrbit(epoch, 500, 0.2, 60),
  },

  // --- Interplanetary --------------------------------------------------
  {
    id: 'helio-mars',
    group: 'interplanetary',
    name: 'Earth to Mars orbit',
    description: 'Heliocentric spiral outward from Earth, sail steered prograde.',
    note: 'Departs on the Earth\'s own heliocentric orbit with zero excess velocity, so every metre of the transfer is the sail: no departure hyperbola, no launch vehicle, no launch-window search. It reaches the ORBITAL RADIUS of Mars and comes nowhere near the planet, because nothing has phased the departure - and that gap between "reached the orbit" and "reached the planet" is what launch windows exist to close. The Results panel reports both, and the synodic period tells you how often the opportunity comes round.',
    build: (epoch) =>
      heliocentric({
        id: 'helio-mars',
        name: 'Earth to Mars',
        epoch,
        durationDays: 700,
        target: 'mars',
        attitude: { kind: 'optimalDirection', direction: 'prograde' },
        // 100 m^2/kg: the "high-performance sail" of the interplanetary
        // literature, and about 15x anything yet flown. A 1 m^2/kg sail does
        // not reach Mars in any useful time, which is itself the point - the
        // Sensitivity panel sweeps this directly.
        sailArea: 10000,
        dryMass: 100,
      }),
  },
  {
    id: 'helio-venus',
    group: 'interplanetary',
    name: 'Earth to Venus orbit',
    description: 'Heliocentric spiral inward, sail steered retrograde.',
    note: 'Spiralling INWARD needs the sail to push retrograde, removing orbital energy - which a sail does perfectly well, because the force directions it can reach span a cone about the anti-Sun line rather than just the outward radial. The 1/r^2 growth in pressure means an inward spiral accelerates as it goes, and NOTHING HERE STOPS IT: no arrival is modelled, so the sail keeps thrusting and the trajectory continues past Venus. Read the closest-approach figure, not the end point.',
    build: (epoch) =>
      heliocentric({
        id: 'helio-venus',
        name: 'Earth to Venus',
        epoch,
        durationDays: 300,
        target: 'venus',
        attitude: { kind: 'optimalDirection', direction: 'retrograde' },
        sailArea: 10000,
        dryMass: 100,
      }),
  },
  {
    id: 'helio-escape',
    group: 'interplanetary',
    name: 'Solar escape',
    description: 'Sustained prograde sailing to hyperbolic solar escape.',
    note: 'The classic solar-sail argument: a sail needs no propellant, so it can keep accelerating for as long as there is sunlight. Watch the specific orbital energy cross zero. The lightness number here is 0.50, which is the analytic threshold at which a Sun-facing sail on a circular orbit is already at escape speed in the reduced effective gravity mu(1 - beta) - and it demands an areal density near 3 g/m^2, several times better than anything built. Halve beta and the escape stops happening at all rather than merely taking longer: the sail force falls off as 1/r^2 exactly like solar gravity, so the ratio between them never improves.',
    build: (epoch) =>
      heliocentric({
        id: 'helio-escape',
        name: 'Solar escape',
        epoch,
        durationDays: 2500,
        attitude: { kind: 'optimalDirection', direction: 'prograde' },
        // 360 m^2/kg gives beta = 0.50, the analytic escape threshold.
        sailArea: 36000,
        dryMass: 100,
      }),
  },
  {
    id: 'helio-solar-pass',
    group: 'interplanetary',
    name: 'Close solar pass',
    description: 'Fall inward to a close perihelion, where 1/r^2 makes the sail enormous.',
    note: 'A solar sail gains 1/r^2 in pressure as it falls inward, so at 0.2 AU it has 25x the acceleration it had at Earth. Falling in first and then sailing outward is the sail analogue of an Oberth manoeuvre. Nothing here models the thermal problem, which is the real obstacle: no sail material yet made survives this environment. The run stops at 5 solar radii.',
    build: (epoch) => {
      const cfg = heliocentric({
        id: 'helio-solar-pass',
        name: 'Close solar pass',
        epoch,
        durationDays: 500,
        // Locally optimal prograde. On the way in this costs a little energy;
        // at perihelion, where the pressure is 200x its value at 1 AU, it
        // returns it many times over. That asymmetry is the whole point.
        attitude: { kind: 'optimalDirection', direction: 'prograde' },
        sailArea: 10000,
        dryMass: 100,
      });
      // Kill most of the Earth's orbital velocity so the trajectory falls
      // sunward rather than cruising at 1 AU. This is a large impulse that no
      // sail supplies instantly - it is a starting condition, not a
      // manoeuvre, and the scenario note says so.
      const dep = heliocentricDeparture(epoch);
      cfg.initial = {
        mode: 'cartesian',
        position: dep.r,
        velocity: scale(dep.v, 0.35),
      };
      return cfg;
    },
  },
  {
    id: 'helio-cruise',
    group: 'interplanetary',
    name: 'Heliocentric cruise (no sail)',
    description: "The Earth's own orbit, with the sail feathered - the baseline.",
    note: 'Nothing but solar gravity: every third body and the sail itself are switched off. Run this first. It is the trajectory every other heliocentric scenario is measured against, and it holds the semi-major axis to 3e-14 relative over a year - so anything a later run shows is the sail or a perturbation, not the integrator.',
    build: (epoch) => {
      const cfg = heliocentric({
        id: 'helio-cruise',
        name: 'Heliocentric cruise',
        epoch,
        durationDays: 365,
        // Edge-on: zero projected area, hence zero sail force.
        attitude: { kind: 'sunRelative', cone: 90 * DEG, clock: 0 },
      });
      cfg.forces.planetGravity = false;
      cfg.perturbingPlanets = [];
      return cfg;
    },
  },
  {
    id: 'helio-custom',
    group: 'interplanetary',
    name: 'Custom heliocentric orbit',
    description: 'Set the heliocentric elements yourself.',
    note: 'Periapsis is entered in AU rather than as an altitude above the solar photosphere, because nobody thinks in the latter.',
    build: (epoch) => {
      const cfg = heliocentric({
        id: 'helio-custom',
        name: 'Custom heliocentric orbit',
        epoch,
        durationDays: 730,
        attitude: { kind: 'sunRelative', cone: 35 * DEG, clock: 0 },
        sailArea: 2000,
      });
      // Elements rather than the departure state, so every field is editable.
      cfg.initial = {
        mode: 'elements',
        altitude: AU - R_SUN, // periapsis at 1 AU
        eccentricity: 0.1,
        inclination: 0,
        raan: 0,
        argumentOfPeriapsis: 0,
        trueAnomaly: 0,
      };
      return cfg;
    },
  },
];

/**
 * Rough transfer facts for the interplanetary readouts.
 *
 * Hohmann figures for a CHEMICAL transfer, quoted purely as the yardstick a
 * sail result should be read against. A sail does not fly a Hohmann transfer;
 * it spirals, and it takes longer and needs no propellant.
 */
export function transferReference(target: PlanetId): {
  hohmannDays: number;
  synodicDays: number;
  targetSma: number;
} {
  const earthSma = AU;
  const targetSma = planetState(target, 2451545.0).distance;
  return {
    hohmannDays: hohmannTimeOfFlight(earthSma, targetSma) / SEC_PER_DAY,
    synodicDays: synodicPeriod('earth', target) / SEC_PER_DAY,
    targetSma,
  };
}

/** Sidereal period of a planet in days, for the UI. */
export const planetPeriodDays = (id: PlanetId): number => planetPeriod(id) / SEC_PER_DAY;

function lunarOrbit(
  epoch: string,
  altitudeKm: number,
  ecc: number,
  durationDays: number,
): SimulationConfig {
  const rp = R_MOON + altitudeKm * 1000;
  const sma = rp / (1 - ecc);
  const period = 2 * Math.PI * Math.sqrt(sma ** 3 / 4.9048695e12);
  return {
    version: 1,
    name: `Lunar orbit ${altitudeKm} km`,
    scenarioId: 'lunar-orbit',
    epoch,
    centralBody: 'moon',
    moonModel: 'series',
    atmosphereActivity: 'mean',
    perturbingPlanets: [],
    initial: {
      mode: 'elements',
      altitude: altitudeKm * 1000,
      eccentricity: ecc,
      inclination: 90 * DEG,
      raan: 0,
      argumentOfPeriapsis: 0,
      trueAnomaly: 0,
    },
    spacecraft: { ...DEFAULT_SPACECRAFT },
    sail: { ...DEFAULT_SAIL },
    attitude: { kind: 'sunRelative', cone: 0, clock: 0 },
    forces: { ...LUNAR_FORCES },
    // The Moon has no atmosphere, so the only meaningful floor is the surface.
    // 10 km leaves room for the Earth-tide perturbation of a low lunar orbit
    // without terminating the run spuriously.
    integration: integrationFor(period, durationDays, ecc, 10e3),
  };
}

export const SCENARIOS_BY_ID = new Map(SCENARIOS.map((s) => [s.id, s]));

/** Build the configuration for a scenario id, falling back to the default. */
export function buildScenario(id: string, epoch = DEFAULT_EPOCH): SimulationConfig {
  const scenario = SCENARIOS_BY_ID.get(id);
  if (!scenario?.build) return defaultConfig(epoch);
  return scenario.build(epoch);
}

/**
 * The configuration the application opens with (spec S34): 500 km circular
 * LEO, 100 kg, 100 m^2, orbit-fraction attitude control, 7 days.
 */
export function defaultConfig(epoch = DEFAULT_EPOCH): SimulationConfig {
  return buildScenario('leo-circular', epoch) ?? ({} as SimulationConfig);
}
