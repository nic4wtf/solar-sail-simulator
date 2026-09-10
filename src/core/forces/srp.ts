/**
 * Solar radiation pressure force on a flat sail.
 *
 * ---------------------------------------------------------------------------
 * MODEL
 * ---------------------------------------------------------------------------
 * Let
 *   u   = unit vector from the Sun to the spacecraft (photon travel direction)
 *   n   = sail normal, oriented so that cos(alpha) = u . n >= 0
 *   t   = unit vector in the sail plane, along the component of u
 *         perpendicular to n (the "downstream" transverse direction)
 *   P   = solar radiation pressure at the spacecraft [N/m^2]
 *   A   = sail area [m^2]
 *   alpha = incidence angle between u and n
 *
 * Accounting for each fate of an incident photon (specular reflection,
 * diffuse reflection with Lambertian re-emission, absorption with thermal
 * re-emission from both faces, and transmission) gives the classical
 * non-ideal flat-plate force of McInnes (1999), eq. 2.51, extended with a
 * transmission term:
 *
 *   F_n = P A cos(alpha) [ (1 + rho s - tau) cos(alpha)
 *                          + B_f rho (1 - s)
 *                          + a (eps_f B_f - eps_b B_b) / (eps_f + eps_b) ]
 *
 *   F_t = P A cos(alpha) sin(alpha) (1 - rho s - tau)
 *
 *   F   = F_n * n + F_t * t
 *
 * with a = 1 - rho - tau the absorptivity.
 *
 * Sanity check - a perfect specular reflector (rho = 1, s = 1, tau = 0):
 *   F_n = 2 P A cos^2(alpha),  F_t = 0,  so F = 2 P A cos^2(alpha) n.
 * At normal incidence this is the familiar F = 2 P A. The `srp.test.ts` suite
 * checks this reduction numerically.
 *
 * The alternative 'ideal' force model is simply
 *   F = 2 eta P A cos^2(alpha) n
 * with eta an overall efficiency, which is what much of the mission-analysis
 * literature uses for first-cut studies.
 *
 * ---------------------------------------------------------------------------
 * TWO-SIDED SAIL
 * ---------------------------------------------------------------------------
 * A sail is a physical sheet: the Sun illuminates whichever face is turned
 * toward it. If the commanded normal has u . n < 0 we therefore flip it, so
 * the force always pushes anti-sunward. V1 assumes both faces are optically
 * IDENTICAL, which is not true of a real sail with a bare back surface; the
 * `flipped` flag is reported so the condition is visible.
 */

import { type Vec3, ZERO, dot, norm, scale, sub, unit, clamp } from '../vec3.ts';
import {
  type SailConfig,
  absorptivity,
  pressureAt,
} from '../sail/sail.ts';

export interface SrpResult {
  /** Force vector in the inertial frame [N]. */
  force: Vec3;
  /** Acceleration vector in the inertial frame [m/s^2]. */
  acceleration: Vec3;
  /** Radiation pressure at the spacecraft [N/m^2]. */
  pressure: number;
  /** Incidence angle between the Sun line and the (effective) sail normal [rad]. */
  incidence: number;
  /** cos(incidence) [-]. */
  cosIncidence: number;
  /** Effective sail normal actually used (post flip) [-]. */
  normal: Vec3;
  /** Force component along the sail normal [N]. */
  normalForce: number;
  /** Force component in the sail plane [N]. */
  transverseForce: number;
  /** Illumination fraction applied (1 = full Sun, 0 = eclipse). */
  illumination: number;
  /** True when the commanded normal was flipped to face the Sun. */
  flipped: boolean;
  /** Heliocentric distance of the spacecraft [m]. */
  solarDistance: number;
}

const NO_FORCE = (
  pressure: number,
  normal: Vec3,
  solarDistance: number,
  illumination: number,
): SrpResult => ({
  force: ZERO,
  acceleration: ZERO,
  pressure,
  incidence: Math.PI / 2,
  cosIncidence: 0,
  normal,
  normalForce: 0,
  transverseForce: 0,
  illumination,
  flipped: false,
  solarDistance,
});

// ---------------------------------------------------------------------------
// The flat-plate law itself
// ---------------------------------------------------------------------------

/** Geometry and force of one flat plate in one radiation field. */
export interface FlatPlateResult {
  /** Force vector in the inertial frame [N]. */
  force: Vec3;
  /** Effective plate normal actually used (post flip). */
  normal: Vec3;
  /** Incidence angle between the radiation direction and the normal [rad]. */
  incidence: number;
  /** cos(incidence) [-]. */
  cosIncidence: number;
  /** Force component along the plate normal [N]. */
  normalForce: number;
  /** Force component in the plate plane [N]. */
  transverseForce: number;
  /** True when the commanded normal was flipped to face the source. */
  flipped: boolean;
}

const NO_PLATE_FORCE = (normal: Vec3): FlatPlateResult => ({
  force: ZERO,
  normal,
  incidence: Math.PI / 2,
  cosIncidence: 0,
  normalForce: 0,
  transverseForce: 0,
  flipped: false,
});

/**
 * Force on a flat plate of area `area` in a radiation field of pressure
 * `pressure` arriving along the unit vector `u`.
 *
 * Separated from {@link solarRadiationPressure} because the Earth-radiation
 * term (albedo and thermal infrared, see `albedo.ts`) is the SAME physics
 * with a different source: a different pressure, arriving from the nadir
 * direction instead of the Sun line. Sharing the law means the two terms
 * cannot drift apart, and means a change to the sail optical model applies to
 * both automatically.
 *
 * @param u unit vector along the direction the photons TRAVEL (source -> plate)
 */
export function flatPlateForce(
  sail: SailConfig,
  pressure: number,
  area: number,
  u: Vec3,
  commandedNormal: Vec3,
): FlatPlateResult {
  let n = unit(commandedNormal);
  if (pressure <= 0 || area <= 0 || norm(n) === 0) return NO_PLATE_FORCE(commandedNormal);

  // Two-sided sail: the illuminated face is the one turned toward the source.
  let flipped = false;
  let cosAlpha = dot(u, n);
  if (cosAlpha < 0) {
    n = scale(n, -1);
    cosAlpha = -cosAlpha;
    flipped = true;
  }
  cosAlpha = clamp(cosAlpha, 0, 1);

  // Edge-on: the projected area is zero, so there is no force at all.
  if (cosAlpha <= 1e-12) return { ...NO_PLATE_FORCE(n), flipped };

  const alpha = Math.acos(cosAlpha);
  const sinAlpha = Math.sin(alpha);

  // Transverse unit vector: component of u lying in the plate plane.
  const tVec = sub(u, scale(n, cosAlpha));
  const tNorm = norm(tVec);
  const t: Vec3 = tNorm > 1e-14 ? scale(tVec, 1 / tNorm) : ZERO;

  const PA = pressure * area;
  let normalForce: number;
  let transverseForce: number;

  if (sail.forceModel === 'ideal') {
    normalForce = 2 * sail.efficiency * PA * cosAlpha * cosAlpha;
    transverseForce = 0;
  } else {
    const rho = sail.reflectivity;
    const s = sail.specularFraction;
    const tau = sail.transmissivity;
    const a = absorptivity(sail);
    const epsSum = sail.emissivityFront + sail.emissivityBack;
    const thermal =
      epsSum > 0
        ? (a *
            (sail.emissivityFront * sail.lambertianFront -
              sail.emissivityBack * sail.lambertianBack)) /
          epsSum
        : 0;

    normalForce =
      PA *
      cosAlpha *
      ((1 + rho * s - tau) * cosAlpha + sail.lambertianFront * rho * (1 - s) + thermal);
    transverseForce = PA * cosAlpha * sinAlpha * (1 - rho * s - tau);
  }

  return {
    force: [
      normalForce * n[0] + transverseForce * t[0],
      normalForce * n[1] + transverseForce * t[1],
      normalForce * n[2] + transverseForce * t[2],
    ],
    normal: n,
    incidence: alpha,
    cosIncidence: cosAlpha,
    normalForce,
    transverseForce,
    flipped,
  };
}

/**
 * Solar radiation pressure force and acceleration.
 *
 * @param sail          sail configuration
 * @param mass          total spacecraft mass [kg]
 * @param sunToCraftVec vector from the Sun to the spacecraft [m] (not unit)
 * @param commandedNormal unit sail normal from the attitude controller
 * @param illumination  fraction of the solar disc visible, 0..1 (eclipse)
 */
export function solarRadiationPressure(
  sail: SailConfig,
  mass: number,
  sunToCraftVec: Vec3,
  commandedNormal: Vec3,
  illumination = 1,
): SrpResult {
  const rSun = norm(sunToCraftVec);
  const pressure = rSun > 0 ? pressureAt(sail, rSun) * illumination : 0;

  if (pressure <= 0 || illumination <= 0) {
    return NO_FORCE(pressure, commandedNormal, rSun, illumination);
  }

  const plate = flatPlateForce(sail, pressure, sail.area, unit(sunToCraftVec), commandedNormal);
  if (plate.cosIncidence <= 0) {
    return { ...NO_FORCE(pressure, plate.normal, rSun, illumination), flipped: plate.flipped };
  }

  return {
    force: plate.force,
    acceleration: scale(plate.force, 1 / mass),
    pressure,
    incidence: plate.incidence,
    cosIncidence: plate.cosIncidence,
    normal: plate.normal,
    normalForce: plate.normalForce,
    transverseForce: plate.transverseForce,
    illumination,
    flipped: plate.flipped,
    solarDistance: rSun,
  };
}
