/**
 * Simulation configuration and result types.
 *
 * `SimulationConfig` is the complete, self-contained description of a run and
 * is exactly what the Save/Load Configuration buttons serialise to JSON.
 */

import type { Vec3 } from '../core/vec3.ts';
import type { CentralBody } from '../core/environment/environment.ts';
import type { AtmosphereActivity } from '../core/environment/atmosphere.ts';
import type { PlanetId } from '../core/environment/planets.ts';
import type { MoonModel } from '../core/environment/moon.ts';
import type { ForceToggles } from '../core/forces/forceModel.ts';
import type { SailConfig, SpacecraftConfig } from '../core/sail/sail.ts';
import type { AttitudeConfig } from '../core/attitude/types.ts';
import type { IntegratorKind } from '../core/integrator/integrators.ts';

/** Initial state, given either as elements or as a raw Cartesian state. */
export interface InitialElements {
  mode: 'elements';
  /** Periapsis ALTITUDE above the central body reference radius [m]. */
  altitude: number;
  eccentricity: number;
  /** Inclination [rad]. */
  inclination: number;
  /** RAAN [rad]. */
  raan: number;
  /** Argument of periapsis [rad]. */
  argumentOfPeriapsis: number;
  /** True anomaly [rad]. */
  trueAnomaly: number;
}

export interface InitialCartesian {
  mode: 'cartesian';
  /** Position in the integration frame [m]. */
  position: Vec3;
  /** Velocity in the integration frame [m/s]. */
  velocity: Vec3;
}

export type InitialState = InitialElements | InitialCartesian;

export interface IntegrationConfig {
  integrator: IntegratorKind;
  /** Fixed timestep for RK4, and the initial step for the adaptive scheme [s]. */
  timestep: number;
  /** Total propagation duration [s]. */
  duration: number;
  /** Interval between recorded samples [s]. Independent of the timestep. */
  outputInterval: number;
  /** Relative tolerance for the adaptive integrator. */
  relTol: number;
  /** Absolute position tolerance for the adaptive integrator [m]. */
  absTolPosition: number;
  /** Absolute velocity tolerance for the adaptive integrator [m/s]. */
  absTolVelocity: number;
  /** Stop when the altitude drops below this value [m]. */
  minAltitude: number;
}

export interface SimulationConfig {
  /** Schema version, so old saved files can be migrated. */
  version: 1;
  /** Free-text name shown in the UI. */
  name: string;
  /** Scenario identifier this config was built from. */
  scenarioId: string;
  /** Mission epoch as an ISO 8601 UTC string. */
  epoch: string;
  /** Integration centre. */
  centralBody: CentralBody;
  /** Lunar ephemeris fidelity. */
  moonModel: MoonModel;
  /** Solar-activity assumption for the atmospheric density model. */
  atmosphereActivity: AtmosphereActivity;
  /**
   * Planets included as perturbing third bodies when `forces.planetGravity`
   * is on. Only meaningful heliocentrically.
   */
  perturbingPlanets: PlanetId[];
  /**
   * Planet whose closest approach the run should track, if any.
   *
   * This is the interplanetary analogue of the lunar closest-approach
   * machinery, and it is deliberately the ONLY targeting concept in the tool:
   * it measures where the trajectory actually went, and makes no attempt to
   * aim it. Departure hyperbolas, B-plane targeting and launch-window search
   * belong with the trajectory optimiser (see docs/future-work.md).
   */
  targetBody?: PlanetId;
  initial: InitialState;
  spacecraft: SpacecraftConfig;
  sail: SailConfig;
  attitude: AttitudeConfig;
  forces: ForceToggles;
  integration: IntegrationConfig;
}

/**
 * One recorded trajectory sample.
 *
 * Flat scalars rather than nested objects: this is what the plotting code and
 * the CSV exporter both want, and it keeps a 20,000-sample run around 6 MB.
 */
export interface TrajectorySample {
  /** Mission elapsed time [s]. */
  t: number;
  /** Absolute Julian date. */
  jd: number;

  // Cartesian state in the integration frame
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Speed [m/s]. */
  speed: number;
  /** Radius from the central body [m]. */
  radius: number;
  /** Altitude above the central body reference radius [m]. */
  altitude: number;

  // Osculating elements
  sma: number;
  ecc: number;
  /** Inclination [rad]. */
  inc: number;
  /** RAAN [rad]. */
  raan: number;
  /** Argument of periapsis [rad]. */
  argp: number;
  /** True anomaly [rad]. */
  trueAnomaly: number;
  /** Argument of latitude [rad]. */
  argLat: number;
  /** Periapsis radius [m]. */
  periapsis: number;
  /** Apoapsis radius [m]. */
  apoapsis: number;
  /** Orbital period [s]. */
  period: number;
  /** Specific orbital energy [J/kg]. */
  energy: number;
  /** Specific angular momentum [m^2/s]. */
  angularMomentum: number;

  // Sail
  /** Sail normal unit vector in the integration frame. */
  nx: number;
  ny: number;
  nz: number;
  /** SRP acceleration in the integration frame [m/s^2]. */
  ax: number;
  ay: number;
  az: number;
  /** SRP acceleration magnitude [m/s^2]. */
  sailAccel: number;
  /** SRP acceleration resolved in the RSW frame [m/s^2]. */
  sailAccelR: number;
  sailAccelS: number;
  sailAccelW: number;
  /** Radiation pressure at the spacecraft [N/m^2]. */
  pressure: number;
  /** Sun incidence angle on the sail [rad]. */
  incidence: number;
  /** First commanded steering angle [rad]. */
  steer1: number;
  /** Second commanded steering angle [rad]. */
  steer2: number;
  /** Illumination fraction, 0..1. */
  illumination: number;

  // Drag
  /** Atmospheric drag acceleration magnitude [m/s^2]. */
  dragAccel: number;
  /** Atmospheric mass density at the spacecraft [kg/m^3]. */
  airDensity: number;
  /** Effective drag area including the sail projection [m^2]. */
  dragArea: number;

  // Earth radiation
  /** Albedo + infrared acceleration magnitude [m/s^2]. */
  earthRadiationAccel: number;

  // Geometry
  /** Distance to the Earth centre [m]. */
  earthDistance: number;
  /** Distance to the Moon centre [m]. */
  moonDistance: number;
  /** Distance to the Sun [m]. */
  sunDistance: number;
  /** Distance to the configured target planet [m]. Infinity when none is set. */
  targetDistance: number;
  /** Sun elevation above the orbit plane (beta angle) [rad]. */
  betaAngle: number;

  // Accumulated
  /**
   * Integral of |a_srp| dt [m/s].
   *
   * This is an IMPULSE BUDGET, not a manoeuvre delta-v: it counts the whole
   * acceleration magnitude regardless of direction, so it is an upper bound on
   * what the sail could have achieved. The realised orbital change is what the
   * elements above show.
   */
  deltaVEquivalent: number;
  /**
   * Integral of |a_drag| dt [m/s] - the impulse the atmosphere has taken out.
   *
   * Directly comparable with `deltaVEquivalent`: if this is the larger
   * number, the atmosphere is winning and no steering law will change that.
   */
  dragDeltaVEquivalent: number;
}

export type SimEventKind =
  | 'impact'
  | 'escape'
  | 'minAltitude'
  | 'lunarSoiEntry'
  | 'lunarSoiExit'
  | 'lunarClosestApproach'
  | 'targetClosestApproach'
  | 'targetSoiEntry'
  | 'numericalFailure'
  | 'maxSamples'
  | 'dragDominant';

export interface SimEvent {
  kind: SimEventKind;
  /** Mission elapsed time [s]. */
  t: number;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

/** Why the propagation stopped. */
export type TerminationReason =
  | 'completed'
  | 'impact'
  | 'escape'
  | 'numericalFailure'
  | 'maxSamples'
  | 'cancelled';

export interface SimulationSummary {
  /** Reason propagation ended. */
  termination: TerminationReason;
  /** Mission elapsed time at the final sample [s]. */
  finalTime: number;
  /** Number of integration steps taken. */
  steps: number;
  /** Number of acceleration evaluations. */
  evaluations: number;
  /** Wall-clock propagation time [ms]. */
  wallClockMs: number;
  /** Rejected steps (adaptive integrator only). */
  rejectedSteps: number;
  /** Smallest step actually used [s]. */
  minStep: number;
  /** Largest step actually used [s]. */
  maxStep: number;

  /** Initial and final osculating elements. */
  initialSma: number;
  finalSma: number;
  initialEcc: number;
  finalEcc: number;
  initialInc: number;
  finalInc: number;
  initialPeriapsis: number;
  finalPeriapsis: number;
  initialApoapsis: number;
  finalApoapsis: number;
  initialEnergy: number;
  finalEnergy: number;

  /** Extremes over the run. */
  minAltitude: number;
  maxAltitude: number;
  minMoonDistance: number;
  /** Time of closest lunar approach [s]. */
  minMoonDistanceTime: number;
  /** Spacecraft speed relative to the Moon at closest approach [m/s]. */
  moonRelativeSpeedAtClosest: number;

  /** Closest approach to the configured target planet [m]. Infinity if none. */
  minTargetDistance: number;
  /** Time of that closest approach [s]. */
  minTargetDistanceTime: number;
  /** Whether the trajectory entered the target planet's sphere of influence. */
  enteredTargetSoi: boolean;
  /** Minimum heliocentric radius reached [m]. */
  minSolarDistance: number;
  /** Maximum heliocentric radius reached [m]. */
  maxSolarDistance: number;

  /** Total impulse budget accumulated [m/s]. */
  deltaVEquivalent: number;
  /** Total drag impulse accumulated [m/s]. */
  dragDeltaVEquivalent: number;
  /** Mean sail acceleration magnitude over the run [m/s^2]. */
  meanSailAccel: number;
  /** Mean drag acceleration magnitude over the run [m/s^2]. */
  meanDragAccel: number;
  /** Highest atmospheric density encountered [kg/m^3]. */
  maxAirDensity: number;
  /** Fraction of the run spent in any degree of eclipse [-]. */
  eclipseFraction: number;
  /** Whether the final state is on an escape trajectory from the central body. */
  escaped: boolean;
  /** Whether the spacecraft ever entered the lunar sphere of influence. */
  enteredLunarSoi: boolean;
  /**
   * Whether the final state is a bound orbit about the MOON. This is the only
   * thing the simulator will call a lunar capture, and it is a bare energy
   * test - not a demonstration of a stable, long-lived orbit.
   */
  boundToMoonAtEnd: boolean;
}

export interface SimulationResult {
  config: SimulationConfig;
  samples: TrajectorySample[];
  events: SimEvent[];
  summary: SimulationSummary;
}
