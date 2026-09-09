/**
 * Solar sail definition and derived performance figures.
 *
 * See docs/solar-sail-model.md for the derivation of every quantity here.
 */

import {
  AU,
  C_LIGHT,
  MU_SUN,
  SOLAR_IRRADIANCE_1AU_CLASSICAL,
  SOLAR_IRRADIANCE_1AU_MODERN,
} from '../constants.ts';

/** Which radiation-pressure force law to use. */
export type SailForceModel = 'ideal' | 'optical';

export const SAIL_FORCE_MODEL_LABELS: Record<SailForceModel, string> = {
  ideal: 'Ideal reflector with efficiency factor',
  optical: 'Non-ideal flat plate (optical coefficients)',
};

export type SolarConstantChoice = 'classical' | 'modern';

export const SOLAR_CONSTANT_OPTIONS: Record<
  SolarConstantChoice,
  { irradiance: number; label: string }
> = {
  classical: {
    irradiance: SOLAR_IRRADIANCE_1AU_CLASSICAL,
    label: '1368 W/m^2 (classical, gives P0 = 4.563 uN/m^2)',
  },
  modern: {
    irradiance: SOLAR_IRRADIANCE_1AU_MODERN,
    label: '1361 W/m^2 (modern TSI, gives P0 = 4.540 uN/m^2)',
  },
};

export interface SailConfig {
  /** Reflective sail area [m^2]. */
  area: number;

  /** Which force law. */
  forceModel: SailForceModel;

  // --- 'ideal' model ---------------------------------------------------
  /**
   * Overall optical efficiency [-], 0..1. Multiplies the ideal
   * 2 P A cos^2(alpha) force. Real sails achieve roughly 0.85-0.9.
   */
  efficiency: number;

  // --- 'optical' model -------------------------------------------------
  /** Reflection coefficient rho [-]. */
  reflectivity: number;
  /** Specular fraction of the reflected light s [-]. */
  specularFraction: number;
  /** Transmission coefficient tau [-]. Photons passing through exert no force. */
  transmissivity: number;
  /** Front surface emissivity eps_f [-]. */
  emissivityFront: number;
  /** Back surface emissivity eps_b [-]. */
  emissivityBack: number;
  /** Front non-Lambertian coefficient B_f [-] (2/3 for a Lambertian surface). */
  lambertianFront: number;
  /** Back non-Lambertian coefficient B_b [-]. */
  lambertianBack: number;

  /** Solar irradiance convention. */
  solarConstant: SolarConstantChoice;
}

export interface SpacecraftConfig {
  /** Dry mass [kg] - structure, payload, sail. */
  dryMass: number;
  /**
   * Propellant mass [kg]. Carried for completeness of the mass budget only:
   * V1 has no thruster model, so this mass is inert and never expended.
   */
  propellantMass: number;
}

/** Total spacecraft mass [kg]. */
export const totalMass = (sc: SpacecraftConfig): number =>
  Math.max(1e-9, sc.dryMass + sc.propellantMass);

/** Solar radiation pressure at 1 AU for the selected convention [N/m^2]. */
export const pressure1Au = (sail: SailConfig): number =>
  SOLAR_CONSTANT_OPTIONS[sail.solarConstant].irradiance / C_LIGHT;

/**
 * Solar radiation pressure at heliocentric distance r [m].
 *
 *   P(r) = P0 * (1 AU / r)^2
 *
 * Pure inverse-square: the Sun is treated as a point source, which is exact
 * to better than 1e-5 anywhere outside the solar corona.
 */
export const pressureAt = (sail: SailConfig, r: number): number =>
  pressure1Au(sail) * (AU / r) ** 2;

/**
 * The absorptivity implied by the other coefficients: a = 1 - rho - tau.
 * Clamped at zero so an over-specified sail cannot produce negative
 * absorption.
 */
export const absorptivity = (sail: SailConfig): number =>
  Math.max(0, 1 - sail.reflectivity - sail.transmissivity);

/**
 * Peak force coefficient at normal incidence: the dimensionless factor `k`
 * in `F = k * P * A` when the sail faces the Sun squarely.
 *
 * Ideal sail: k = 2. Any real sail: k < 2.
 */
export function normalIncidenceCoefficient(sail: SailConfig): number {
  if (sail.forceModel === 'ideal') return 2 * sail.efficiency;

  const { reflectivity: rho, specularFraction: s, transmissivity: tau } = sail;
  const a = absorptivity(sail);
  const epsSum = sail.emissivityFront + sail.emissivityBack;
  const thermal =
    epsSum > 0
      ? (a * (sail.emissivityFront * sail.lambertianFront -
          sail.emissivityBack * sail.lambertianBack)) / epsSum
      : 0;
  // At alpha = 0: cos(alpha) = 1, so the bracket of the normal component is
  //   (1 + rho*s - tau) + rho*(1-s)*B_f + thermal
  return 1 + rho * s - tau + rho * (1 - s) * sail.lambertianFront + thermal;
}

export interface SailPerformance {
  /** Total spacecraft mass [kg]. */
  mass: number;
  /** Sail area [m^2]. */
  area: number;
  /** Area-to-mass ratio sigma^-1 [m^2/kg]. */
  areaToMass: number;
  /** Sail loading sigma = m/A [kg/m^2]. */
  sailLoading: number;
  /** Solar radiation pressure at 1 AU [N/m^2]. */
  pressure1Au: number;
  /** Dimensionless normal-incidence force coefficient [-]. Ideal sail: 2. */
  forceCoefficient: number;
  /**
   * Characteristic acceleration a_c [m/s^2]: the acceleration of a sun-facing
   * sail at 1 AU. This is the standard figure of merit for solar sails.
   */
  characteristicAcceleration: number;
  /**
   * Lightness number beta [-]: ratio of the characteristic sail acceleration
   * to the solar gravitational acceleration at 1 AU. beta = 1 exactly cancels
   * solar gravity. Meaningful mainly for interplanetary work, shown here for
   * context.
   */
  lightnessNumber: number;
  /** Force on a sun-facing sail at 1 AU [N]. */
  force1Au: number;
}

/** Derived sail performance figures for the Solar Sail panel. */
export function sailPerformance(sail: SailConfig, sc: SpacecraftConfig): SailPerformance {
  const mass = totalMass(sc);
  const area = sail.area;
  const p0 = pressure1Au(sail);
  const k = normalIncidenceCoefficient(sail);
  const force1Au = k * p0 * area;
  const ac = force1Au / mass;

  // Solar gravitational acceleration at 1 AU [m/s^2]
  const solarGravity1Au = MU_SUN / AU ** 2;

  return {
    mass,
    area,
    areaToMass: area / mass,
    sailLoading: mass / Math.max(1e-12, area),
    pressure1Au: p0,
    forceCoefficient: k,
    characteristicAcceleration: ac,
    lightnessNumber: ac / solarGravity1Au,
    force1Au,
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default optical coefficients.
 *
 * These are the widely quoted values for an aluminium-coated Kapton/CP1 sail
 * with a bare (uncoated) back surface, as used for the JPL/McInnes reference
 * sail: rho = 0.88, s = 0.94, eps_f = 0.05, eps_b = 0.55, B_f = 0.79,
 * B_b = 0.55. They give a normal-incidence coefficient of ~1.83 rather than
 * the ideal 2.0.
 */
export const DEFAULT_SAIL: SailConfig = {
  area: 100,
  forceModel: 'optical',
  efficiency: 0.9,
  reflectivity: 0.88,
  specularFraction: 0.94,
  transmissivity: 0,
  emissivityFront: 0.05,
  emissivityBack: 0.55,
  lambertianFront: 0.79,
  lambertianBack: 0.55,
  solarConstant: 'classical',
};

export const DEFAULT_SPACECRAFT: SpacecraftConfig = {
  dryMass: 100,
  propellantMass: 0,
};

/** A perfectly reflecting sail - used by the validation tests. */
export const IDEAL_SAIL: SailConfig = {
  ...DEFAULT_SAIL,
  forceModel: 'optical',
  reflectivity: 1,
  specularFraction: 1,
  transmissivity: 0,
};
