/**
 * Atmospheric density model.
 *
 * WHY THIS MATTERS FOR A SAIL: below roughly 600 km drag is not a correction
 * to the sail force, it is the dominant non-gravitational term. At 400 km a
 * 1 m^2/kg sail sees a sail acceleration of ~9e-6 m/s^2 and a drag
 * deceleration of ~1e-4 m/s^2 - more than ten times larger, and always
 * opposing the motion. Any LEO conclusion drawn without it is not just
 * imprecise, it has the wrong sign for the secular semi-major axis change.
 *
 * MODEL: the piecewise-exponential fit to the US Standard Atmosphere 1976 /
 * CIRA-72 tabulated by Vallado, "Fundamentals of Astrodynamics and
 * Applications", Table 8-4:
 *
 *   rho(h) = rho0 * exp(-(h - h0) / H)
 *
 * with (h0, rho0, H) taken from the band containing h. It is continuous by
 * construction at the band edges to within the fit residual (a few percent),
 * costs one exponential, and reproduces the tabulated densities to better
 * than 10% through the whole 0-1000 km range at nominal solar activity.
 *
 * WHAT IT IS NOT: this is a static model. The real thermosphere above ~200 km
 * varies by an order of magnitude with solar EUV flux, by a factor of a few
 * between day and night, and abruptly during geomagnetic storms. NRLMSISE-00
 * or JB2008 model that; this does not. The `AtmosphereActivity` selector below
 * is a blunt multiplier standing in for the solar-cycle part of that spread,
 * and is documented as such wherever it appears in the UI - the point is to
 * let a user see how much a drag conclusion depends on the atmosphere
 * assumption, not to claim a density.
 *
 * See docs/earth-model.md for the discussion.
 */

/** One band of the piecewise-exponential fit. */
interface DensityBand {
  /** Base geometric altitude of the band [m]. */
  h0: number;
  /** Nominal density at the base altitude [kg/m^3]. */
  rho0: number;
  /** Scale height within the band [m]. */
  H: number;
}

/**
 * Vallado Table 8-4, converted to SI. The final band is open-ended and is
 * used for everything above 1000 km, where the density is already below
 * 3e-15 kg/m^3 and drag is utterly negligible against any other term.
 */
const BANDS: readonly DensityBand[] = [
  { h0: 0, rho0: 1.225, H: 7249 },
  { h0: 25e3, rho0: 3.899e-2, H: 6349 },
  { h0: 30e3, rho0: 1.774e-2, H: 6682 },
  { h0: 40e3, rho0: 3.972e-3, H: 7554 },
  { h0: 50e3, rho0: 1.057e-3, H: 8382 },
  { h0: 60e3, rho0: 3.206e-4, H: 7714 },
  { h0: 70e3, rho0: 8.77e-5, H: 6549 },
  { h0: 80e3, rho0: 1.905e-5, H: 5799 },
  { h0: 90e3, rho0: 3.396e-6, H: 5382 },
  { h0: 100e3, rho0: 5.297e-7, H: 5877 },
  { h0: 110e3, rho0: 9.661e-8, H: 7263 },
  { h0: 120e3, rho0: 2.438e-8, H: 9473 },
  { h0: 130e3, rho0: 8.484e-9, H: 12636 },
  { h0: 140e3, rho0: 3.845e-9, H: 16149 },
  { h0: 150e3, rho0: 2.07e-9, H: 22523 },
  { h0: 180e3, rho0: 5.464e-10, H: 29740 },
  { h0: 200e3, rho0: 2.789e-10, H: 37105 },
  { h0: 250e3, rho0: 7.248e-11, H: 45546 },
  { h0: 300e3, rho0: 2.418e-11, H: 53628 },
  { h0: 350e3, rho0: 9.518e-12, H: 53298 },
  { h0: 400e3, rho0: 3.725e-12, H: 58515 },
  { h0: 450e3, rho0: 1.585e-12, H: 60828 },
  { h0: 500e3, rho0: 6.967e-13, H: 63822 },
  { h0: 600e3, rho0: 1.454e-13, H: 71835 },
  { h0: 700e3, rho0: 3.614e-14, H: 88667 },
  { h0: 800e3, rho0: 1.17e-14, H: 124640 },
  { h0: 900e3, rho0: 5.245e-15, H: 181050 },
  { h0: 1000e3, rho0: 3.019e-15, H: 268000 },
];

/**
 * Above this altitude the model returns exactly zero.
 *
 * 2000 km is far beyond where the extrapolated density (below 1e-16 kg/m^3)
 * could matter: at that level the drag deceleration on a 1 m^2/kg sail is
 * ~1e-14 m/s^2, six orders of magnitude below the sail force. Cutting off
 * keeps the exponential out of the hot path for every orbit above LEO.
 */
export const ATMOSPHERE_CUTOFF_ALTITUDE = 2000e3;

/** Solar-activity assumption for the thermosphere. */
export type AtmosphereActivity = 'low' | 'mean' | 'high';

export const ATMOSPHERE_ACTIVITY_LABELS: Record<AtmosphereActivity, string> = {
  low: 'Solar minimum (density x0.4)',
  mean: 'Nominal (tabulated values)',
  high: 'Solar maximum (density x3)',
};

export const ATMOSPHERE_ACTIVITY_NOTES: Record<AtmosphereActivity, string> = {
  low: 'Quiet Sun. Thermospheric density near solar minimum runs roughly a factor of 2-3 below the nominal table at 400-600 km.',
  mean: 'The tabulated US Standard Atmosphere 1976 / CIRA-72 values, with no solar-cycle adjustment.',
  high: 'Active Sun. Density at 400-600 km can exceed the nominal table by a factor of 3-10 near solar maximum, and a geomagnetic storm can add more on top for a few days.',
};

/** Multiplier applied to the thermosphere for each activity level. */
const ACTIVITY_FACTOR: Record<AtmosphereActivity, number> = {
  low: 0.4,
  mean: 1,
  high: 3,
};

/**
 * Altitudes between which the activity multiplier is faded in.
 *
 * Solar EUV heats the thermosphere; the lower atmosphere does not care about
 * the solar cycle at all. Applying the multiplier uniformly would therefore
 * be wrong by a factor of 3 at sea level, so it is ramped in (linearly in
 * log-density) across the mesopause region and is at full strength from
 * 200 km up, which is where drag on a spacecraft actually lives.
 */
const ACTIVITY_RAMP_LOW = 100e3;
const ACTIVITY_RAMP_HIGH = 200e3;

/**
 * Atmospheric mass density at geometric altitude `altitude` [m] above the
 * Earth reference radius.
 *
 * @returns density [kg/m^3], exactly 0 above {@link ATMOSPHERE_CUTOFF_ALTITUDE}
 */
export function atmosphericDensity(
  altitude: number,
  activity: AtmosphereActivity = 'mean',
): number {
  if (!(altitude < ATMOSPHERE_CUTOFF_ALTITUDE)) return 0;
  // Below the surface the density is not physically meaningful, but the
  // propagator can transiently evaluate a sub-surface state mid-step; return
  // the sea-level value rather than something enormous.
  const h = Math.max(0, altitude);

  // Linear scan: 28 bands, and the branch predictor sees the same band for
  // thousands of consecutive calls in a near-circular orbit. A binary search
  // measured no faster.
  let band = BANDS[0];
  for (let i = BANDS.length - 1; i >= 0; i--) {
    if (h >= BANDS[i].h0) {
      band = BANDS[i];
      break;
    }
  }

  const rho = band.rho0 * Math.exp(-(h - band.h0) / band.H);

  const factor = ACTIVITY_FACTOR[activity];
  if (factor === 1) return rho;

  // Ramp the multiplier in across the mesopause region.
  const w =
    h <= ACTIVITY_RAMP_LOW
      ? 0
      : h >= ACTIVITY_RAMP_HIGH
        ? 1
        : (h - ACTIVITY_RAMP_LOW) / (ACTIVITY_RAMP_HIGH - ACTIVITY_RAMP_LOW);

  // Interpolate in log space so the ramp cannot introduce a kink in the
  // density gradient large enough to disturb the integrator.
  return rho * factor ** w;
}

/**
 * Local scale height [m] at an altitude - the band value, used by the UI to
 * explain how fast density falls off.
 */
export function scaleHeightAt(altitude: number): number {
  const h = Math.max(0, altitude);
  let band = BANDS[0];
  for (let i = BANDS.length - 1; i >= 0; i--) {
    if (h >= BANDS[i].h0) {
      band = BANDS[i];
      break;
    }
  }
  return band.H;
}
