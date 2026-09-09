/**
 * Time system.
 *
 * The simulator carries a single scalar `t` = seconds since the mission epoch.
 * Ephemerides need an absolute date, so the epoch is stored as a Julian date
 * and absolute time is `epochJd + t / 86400`.
 *
 * TIME SCALE ASSUMPTION: we do not distinguish UTC / TT / TDB. The maximum
 * offset between them is ~70 s, which displaces the Sun by ~3e-4 deg and the
 * Moon by ~35 km. Both are far below the error of the simplified ephemerides
 * themselves, so a single uniform scale is used throughout and documented as
 * such (see docs/lunar-model.md).
 */

import { JD_J2000, JD_UNIX_EPOCH, SEC_PER_DAY } from '../constants.ts';

/** Julian date from a JavaScript Date (treated as UTC). */
export function dateToJd(date: Date): number {
  return JD_UNIX_EPOCH + date.getTime() / (SEC_PER_DAY * 1000);
}

/** JavaScript Date from a Julian date. */
export function jdToDate(jd: number): Date {
  return new Date((jd - JD_UNIX_EPOCH) * SEC_PER_DAY * 1000);
}

/** Julian date from an ISO 8601 string, e.g. "2026-03-20T12:00:00Z". */
export function isoToJd(iso: string): number {
  const ms = Date.parse(iso.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid ISO date: ${iso}`);
  return JD_UNIX_EPOCH + ms / (SEC_PER_DAY * 1000);
}

/** ISO 8601 string (to seconds, UTC) from a Julian date. */
export function jdToIso(jd: number): string {
  return `${jdToDate(jd).toISOString().slice(0, 19)}Z`;
}

/** Days elapsed since the J2000.0 epoch. */
export const daysSinceJ2000 = (jd: number): number => jd - JD_J2000;

/** Centuries elapsed since J2000.0 (Julian centuries of 36525 days). */
export const centuriesSinceJ2000 = (jd: number): number => (jd - JD_J2000) / 36525;

/** Absolute Julian date at mission time `t` [s] after `epochJd`. */
export const missionTimeToJd = (epochJd: number, t: number): number =>
  epochJd + t / SEC_PER_DAY;
