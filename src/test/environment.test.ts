/**
 * Validation: ephemerides, environment assembly and third-body gravity.
 *
 * The ephemerides are analytic approximations, so these tests check them
 * against independently known astronomical facts rather than against a
 * higher-fidelity implementation we do not have.
 */

import { describe, expect, it } from 'vitest';
import {
  AU,
  MOON_SMA,
  MU_EARTH,
  MU_MOON,
  MU_SUN,
  OBLIQUITY_J2000,
  RAD,
  R_EARTH,
} from '../core/constants.ts';
import { angleBetween, norm, scale, sub, type Vec3 } from '../core/vec3.ts';
import { isoToJd, jdToIso, dateToJd, jdToDate, daysSinceJ2000 } from '../core/environment/time.ts';
import { sunState, sunDirection } from '../core/environment/sun.ts';
import { moonPosition, moonState } from '../core/environment/moon.ts';
import { evaluateEnvironment, sunToCraft } from '../core/environment/environment.ts';
import { centralGravity, j2Earth, thirdBodyGravity } from '../core/forces/gravity.ts';

describe('time conversions', () => {
  it('round-trips ISO strings through Julian dates', () => {
    for (const iso of [
      '2000-01-01T12:00:00Z',
      '2026-03-20T12:00:00Z',
      '1999-12-31T23:59:59Z',
      '2050-07-04T06:30:00Z',
    ]) {
      expect(jdToIso(isoToJd(iso))).toBe(iso);
    }
  });

  it('places J2000.0 at JD 2451545.0', () => {
    expect(isoToJd('2000-01-01T12:00:00Z')).toBeCloseTo(2451545.0, 9);
    expect(daysSinceJ2000(isoToJd('2000-01-01T12:00:00Z'))).toBeCloseTo(0, 9);
  });

  it('round-trips Date objects', () => {
    const d = new Date('2030-06-15T08:45:30Z');
    expect(jdToDate(dateToJd(d)).toISOString()).toBe(d.toISOString());
  });

  it('advances one Julian day per 86400 seconds', () => {
    const a = isoToJd('2026-01-01T00:00:00Z');
    const b = isoToJd('2026-01-02T00:00:00Z');
    expect(b - a).toBeCloseTo(1, 9);
  });
});

describe('solar ephemeris', () => {
  it('keeps the Earth-Sun distance within the known annual range', () => {
    // Perihelion 0.9833 AU, aphelion 1.0167 AU.
    let min = Infinity;
    let max = -Infinity;
    for (let d = 0; d < 366; d++) {
      const jd = isoToJd('2026-01-01T00:00:00Z') + d;
      const r = sunState(jd).distance / AU;
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    expect(min).toBeGreaterThan(0.982);
    expect(min).toBeLessThan(0.985);
    expect(max).toBeGreaterThan(1.015);
    expect(max).toBeLessThan(1.018);
  });

  it('reaches perihelion in early January', () => {
    let bestDay = -1;
    let bestR = Infinity;
    for (let d = 0; d < 60; d++) {
      const jd = isoToJd('2026-01-01T00:00:00Z') + d;
      const r = sunState(jd).distance;
      if (r < bestR) {
        bestR = r;
        bestDay = d;
      }
    }
    // Perihelion falls on 2-5 January.
    expect(bestDay).toBeGreaterThanOrEqual(0);
    expect(bestDay).toBeLessThan(10);
  });

  it('places the Sun on the equator at the equinoxes', () => {
    // At the March equinox the Sun crosses the celestial equator, so its
    // declination (and hence the z component in equatorial axes) is ~0.
    const s = sunState(isoToJd('2026-03-20T14:46:00Z'));
    const dec = Math.asin(s.position[2] / norm(s.position)) * RAD;
    expect(Math.abs(dec)).toBeLessThan(0.2);
    // And its right ascension is ~0.
    const ra = ((Math.atan2(s.position[1], s.position[0]) * RAD) + 360) % 360;
    expect(Math.min(ra, 360 - ra)).toBeLessThan(0.5);
  });

  it('reaches maximum declination near the obliquity at the solstices', () => {
    const june = sunState(isoToJd('2026-06-21T08:24:00Z'));
    const decJune = Math.asin(june.position[2] / norm(june.position));
    expect(decJune * RAD).toBeCloseTo(OBLIQUITY_J2000 * RAD, 0);

    const dec = sunState(isoToJd('2026-12-21T20:03:00Z'));
    const decDec = Math.asin(dec.position[2] / norm(dec.position));
    expect(decDec * RAD).toBeCloseTo(-OBLIQUITY_J2000 * RAD, 0);
  });

  it('advances about 1 degree of ecliptic longitude per day', () => {
    const jd = isoToJd('2026-05-01T00:00:00Z');
    const a = sunDirection(jd);
    const b = sunDirection(jd + 1);
    expect(angleBetween(a, b) * RAD).toBeCloseTo(0.9856, 1);
  });

  it('completes one full circuit per year', () => {
    const jd = isoToJd('2026-03-20T12:00:00Z');
    const a = sunDirection(jd);
    const b = sunDirection(jd + 365.2422);
    expect(angleBetween(a, b) * RAD).toBeLessThan(0.1);
  });
});

describe('lunar ephemeris', () => {
  it('keeps the Earth-Moon distance in the known range (series model)', () => {
    // Perigee ~356,500 km, apogee ~406,700 km.
    let min = Infinity;
    let max = -Infinity;
    for (let d = 0; d < 400; d += 0.25) {
      const r = norm(moonPosition(isoToJd('2026-01-01T00:00:00Z') + d, 'series'));
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    expect(min / 1000).toBeGreaterThan(355000);
    expect(min / 1000).toBeLessThan(362000);
    expect(max / 1000).toBeGreaterThan(403000);
    expect(max / 1000).toBeLessThan(408000);
  });

  it('holds the distance fixed in the circular model', () => {
    for (let d = 0; d < 60; d += 3) {
      const r = norm(moonPosition(isoToJd('2026-01-01T00:00:00Z') + d, 'circular'));
      expect(r).toBeCloseTo(MOON_SMA, 0);
    }
  });

  it('completes one revolution per sidereal month', () => {
    const jd = isoToJd('2026-01-01T00:00:00Z');
    const a = moonPosition(jd, 'series');
    const b = moonPosition(jd + 27.321661, 'series');
    // The lunar orbit is perturbed, so the direction repeats only approximately.
    expect(angleBetween(a, b) * RAD).toBeLessThan(3);
  });

  it('keeps the ecliptic latitude within the physical 5.30 degree limit', () => {
    // The lunar orbital inclination to the ecliptic oscillates between 5.00
    // and 5.30 degrees, so |beta| must peak just above 5.3 and never near 5.8.
    // This is the test that catches a sign error in the latitude series.
    const eps = OBLIQUITY_J2000;
    let maxLat = 0;
    for (let d = 0; d < 400; d += 0.5) {
      const p = moonPosition(isoToJd('2026-01-01T00:00:00Z') + d, 'series');
      // Equatorial -> ecliptic
      const yEcl = Math.cos(eps) * p[1] + Math.sin(eps) * p[2];
      const zEcl = -Math.sin(eps) * p[1] + Math.cos(eps) * p[2];
      const lat = Math.abs(Math.asin(zEcl / Math.hypot(p[0], yEcl, zEcl)) * RAD);
      maxLat = Math.max(maxLat, lat);
    }
    expect(maxLat).toBeGreaterThan(5.0);
    expect(maxLat).toBeLessThan(5.4);
  });

  it('gives a velocity consistent with the orbital speed', () => {
    // Mean lunar orbital speed is about 1.022 km/s.
    for (let d = 0; d < 30; d += 5) {
      const st = moonState(isoToJd('2026-01-01T00:00:00Z') + d, 'series');
      const speed = norm(st.velocity);
      expect(speed).toBeGreaterThan(900);
      expect(speed).toBeLessThan(1120);
    }
  });

  it('velocity is consistent with a finite difference of position', () => {
    const jd = isoToJd('2026-04-10T00:00:00Z');
    const st = moonState(jd, 'series');
    const dt = 600; // 10 minutes
    const p0 = moonPosition(jd - dt / 2 / 86400, 'series');
    const p1 = moonPosition(jd + dt / 2 / 86400, 'series');
    const vFd = scale(sub(p1, p0), 1 / dt);
    expect(angleBetween(st.velocity, vFd) * RAD).toBeLessThan(0.01);
    expect(Math.abs(norm(st.velocity) - norm(vFd)) / norm(vFd)).toBeLessThan(1e-4);
  });

  it('the two models agree to better than the documented circular error', () => {
    let maxDiff = 0;
    for (let d = 0; d < 60; d += 0.5) {
      const jd = isoToJd('2026-01-01T00:00:00Z') + d;
      const a = moonPosition(jd, 'series');
      const b = moonPosition(jd, 'circular');
      maxDiff = Math.max(maxDiff, norm(sub(a, b)));
    }
    // The circular model drops both the eccentricity (~21,000 km radially) and
    // the equation of the centre (~42,000 km along-track), so the total
    // disagreement reaches roughly 47,000 km - as documented on the model.
    expect(maxDiff / 1000).toBeLessThan(50000);
    expect(maxDiff / 1000).toBeGreaterThan(30000);
  });
});

describe('environment assembly', () => {
  const cfg = {
    epochJd: isoToJd('2026-03-20T12:00:00Z'),
    centre: 'earth' as const,
    moonModel: 'series' as const,
  };

  it('puts the Earth at the origin when Earth-centred', () => {
    const env = evaluateEnvironment(cfg, 0);
    expect(norm(env.earth.position)).toBe(0);
    expect(env.earth.isCentral).toBe(true);
    expect(env.muCentral).toBe(MU_EARTH);
    expect(norm(env.moon.position)).toBeGreaterThan(3.5e8);
    expect(norm(env.sun.position)).toBeGreaterThan(1.4e11);
  });

  it('puts the Moon at the origin when Moon-centred, preserving geometry', () => {
    const earthCentred = evaluateEnvironment(cfg, 0);
    const moonCentred = evaluateEnvironment({ ...cfg, centre: 'moon' }, 0);

    expect(norm(moonCentred.moon.position)).toBe(0);
    expect(moonCentred.muCentral).toBe(MU_MOON);

    // The Earth-Moon separation must be identical in both frames.
    const sepA = norm(sub(earthCentred.moon.position, earthCentred.earth.position));
    const sepB = norm(sub(moonCentred.moon.position, moonCentred.earth.position));
    expect(sepB).toBeCloseTo(sepA, 3);

    // And so must the Moon-Sun distance.
    const sunFromMoonA = norm(sub(earthCentred.sun.position, earthCentred.moon.position));
    const sunFromMoonB = norm(moonCentred.sun.position);
    expect(sunFromMoonB).toBeCloseTo(sunFromMoonA, 3);
  });

  it('computes the Sun-to-spacecraft vector', () => {
    const env = evaluateEnvironment(cfg, 0);
    const craft: Vec3 = [R_EARTH + 500e3, 0, 0];
    const u = sunToCraft(env, craft);
    // Magnitude is roughly 1 AU.
    expect(norm(u) / AU).toBeGreaterThan(0.98);
    expect(norm(u) / AU).toBeLessThan(1.02);
    // And it points from the Sun toward the spacecraft, i.e. opposite to the
    // Earth-to-Sun direction.
    expect(angleBetween(u, env.sun.position) * RAD).toBeGreaterThan(179);
  });
});

describe('gravity terms', () => {
  it('central gravity has the right magnitude and points inward', () => {
    const r: Vec3 = [R_EARTH, 0, 0];
    const a = centralGravity(r, MU_EARTH);
    // Surface gravity is about 9.798 m/s^2 for a point mass at the equatorial radius.
    expect(norm(a)).toBeCloseTo(MU_EARTH / R_EARTH ** 2, 6);
    expect(norm(a)).toBeCloseTo(9.798, 2);
    expect(a[0]).toBeLessThan(0); // inward
  });

  it('central gravity falls off as the inverse square', () => {
    const a1 = norm(centralGravity([7000e3, 0, 0], MU_EARTH));
    const a2 = norm(centralGravity([14000e3, 0, 0], MU_EARTH));
    expect(a1 / a2).toBeCloseTo(4, 10);
  });

  it('J2 is about 1e-3 of the central term in LEO', () => {
    const r: Vec3 = [0, 0, R_EARTH + 500e3]; // over the pole, where J2 is largest
    const ratio = norm(j2Earth(r, MU_EARTH)) / norm(centralGravity(r, MU_EARTH));
    expect(ratio).toBeGreaterThan(1e-3);
    expect(ratio).toBeLessThan(4e-3);
  });

  it('J2 vanishes on... nothing, but is smaller at the equator than the pole', () => {
    const eq: Vec3 = [R_EARTH + 500e3, 0, 0];
    const pole: Vec3 = [0, 0, R_EARTH + 500e3];
    expect(norm(j2Earth(pole, MU_EARTH))).toBeGreaterThan(norm(j2Earth(eq, MU_EARTH)));
  });

  it('third-body gravity vanishes at the central body', () => {
    // At r = 0 the direct and indirect terms cancel exactly - this is the
    // defining property of the formulation and the thing most easily got wrong.
    const s: Vec3 = [MOON_SMA, 0, 0];
    const a = thirdBodyGravity([0, 0, 0], s, MU_MOON);
    expect(norm(a)).toBeCloseTo(0, 12);
  });

  it('third-body gravity grows nearly linearly with distance from the centre', () => {
    // The leading tidal term is linear in r, but only for r << s. At
    // r = 14,000 km against s = 384,400 km the ratio r/s is 0.036 and the
    // next order in the expansion contributes a few percent, so the doubling
    // is approximate rather than exact.
    const s: Vec3 = [MOON_SMA, 0, 0];
    const a1 = norm(thirdBodyGravity([7000e3, 0, 0], s, MU_MOON));
    const a2 = norm(thirdBodyGravity([14000e3, 0, 0], s, MU_MOON));
    expect(a2 / a1).toBeGreaterThan(1.95);
    expect(a2 / a1).toBeLessThan(2.15);
  });

  it('lunar and solar perturbations have the expected relative size in LEO', () => {
    const r: Vec3 = [R_EARTH + 500e3, 0, 0];
    const central = norm(centralGravity(r, MU_EARTH));

    const moonAcc = norm(thirdBodyGravity(r, [MOON_SMA, 0, 0], MU_MOON));
    const sunAcc = norm(thirdBodyGravity(r, [AU, 0, 0], MU_SUN));

    // Both are tiny in LEO: roughly 1e-7 and 5e-8 of the central term.
    expect(moonAcc / central).toBeLessThan(1e-6);
    expect(moonAcc / central).toBeGreaterThan(1e-8);
    expect(sunAcc / central).toBeLessThan(1e-6);
    // Lunar tidal forcing at Earth is about twice solar.
    expect(moonAcc / sunAcc).toBeGreaterThan(1.5);
    expect(moonAcc / sunAcc).toBeLessThan(3);
  });

  it('lunar perturbation is far more significant at GEO than in LEO', () => {
    const leo: Vec3 = [R_EARTH + 500e3, 0, 0];
    const geo: Vec3 = [42164e3, 0, 0];
    const s: Vec3 = [MOON_SMA, 0, 0];

    const leoRatio =
      norm(thirdBodyGravity(leo, s, MU_MOON)) / norm(centralGravity(leo, MU_EARTH));
    const geoRatio =
      norm(thirdBodyGravity(geo, s, MU_MOON)) / norm(centralGravity(geo, MU_EARTH));

    // Tidal acceleration grows as r while central gravity falls as 1/r^2, so
    // the ratio grows as r^3: (42164/6878)^3 = 230.
    expect(geoRatio / leoRatio).toBeGreaterThan(100);
  });
});
