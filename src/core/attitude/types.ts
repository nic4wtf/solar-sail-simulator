/**
 * Attitude rule (steering law) interface.
 *
 * An attitude rule is a pure function of the current dynamical state that
 * returns a commanded sail normal in the inertial integration frame. It must
 * be side-effect free and cheap, because it is evaluated at every stage of
 * every integration step.
 *
 * Adding a rule means:
 *   1. adding a variant to `AttitudeConfig`,
 *   2. adding a case to `evaluateAttitude` in rules.ts,
 *   3. adding a UI editor in ui/panels/AttitudePanel.tsx.
 * Nothing else in the simulator needs to change.
 */

import type { Vec3 } from '../vec3.ts';
import type { FrameKind } from '../orbital/frames.ts';
import type { OrbitalElements } from '../orbital/elements.ts';

/** Everything a steering law is allowed to see. */
export interface AttitudeInput {
  /** Mission elapsed time [s]. */
  t: number;
  /** Position in the inertial integration frame [m]. */
  r: Vec3;
  /** Velocity in the inertial integration frame [m/s]. */
  v: Vec3;
  /** Unit vector from the Sun to the spacecraft (photon direction). */
  sunToCraft: Vec3;
  /** Osculating elements of the current state. */
  elements: OrbitalElements;
  /** Gravitational parameter of the central body [m^3/s^2]. */
  mu: number;
}

export interface AttitudeOutput {
  /** Commanded sail normal, unit vector in the inertial frame. */
  normal: Vec3;
  /** Frame the rule worked in, for the UI readout. */
  frameName: string;
  /** The two steering angles actually applied [rad], for plotting. */
  angles: [number, number];
  /** Labels for those angles. */
  angleNames: [string, string];
  /** Set when the rule had to use a degenerate frame construction. */
  degenerate: boolean;
}

/** Orbital phase variable used by the orbit-fraction rule. */
export type PhaseVariable = 'trueAnomaly' | 'argLat' | 'meanAnomaly' | 'sunPhase';

export const PHASE_VARIABLE_LABELS: Record<PhaseVariable, string> = {
  trueAnomaly: 'True anomaly (phase from periapsis)',
  argLat: 'Argument of latitude (phase from ascending node)',
  meanAnomaly: 'Mean anomaly (uniform in time)',
  sunPhase: 'Sun phase (phase from the projected Sun direction)',
};

export const PHASE_VARIABLE_HELP: Record<PhaseVariable, string> = {
  trueAnomaly:
    'Measured from periapsis. The natural choice for changing eccentricity, but undefined for a perfectly circular orbit.',
  argLat:
    'Measured from the ascending node. Always well defined, including for circular orbits. Good default.',
  meanAnomaly:
    'Advances uniformly with time. Equal fractions correspond to equal time intervals rather than equal swept angle.',
  sunPhase:
    'Measured from the Sun direction projected into the orbit plane. This is the phase that actually governs solar-sail energy gain in an Earth orbit, because it tracks where the spacecraft is relative to the incoming sunlight rather than relative to the orbit itself.',
};

/** One knot of the orbit-fraction schedule. */
export interface OrbitFractionKnot {
  /** Orbital phase, 0..1. */
  fraction: number;
  /** First steering angle [rad]. */
  angle1: number;
  /** Second steering angle [rad]. */
  angle2: number;
}

/** Direction the locally-optimal rule should push toward. */
export type ThrustDirection =
  | 'prograde'
  | 'retrograde'
  | 'radialOut'
  | 'radialIn'
  | 'normal'
  | 'antiNormal';

export const THRUST_DIRECTION_LABELS: Record<ThrustDirection, string> = {
  prograde: 'Prograde (along velocity) - raises orbital energy',
  retrograde: 'Retrograde (against velocity) - lowers orbital energy',
  radialOut: 'Radial outward (away from central body)',
  radialIn: 'Radial inward (toward central body)',
  normal: 'Orbit normal (+h) - changes inclination',
  antiNormal: 'Anti orbit normal (-h) - changes inclination',
};

/** How the time-based rule varies its angle. */
export type TimeProfile = 'ramp' | 'triangle' | 'sine';

export const TIME_PROFILE_LABELS: Record<TimeProfile, string> = {
  ramp: 'Linear ramp, clamped at the limits',
  triangle: 'Linear ramp, reversing at the limits (triangle wave)',
  sine: 'Sinusoid between the limits',
};

export type AttitudeRuleKind =
  | 'fixed'
  | 'timeBased'
  | 'orbitFraction'
  | 'sunRelative'
  | 'optimalDirection'
  | 'expression';

export const ATTITUDE_RULE_LABELS: Record<AttitudeRuleKind, string> = {
  fixed: 'Fixed attitude',
  timeBased: 'Time-based attitude',
  orbitFraction: 'Orbit-fraction schedule',
  sunRelative: 'Sun-relative (cone / clock)',
  optimalDirection: 'Locally optimal thrust direction',
  expression: 'Custom equation',
};

export const ATTITUDE_RULE_SUMMARY: Record<AttitudeRuleKind, string> = {
  fixed: 'Constant sail orientation in a chosen reference frame.',
  timeBased: 'Steering angles vary with mission elapsed time.',
  orbitFraction:
    'Steering angles interpolated from a table indexed by orbital phase. The workhorse rule for changing a specific orbital element.',
  sunRelative:
    'Cone and clock angles measured from the Sun line. The natural parameterisation for solar sailing.',
  optimalDirection:
    'Instantaneously maximises the sail force component along a chosen direction, by solving tan(theta - alpha) = 2 tan(alpha).',
  expression:
    'User-supplied formulae for the two steering angles, evaluated against the current state.',
};

// ---------------------------------------------------------------------------
// Configuration variants
// ---------------------------------------------------------------------------

export interface FixedAttitudeConfig {
  kind: 'fixed';
  frame: FrameKind;
  /** First steering angle [rad]. */
  angle1: number;
  /** Second steering angle [rad]. */
  angle2: number;
}

export interface TimeBasedAttitudeConfig {
  kind: 'timeBased';
  frame: FrameKind;
  profile: TimeProfile;
  /** Angle at t = 0 [rad]. */
  initialAngle: number;
  /** Rate of change [rad/s]. */
  rate: number;
  /** Lower clamp [rad]. */
  minAngle: number;
  /** Upper clamp [rad]. */
  maxAngle: number;
  /** The second steering angle is held constant [rad]. */
  angle2: number;
}

export interface OrbitFractionAttitudeConfig {
  kind: 'orbitFraction';
  frame: FrameKind;
  phaseVariable: PhaseVariable;
  /** Schedule knots, sorted by fraction. Interpolated linearly and wrapped. */
  knots: OrbitFractionKnot[];
}

export interface SunRelativeAttitudeConfig {
  kind: 'sunRelative';
  /** Cone angle from the Sun line [rad]. */
  cone: number;
  /** Clock angle about the Sun line [rad]. */
  clock: number;
}

export interface OptimalDirectionAttitudeConfig {
  kind: 'optimalDirection';
  direction: ThrustDirection;
}

export interface ExpressionAttitudeConfig {
  kind: 'expression';
  frame: FrameKind;
  /** Expression for the first steering angle, in DEGREES. */
  angle1Expr: string;
  /** Expression for the second steering angle, in DEGREES. */
  angle2Expr: string;
}

export type AttitudeConfig =
  | FixedAttitudeConfig
  | TimeBasedAttitudeConfig
  | OrbitFractionAttitudeConfig
  | SunRelativeAttitudeConfig
  | OptimalDirectionAttitudeConfig
  | ExpressionAttitudeConfig;
