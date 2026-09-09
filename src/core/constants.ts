/**
 * Physical and astronomical constants.
 *
 * ALL values are SI unless the name says otherwise (m, kg, s, N, W).
 * Sources are noted per constant; see docs/physics.md for discussion.
 */

/** Astronomical unit [m] — IAU 2012 definition (exact). */
export const AU = 1.495978707e11;

/** Speed of light in vacuum [m/s] (exact). */
export const C_LIGHT = 299792458;

/** Newtonian constant of gravitation [m^3 kg^-1 s^-2] (CODATA 2018). */
export const G_CONST = 6.6743e-11;

// ---------------------------------------------------------------------------
// Gravitational parameters (mu = G*M) [m^3/s^2]
// ---------------------------------------------------------------------------

/** Earth GM [m^3/s^2] — EGM2008 / WGS-84. */
export const MU_EARTH = 3.986004418e14;

/** Moon GM [m^3/s^2] — DE430. */
export const MU_MOON = 4.9048695e12;

/** Sun GM [m^3/s^2] — IAU 2015 nominal. */
export const MU_SUN = 1.32712440018e20;

// ---------------------------------------------------------------------------
// Body radii [m]
// ---------------------------------------------------------------------------

/** Earth equatorial radius [m] — WGS-84. */
export const R_EARTH = 6378137;

/** Earth mean radius [m]. */
export const R_EARTH_MEAN = 6371008.8;

/** Moon mean radius [m]. */
export const R_MOON = 1737400;

/** Sun mean radius [m]. */
export const R_SUN = 6.957e8;

// ---------------------------------------------------------------------------
// Earth gravity field (normalised zonal harmonics, WGS-84 / EGM96)
// ---------------------------------------------------------------------------

/** Second zonal harmonic (oblateness) — dimensionless. */
export const J2_EARTH = 1.08262668e-3;

/** Third zonal harmonic — dimensionless (pear-shape term, unused in V1). */
export const J3_EARTH = -2.53265649e-6;

// ---------------------------------------------------------------------------
// Solar radiation
// ---------------------------------------------------------------------------

/**
 * Total solar irradiance at 1 AU [W/m^2].
 *
 * 1361 W/m^2 is the modern (SORCE/TIM) value. 1368 W/m^2 is the classical
 * value used throughout the solar-sailing literature (McInnes 1999) and is
 * the default here so that the canonical P0 = 4.56 uN/m^2 is reproduced.
 * Selectable in the UI.
 */
export const SOLAR_IRRADIANCE_1AU_CLASSICAL = 1368;
export const SOLAR_IRRADIANCE_1AU_MODERN = 1361;

/**
 * Solar radiation pressure at 1 AU [N/m^2] = irradiance / c.
 *
 *   1368 / 299792458 = 4.5632e-6 N/m^2 = 4.563 uN/m^2
 *
 * This is the value quoted in the solar-sail literature and the target of the
 * radiation-pressure validation test.
 */
export const SRP_1AU_CLASSICAL = SOLAR_IRRADIANCE_1AU_CLASSICAL / C_LIGHT;
export const SRP_1AU_MODERN = SOLAR_IRRADIANCE_1AU_MODERN / C_LIGHT;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Seconds per day (86400, by definition of the SI day). */
export const SEC_PER_DAY = 86400;

/** Seconds per hour. */
export const SEC_PER_HOUR = 3600;

/** Julian date of the J2000.0 epoch (2000-01-01 12:00:00 TT). */
export const JD_J2000 = 2451545.0;

/** Unix epoch (1970-01-01 00:00 UTC) as a Julian date. */
export const JD_UNIX_EPOCH = 2440587.5;

// ---------------------------------------------------------------------------
// Earth rotation / obliquity
// ---------------------------------------------------------------------------

/** Mean obliquity of the ecliptic at J2000.0 [rad] (23.4392911 deg). */
export const OBLIQUITY_J2000 = (23.4392911 * Math.PI) / 180;

/** Earth sidereal rotation rate [rad/s]. */
export const EARTH_ROTATION_RATE = 7.2921159e-5;

// ---------------------------------------------------------------------------
// Moon orbit (simplified Keplerian model — see docs/lunar-model.md)
// ---------------------------------------------------------------------------

/** Mean Earth-Moon semi-major axis [m]. */
export const MOON_SMA = 3.84400e8;

/** Mean lunar orbital eccentricity [-]. */
export const MOON_ECC = 0.0549;

/** Lunar orbit inclination to the ECLIPTIC [rad] (5.145 deg). */
export const MOON_INC_ECLIPTIC = (5.145 * Math.PI) / 180;

/** Sidereal month [s] (27.321661 days). */
export const MOON_SIDEREAL_PERIOD = 27.321661 * SEC_PER_DAY;

/** Regression period of the lunar ascending node [s] (18.6 years, retrograde). */
export const MOON_NODE_PERIOD = 18.6 * 365.25 * SEC_PER_DAY;

/** Precession period of the lunar line of apsides [s] (8.85 years, prograde). */
export const MOON_APSIDAL_PERIOD = 8.85 * 365.25 * SEC_PER_DAY;

/** Radius of the Moon's sphere of influence w.r.t. Earth [m] (approx 66,100 km). */
export const MOON_SOI_RADIUS = 6.61e7;

// ---------------------------------------------------------------------------
// Unit conversion helpers
// ---------------------------------------------------------------------------

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
