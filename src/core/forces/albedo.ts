/**
 * Earth radiation pressure: reflected sunlight (albedo) and thermal infrared.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS WORTH MODELLING ON A SAIL
 * ---------------------------------------------------------------------------
 * A sail is, by construction, the most radiation-pressure-sensitive object
 * anyone flies. In a 500 km orbit the Earth fills 68 degrees of half-angle
 * of the sky and radiates back roughly 240 W/m^2 of thermal infrared plus
 * ~30% of the sunlight falling on it. Together that is of order 20% of the
 * direct solar flux - not a rounding error on a vehicle whose entire
 * propulsion is photon momentum.
 *
 * The infrared part is qualitatively different from everything else in the
 * model: IT DOES NOT STOP IN ECLIPSE. A sail crossing the Earth's shadow
 * loses all of its solar thrust and keeps a nadir-directed infrared push. It
 * is small, but it is the only force term that is on precisely when the sail
 * is supposedly doing nothing.
 *
 * ---------------------------------------------------------------------------
 * MODEL
 * ---------------------------------------------------------------------------
 * Both terms treat the Earth as a sphere of radius R_E radiating diffusely,
 * and both deliver their momentum along the ZENITH direction (radially
 * outward from the Earth centre).
 *
 * INFRARED. For a uniform Lambertian sphere of exitance M, the irradiance on
 * a plate facing the sphere at centre distance r is EXACTLY
 *
 *     E_ir = M (R_E / r)^2
 *
 * (integrate the constant radiance M/pi over the cone of half-angle
 * arcsin(R_E/r): E = (M/pi) * pi * sin^2 = M (R_E/r)^2). No approximation is
 * involved beyond uniform emission, and the net momentum is radial by
 * symmetry.
 *
 * ALBEDO. Reflected sunlight is not uniform - it is cosine-weighted on the
 * lit hemisphere and absent on the night side - so the same integral has no
 * elementary closed form for a general viewing geometry. Let phi be the
 * phase angle Sun-Earth-spacecraft, which is also the solar zenith angle at
 * the sub-satellite point. This model interpolates between the two limits
 * that DO have closed forms:
 *
 *   near field (r -> R_E): the visible cap shrinks onto the sub-satellite
 *     point, so E -> a S (R_E/r)^2 max(0, cos phi)
 *
 *   far field (r >> R_E): the classical Lambert-sphere phase function,
 *     E -> a S (R_E/r)^2 (2/3pi) [sin phi + (pi - phi) cos phi]
 *
 * weighted by w = (R_E/r)^2, which is 1 at the surface and falls away with
 * the solid angle the Earth subtends.
 *
 * Accuracy: at 500 km over the subsolar point this reproduces a direct
 * numerical integration over the visible cap to about 3%. Near the
 * terminator the relative error is much larger, but the absolute flux there
 * is a few percent of its subsolar value, so the error in the
 * revolution-integrated effect stays small. It is not a Knocke-Ries-Tapley
 * element model, and no attempt is made to represent the real albedo field.
 *
 * NOT MODELLED: the tangential (Sun-ward) bias of the reflected flux when the
 * spacecraft is off the Sun-Earth line - the momentum is taken as purely
 * radial; geographic, diurnal and seasonal albedo variation; and the fact
 * that the sail's optical coefficients are VISIBLE-band values being applied
 * to 10 um thermal radiation, where a real aluminised sail behaves
 * differently again. Each of these is a fraction of a term that is itself a
 * fraction.
 */

import { C_LIGHT, EARTH_ALBEDO, EARTH_IR_EXITANCE, R_EARTH } from '../constants.ts';
import { type Vec3, ZERO, clamp, dot, norm, scale, sub } from '../vec3.ts';
import { type SailConfig, pressure1Au, pressureAt } from '../sail/sail.ts';
import { flatPlateForce } from './srp.ts';

/**
 * Beyond this distance from the Earth centre the term is skipped entirely.
 *
 * 100 Earth radii puts the (R_E/r)^2 factor at 1e-4, so the infrared
 * pressure is below 1e-10 N/m^2: five orders of magnitude under the solar
 * term, and negligible everywhere in lunar space.
 */
export const EARTH_RADIATION_CUTOFF = 100 * R_EARTH;

export interface EarthRadiationResult {
  /** Total acceleration from albedo + infrared [m/s^2]. */
  acceleration: Vec3;
  /** Albedo-only acceleration [m/s^2]. */
  albedoAcceleration: Vec3;
  /** Infrared-only acceleration [m/s^2]. */
  infraredAcceleration: Vec3;
  /** Radiation pressure from reflected sunlight [N/m^2]. */
  albedoPressure: number;
  /** Radiation pressure from thermal infrared [N/m^2]. */
  infraredPressure: number;
  /** Phase angle Sun-Earth-spacecraft [rad]. */
  phaseAngle: number;
  /** Distance from the Earth centre [m]. */
  earthDistance: number;
}

const NO_RADIATION: EarthRadiationResult = {
  acceleration: ZERO,
  albedoAcceleration: ZERO,
  infraredAcceleration: ZERO,
  albedoPressure: 0,
  infraredPressure: 0,
  phaseAngle: Math.PI,
  earthDistance: Infinity,
};

/**
 * Dimensionless albedo phase factor: the fraction of `a S (R_E/r)^2` that
 * actually reaches the spacecraft.
 *
 * @param phase phase angle Sun-Earth-spacecraft [rad], 0 = over the subsolar point
 * @param w     near-field weight (R_E/r)^2, 1 at the surface
 */
export function albedoPhaseFactor(phase: number, w: number): number {
  const p = clamp(phase, 0, Math.PI);
  const near = Math.max(0, Math.cos(p));
  const far = (2 / (3 * Math.PI)) * (Math.sin(p) + (Math.PI - p) * Math.cos(p));
  const weight = clamp(w, 0, 1);
  return Math.max(0, weight * near + (1 - weight) * far);
}

export interface EarthRadiationInput {
  sail: SailConfig;
  /** Total spacecraft mass [kg]. */
  mass: number;
  /** Include reflected sunlight. */
  albedo: boolean;
  /** Include thermal infrared. */
  infrared: boolean;
}

/**
 * Earth-radiation force on the sail.
 *
 * @param r      spacecraft position in the integration frame [m]
 * @param rEarth Earth position in the integration frame [m]
 * @param rSun   Sun position in the integration frame [m]
 * @param normal commanded sail normal
 */
export function earthRadiationPressure(
  inp: EarthRadiationInput,
  r: Vec3,
  rEarth: Vec3,
  rSun: Vec3,
  normal: Vec3,
): EarthRadiationResult {
  if (!inp.albedo && !inp.infrared) return NO_RADIATION;

  const fromEarth = sub(r, rEarth);
  const d = norm(fromEarth);
  if (d <= 0 || d > EARTH_RADIATION_CUTOFF || inp.mass <= 0) return NO_RADIATION;

  // Photons from the Earth travel radially OUTWARD to reach the spacecraft.
  const zenith = scale(fromEarth, 1 / d);
  const w = (R_EARTH / d) ** 2;

  // Phase angle: Sun-Earth-spacecraft.
  const earthToSun = sub(rSun, rEarth);
  const sunDist = norm(earthToSun);
  const phase =
    sunDist > 0
      ? Math.acos(clamp(dot(zenith, scale(earthToSun, 1 / sunDist)), -1, 1))
      : Math.PI;

  // Solar irradiance AT THE EARTH, not at the spacecraft: what the Earth
  // reflects is set by what falls on the Earth. At LEO the difference is
  // 1e-4, but writing it correctly costs nothing and keeps the term right if
  // the spacecraft is far from the Earth.
  const solarIrradianceAtEarth =
    sunDist > 0 ? pressureAt(inp.sail, sunDist) * C_LIGHT : pressure1Au(inp.sail) * C_LIGHT;

  const albedoPressure = inp.albedo
    ? (EARTH_ALBEDO * solarIrradianceAtEarth * w * albedoPhaseFactor(phase, w)) / C_LIGHT
    : 0;
  const infraredPressure = inp.infrared ? (EARTH_IR_EXITANCE * w) / C_LIGHT : 0;

  const invMass = 1 / inp.mass;
  const forceFrom = (p: number): Vec3 =>
    p > 0
      ? scale(flatPlateForce(inp.sail, p, inp.sail.area, zenith, normal).force, invMass)
      : ZERO;

  const albedoAcceleration = forceFrom(albedoPressure);
  const infraredAcceleration = forceFrom(infraredPressure);

  return {
    acceleration: [
      albedoAcceleration[0] + infraredAcceleration[0],
      albedoAcceleration[1] + infraredAcceleration[1],
      albedoAcceleration[2] + infraredAcceleration[2],
    ],
    albedoAcceleration,
    infraredAcceleration,
    albedoPressure,
    infraredPressure,
    phaseAngle: phase,
    earthDistance: d,
  };
}
