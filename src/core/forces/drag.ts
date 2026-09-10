/**
 * Atmospheric drag on a sail-carrying spacecraft.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TERM IS INTERESTING RATHER THAN MERELY NECESSARY
 * ---------------------------------------------------------------------------
 * For a conventional satellite drag is a nuisance parameter: a fixed
 * ballistic coefficient times a density. For a SAIL it is coupled to the
 * control variable, because the sail is the drag area. The same cos(alpha)
 * projection that sets how much sunlight the sail catches sets how much
 * atmosphere it catches - except that the two projections are taken against
 * DIFFERENT directions: the Sun line for SRP, the relative wind for drag.
 *
 * A sail edge-on to the wind has almost no drag; the same sail turned
 * broadside has the full area. That is the whole basis of a deorbit sail, and
 * it is also why a naive "feather through the retrograde half" schedule can
 * behave completely differently once drag is switched on: the feathered
 * attitude is chosen for the Sun line and may be broadside to the wind.
 *
 * ---------------------------------------------------------------------------
 * MODEL
 * ---------------------------------------------------------------------------
 *   v_rel = v - omega_E x r          (co-rotating atmosphere)
 *   A_d   = A_bus + A_sail |v_hat_rel . n|
 *   a     = -(1/2) rho C_D (A_d / m) |v_rel| v_rel
 *
 * The atmosphere is assumed to co-rotate rigidly with the Earth. That is good
 * to a few percent: real thermospheric winds run to ~100 m/s against a
 * co-rotation speed of ~400 m/s at the equator at 400 km, and neither is
 * modelled here beyond the rigid term.
 *
 * C_D is a single free-molecular value applied to the PROJECTED area. 2.2 is
 * the conventional figure for a satellite in the upper atmosphere and is the
 * default. A flat plate in free-molecular flow also develops a LIFT component
 * perpendicular to the wind, which is not modelled: at the near-broadside
 * attitudes where drag actually matters the lift-to-drag ratio is small, and
 * including it properly needs an accommodation-coefficient model the rest of
 * this tool does not have.
 *
 * Drag is an EARTH term here. The Moon has no atmosphere, and the force model
 * only applies this when the integration centre is the Earth.
 */

import { EARTH_ROTATION_RATE, R_EARTH } from '../constants.ts';
import { type Vec3, ZERO, dot, norm, unit } from '../vec3.ts';
import {
  type AtmosphereActivity,
  atmosphericDensity,
} from '../environment/atmosphere.ts';

export interface DragResult {
  /** Acceleration in the inertial frame [m/s^2]. */
  acceleration: Vec3;
  /** Atmospheric density used [kg/m^3]. */
  density: number;
  /** Speed relative to the co-rotating atmosphere [m/s]. */
  relativeSpeed: number;
  /** Effective drag area, including the sail projection [m^2]. */
  dragArea: number;
  /**
   * |cos| of the angle between the relative wind and the sail normal.
   * 1 = broadside (maximum drag), 0 = edge-on (sail contributes nothing).
   */
  cosWind: number;
  /** Geometric altitude used for the density lookup [m]. */
  altitude: number;
}

const NO_DRAG = (altitude: number, relativeSpeed: number, dragArea: number): DragResult => ({
  acceleration: ZERO,
  density: 0,
  relativeSpeed,
  dragArea,
  cosWind: 0,
  altitude,
});

export interface DragInput {
  /** Sail area [m^2]. */
  sailArea: number;
  /** Sail normal unit vector from the attitude controller. */
  sailNormal: Vec3;
  /** Constant cross-section of the spacecraft bus [m^2]. */
  busArea: number;
  /** Free-molecular drag coefficient [-]. */
  dragCoefficient: number;
  /** Total spacecraft mass [kg]. */
  mass: number;
  /** Solar-activity assumption for the density model. */
  activity: AtmosphereActivity;
}

/**
 * Atmospheric drag acceleration in the Earth-centred inertial frame.
 *
 * @param r  position in ECI [m]
 * @param v  inertial velocity in ECI [m/s]
 */
export function atmosphericDrag(inp: DragInput, r: Vec3, v: Vec3): DragResult {
  const rMag = norm(r);
  const altitude = rMag - R_EARTH;

  // Velocity relative to the rigidly co-rotating atmosphere.
  // omega = [0, 0, w] so omega x r = [-w*y, w*x, 0].
  const w = EARTH_ROTATION_RATE;
  const vRel: Vec3 = [v[0] + w * r[1], v[1] - w * r[0], v[2]];
  const vRelMag = norm(vRel);

  const density = atmosphericDensity(altitude, inp.activity);
  if (density <= 0 || vRelMag <= 0 || inp.mass <= 0) {
    return NO_DRAG(altitude, vRelMag, inp.busArea);
  }

  // Projected sail area against the relative wind. |cos| rather than cos:
  // a sheet presents the same cross-section whichever face is upwind.
  const n = unit(inp.sailNormal);
  const cosWind = norm(n) > 0 ? Math.abs(dot(unit(vRel), n)) : 0;
  const dragArea = inp.busArea + inp.sailArea * cosWind;

  // a = -(1/2) rho Cd (A/m) |v_rel| v_rel
  const k = (-0.5 * density * inp.dragCoefficient * dragArea * vRelMag) / inp.mass;

  return {
    acceleration: [vRel[0] * k, vRel[1] * k, vRel[2] * k],
    density,
    relativeSpeed: vRelMag,
    dragArea,
    cosWind,
    altitude,
  };
}

/**
 * Ballistic coefficient m / (C_D A) [kg/m^2] for the given drag area.
 *
 * Quoted in the UI because it is the single number that decides how fast an
 * orbit decays, and because it makes the sail coupling legible: the same
 * spacecraft has a ballistic coefficient two orders of magnitude apart
 * between edge-on and broadside.
 */
export const ballisticCoefficient = (
  mass: number,
  dragCoefficient: number,
  dragArea: number,
): number => (dragCoefficient * dragArea > 0 ? mass / (dragCoefficient * dragArea) : Infinity);
