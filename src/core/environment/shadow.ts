/**
 * Eclipse (shadow) model.
 *
 * WHY THIS IS IN V1: in a 500 km circular orbit the spacecraft spends roughly
 * 35% of every revolution inside the Earth shadow. Ignoring that would
 * overstate the available solar-sail impulse by about a third, so the headline
 * LEO feasibility numbers would simply be wrong. It is therefore enabled by
 * default, and can be switched off in the Simulation panel to see the
 * difference.
 *
 * Model: dual-cone (umbra + penumbra) geometry treating the Sun as a sphere of
 * finite radius and the occulting body as an opaque sphere. Inside the umbra
 * the illumination fraction is 0; in the penumbra it is linearly interpolated
 * on the apparent-radius overlap. This is the standard "conical shadow with
 * linear penumbra" used for concept-level analysis.
 *
 * NOT modelled: atmospheric refraction and the resulting partial illumination
 * ring, limb darkening, and the true area-overlap integral of two discs (we
 * use a linear ramp instead, which differs by at most a few percent of the
 * penumbra crossing - itself only a few seconds in LEO).
 */

import { R_EARTH, R_MOON, R_SUN } from '../constants.ts';
import { type Vec3, dot, norm, scale, sub, unit } from '../vec3.ts';

export interface ShadowResult {
  /** Fraction of the solar disc visible: 1 = full Sun, 0 = total eclipse. */
  fraction: number;
  /** Which body is responsible, for the UI readout. */
  occulter: 'none' | 'earth' | 'moon';
  /** True when fraction < 1 (any degree of eclipse). */
  eclipsed: boolean;
}

const FULL_SUN: ShadowResult = { fraction: 1, occulter: 'none', eclipsed: false };

/**
 * Illumination fraction for one spherical occulter.
 *
 * @param rCraft      spacecraft position relative to the frame origin [m]
 * @param rSun        Sun position relative to the frame origin [m]
 * @param rOcculter   occulting body position relative to the frame origin [m]
 * @param occulterRadius  radius of the occulting body [m]
 */
export function illuminationFraction(
  rCraft: Vec3,
  rSun: Vec3,
  rOcculter: Vec3,
  occulterRadius: number,
): number {
  // Work in a frame centred on the occulting body.
  const s = sub(rCraft, rOcculter); // occulter -> spacecraft
  const sunFromOcculter = sub(rSun, rOcculter); // occulter -> Sun
  const dSun = norm(sunFromOcculter);
  if (dSun === 0) return 1;

  const sunHat = unit(sunFromOcculter);
  const sMag = norm(s);
  if (sMag === 0) return 0; // at the centre of the occulter

  // Distance along the anti-Sun axis. Negative => spacecraft is on the sunlit
  // side of the occulter and can never be shadowed by it.
  const along = -dot(s, sunHat);
  if (along <= 0) return 1;

  // Perpendicular distance from the shadow axis.
  const perp = norm(sub(s, scale(sunHat, -along)));

  // Apparent angular radii as seen from the spacecraft.
  // Umbra cone: half-angle where the occulter exactly covers the Sun.
  const fUmbra = Math.asin(Math.max(-1, Math.min(1, (R_SUN - occulterRadius) / dSun)));
  const fPenumbra = Math.asin(Math.max(-1, Math.min(1, (R_SUN + occulterRadius) / dSun)));

  // Radius of the umbra and penumbra cross-sections at this distance.
  const rUmbra = occulterRadius - along * Math.tan(fUmbra);
  const rPenumbra = occulterRadius + along * Math.tan(fPenumbra);

  if (perp <= rUmbra) return 0; // total eclipse (or annular-total core)
  if (perp >= rPenumbra) return 1; // fully lit

  // Linear ramp across the penumbra.
  const span = rPenumbra - rUmbra;
  if (span <= 0) return 1;
  return (perp - rUmbra) / span;
}

/**
 * Combined Earth + Moon shadow. Positions are all expressed in the same
 * inertial frame (whatever the integration centre happens to be).
 *
 * The two occulters are combined multiplicatively; a simultaneous Earth and
 * Moon eclipse is geometrically possible but vanishingly rare, so this is
 * exact in every practical case.
 */
export function computeShadow(
  rCraft: Vec3,
  rSun: Vec3,
  rEarth: Vec3,
  rMoon: Vec3,
  enableEarth = true,
  enableMoon = true,
): ShadowResult {
  let fraction = 1;
  let occulter: ShadowResult['occulter'] = 'none';

  if (enableEarth) {
    const fEarth = illuminationFraction(rCraft, rSun, rEarth, R_EARTH);
    if (fEarth < 1) {
      fraction *= fEarth;
      occulter = 'earth';
    }
  }
  if (enableMoon) {
    const fMoon = illuminationFraction(rCraft, rSun, rMoon, R_MOON);
    if (fMoon < 1) {
      fraction *= fMoon;
      if (occulter === 'none' || fMoon < fraction) occulter = 'moon';
    }
  }

  if (fraction >= 1) return FULL_SUN;
  return { fraction, occulter, eclipsed: true };
}
