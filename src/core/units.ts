/**
 * Unit handling and engineering-style number formatting.
 *
 * The simulation core is strictly SI (m, kg, s, N, rad). This module is the
 * ONLY place that converts to the units the UI shows, so a display change can
 * never leak into the physics.
 */

import { AU, DEG, RAD, SEC_PER_DAY, SEC_PER_HOUR } from './constants.ts';

// ---------------------------------------------------------------------------
// Conversions (SI <-> display)
// ---------------------------------------------------------------------------

export const mToKm = (m: number) => m / 1000;
export const kmToM = (km: number) => km * 1000;

/** m/s^2 -> mm/s^2 */
export const msToMms = (a: number) => a * 1e3;
/** m/s^2 -> um/s^2 (micro-metres per second squared) */
export const msToUms = (a: number) => a * 1e6;
/** um/s^2 -> m/s^2 */
export const umsToMs = (a: number) => a * 1e-6;

/** N/m^2 -> uN/m^2 (micro-newtons per square metre) */
export const paToUpa = (p: number) => p * 1e6;

export const radToDeg = (r: number) => r * RAD;
export const degToRad = (d: number) => d * DEG;

export const sToDays = (s: number) => s / SEC_PER_DAY;
export const daysToS = (d: number) => d * SEC_PER_DAY;
export const sToHours = (s: number) => s / SEC_PER_HOUR;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Fixed number of significant figures, without exponent creep for
 * mid-magnitude values. Engineering tables read better this way than with
 * `toPrecision` alone.
 */
export function sig(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : x < 0 ? '-inf' : 'NaN';
  if (x === 0) return '0';
  const ax = Math.abs(x);
  if (ax >= 1e6 || ax < 1e-4) {
    return x.toExponential(Math.max(0, digits - 1));
  }
  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(ax)));
  return x.toFixed(Math.min(decimals, 10));
}

/** Fixed decimal places, with a proper minus sign and no "-0". */
export function fixed(x: number, decimals = 2): string {
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : x < 0 ? '-inf' : 'NaN';
  const s = x.toFixed(decimals);
  return s === (0).toFixed(decimals) ? s : s.replace(/^-(0(\.0*)?)$/, '$1');
}

/** Duration as `Dd HH:MM:SS`, for the mission-elapsed-time readout. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--';
  const sign = seconds < 0 ? '-' : '';
  let s = Math.abs(Math.round(seconds));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Compact seconds -> "10 s" / "5.0 min" / "2.3 h" / "1.5 d". */
export function formatTimestep(seconds: number): string {
  if (seconds < 60) return `${sig(seconds, 3)} s`;
  if (seconds < 3600) return `${sig(seconds / 60, 3)} min`;
  if (seconds < 86400) return `${sig(seconds / 3600, 3)} h`;
  return `${sig(seconds / 86400, 3)} d`;
}

/** Length with an automatically chosen unit (m / km / 1000 km / AU). */
export function formatLength(metres: number): string {
  const a = Math.abs(metres);
  if (!Number.isFinite(metres)) return 'inf';
  if (a < 1000) return `${fixed(metres, 1)} m`;
  if (a < 1e9) return `${sig(metres / 1000, 5)} km`;
  return `${sig(metres / 1.495978707e11, 4)} AU`;
}

/**
 * Acceleration in the unit engineers actually use for sails.
 * Sail accelerations are typically 1e-6..1e-3 m/s^2, so um/s^2 and mm/s^2 are
 * the useful ranges.
 */
export function formatAccel(ms2: number): string {
  const a = Math.abs(ms2);
  if (a === 0) return '0 um/s^2';
  if (a < 1e-3) return `${sig(msToUms(ms2), 4)} um/s^2`;
  return `${sig(msToMms(ms2), 4)} mm/s^2`;
}

/** Velocity: m/s below 1 km/s, km/s above. */
export function formatVelocity(ms: number): string {
  return Math.abs(ms) < 1000 ? `${fixed(ms, 2)} m/s` : `${sig(ms / 1000, 5)} km/s`;
}

export const formatAngle = (rad: number, decimals = 2) => `${fixed(radToDeg(rad), decimals)} deg`;

export const formatPressure = (nm2: number) => `${sig(paToUpa(nm2), 4)} uN/m^2`;

/** Distance in astronomical units, the working unit of interplanetary work. */
export const formatAu = (metres: number, digits = 4): string =>
  `${sig(metres / AU, digits)} AU`;

/**
 * Distance formatted for the frame it belongs to: AU heliocentrically, km
 * about a planet.
 *
 * Both are the unit a reader of that regime expects, and neither is right for
 * the other: "2.28e8 km" is Mars to nobody, and "3.4e-5 AU" is a LEO altitude
 * to nobody.
 */
export const formatDistanceFor = (metres: number, heliocentric: boolean): string =>
  heliocentric ? formatAu(metres) : formatLength(metres);
