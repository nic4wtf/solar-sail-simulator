/**
 * Validation: planetary ephemerides, the heliocentric frame, and the sail
 * physics that only appears once the Sun is the central body.
 *
 * The independent references here are astronomy and analysis, never the code:
 * published semi-major axes and orbital periods, Kepler's third law, the
 * obliquity of the ecliptic, and the analytic beta = 0.5 escape threshold for
 * a Sun-facing sail. A planetary ephemeris that is wrong by a degree still
 * produces a perfectly plausible-looking spiral, so plausibility is worth
 * nothing as a check.
 */

import { describe, expect, it } from 'vitest';
import {
  AU,
  MU_SUN,
  OBLIQUITY_J2000,
  R_SUN,
  SEC_PER_DAY,
} from '../core/constants.ts';
import { type Vec3, cross, dot, norm, sub, unit } from '../core/vec3.ts';
import {
  PLANET_FACTS,
  PLANET_IDS,
  type PlanetId,
  earthHeliocentric,
  planetElements,
  planetPeriod,
  planetState,
  synodicPeriod,
} from '../core/environment/planets.ts';
import { evaluateEnvironment } from '../core/environment/environment.ts';
import { isoToJd } from '../core/environment/time.ts';
import { IDEAL_SAIL, sailPerformance, pressure1Au } from '../core/sail/sail.ts';
import { buildScenario } from '../sim/scenarios.ts';
import { propagate } from '../sim/propagator.ts';
import type { SimulationConfig } from '../sim/types.ts';

const J2000 = 2451545.0;
const YEAR = 365.25 * SEC_PER_DAY;

// ---------------------------------------------------------------------------
// Planetary ephemerides
// ---------------------------------------------------------------------------

describe('planetary ephemerides', () => {
  /**
   * Published values (IAU / JPL fact sheets). These are the independent
   * reference: semi-major axis in AU, sidereal period in Julian years, and
   * inclination to the ECLIPTIC in degrees.
   */
  const PUBLISHED: Record<PlanetId, { sma: number; periodYears: number; incDeg: number }> = {
    mercury: { sma: 0.38710, periodYears: 0.2408, incDeg: 7.005 },
    venus: { sma: 0.72333, periodYears: 0.6152, incDeg: 3.395 },
    earth: { sma: 1.00000, periodYears: 1.0000, incDeg: 0.0 },
    mars: { sma: 1.52371, periodYears: 1.8808, incDeg: 1.850 },
    jupiter: { sma: 5.20289, periodYears: 11.862, incDeg: 1.304 },
    saturn: { sma: 9.53667, periodYears: 29.457, incDeg: 2.486 },
    uranus: { sma: 19.1892, periodYears: 84.011, incDeg: 0.773 },
    neptune: { sma: 30.0699, periodYears: 164.79, incDeg: 1.770 },
  };

  it.each(PLANET_IDS.map((id) => [id] as const))(
    '%s: semi-major axis matches the published value',
    (id) => {
      const a = planetElements(id, J2000).sma / AU;
      expect(a / PUBLISHED[id].sma).toBeGreaterThan(0.999);
      expect(a / PUBLISHED[id].sma).toBeLessThan(1.001);
    },
  );

  it.each(PLANET_IDS.map((id) => [id] as const))(
    '%s: sidereal period matches the published value',
    (id) => {
      const years = planetPeriod(id) / YEAR;
      expect(years / PUBLISHED[id].periodYears).toBeGreaterThan(0.998);
      expect(years / PUBLISHED[id].periodYears).toBeLessThan(1.002);
    },
  );

  it.each(PLANET_IDS.map((id) => [id] as const))(
    '%s: obeys Kepler third law against the solar GM',
    (id) => {
      // a^3 / P^2 = mu / (4 pi^2), exactly, for every planet. Independent of
      // any published table: it ties the elements to the gravitational
      // parameter the propagator will actually integrate with.
      const a = planetElements(id, J2000).sma;
      const p = planetPeriod(id);
      expect((a ** 3 / p ** 2 / (MU_SUN / (4 * Math.PI ** 2))) - 1).toBeCloseTo(0, 10);
    },
  );

  it.each(PLANET_IDS.map((id) => [id] as const))(
    '%s: stays between perihelion and aphelion over a century',
    (id) => {
      const el = planetElements(id, J2000);
      const peri = (el.sma * (1 - el.ecc)) / AU;
      const apo = (el.sma * (1 + el.ecc)) / AU;
      for (let year = 1950; year <= 2050; year += 5) {
        const jd = J2000 + (year - 2000) * 365.25;
        const r = planetState(id, jd).distance / AU;
        expect(r, `${id} at ${year}`).toBeGreaterThan(peri * 0.99);
        expect(r, `${id} at ${year}`).toBeLessThan(apo * 1.01);
      }
    },
  );

  it.each(PLANET_IDS.map((id) => [id] as const))('%s: speed obeys vis-viva', (id) => {
    const st = planetState(id, J2000);
    const el = planetElements(id, J2000);
    const expected = Math.sqrt(MU_SUN * (2 / st.distance - 1 / el.sma));
    expect(norm(st.velocity) / expected).toBeCloseTo(1, 9);
  });

  it('returns positions in EQUATORIAL axes, not ecliptic', () => {
    // The Earth's orbit normal must sit 23.44 degrees from the J2000 pole.
    // If the ecliptic-to-equatorial rotation were dropped, this would be 0 -
    // and every trajectory would still look completely reasonable.
    const st = planetState('earth', J2000);
    const h = unit(cross(st.position, st.velocity));
    const tilt = Math.acos(Math.abs(dot(h, [0, 0, 1])));
    expect(tilt).toBeCloseTo(OBLIQUITY_J2000, 3);
  });

  it.each(PLANET_IDS.map((id) => [id] as const))(
    '%s: orbit plane is close to the ecliptic',
    (id) => {
      const st = planetState(id, J2000);
      const h = unit(cross(st.position, st.velocity));
      // Ecliptic pole in equatorial axes.
      const eclipticPole: Vec3 = [0, -Math.sin(OBLIQUITY_J2000), Math.cos(OBLIQUITY_J2000)];
      const incDeg = (Math.acos(Math.abs(dot(h, eclipticPole))) * 180) / Math.PI;
      expect(incDeg).toBeCloseTo(PLANET_FACTS[id].id === 'earth' ? 0 : PUBLISHED[id].incDeg, 1);
    },
  );

  it('agrees with the solar series on where the Earth is', () => {
    // The environment takes the Earth from `sun.ts` rather than from this
    // table, so that the same Earth is used in every frame. This bounds the
    // disagreement that choice accepts, rather than hiding it.
    //
    // The two differ for two reasons: the table row is the Earth-MOON
    // BARYCENTRE (up to 4700 km away), and the solar series is a truncated
    // low-precision one (~0.01 deg, or 26,000 km at 1 AU).
    let worst = 0;
    for (let year = 2000; year <= 2050; year += 2) {
      const jd = J2000 + (year - 2000) * 365.25;
      const gap = norm(sub(planetState('earth', jd).position, earthHeliocentric(jd).position));
      worst = Math.max(worst, gap);
    }
    expect(worst).toBeLessThan(60_000e3);
    // And it must be a real agreement, not two copies of the same function.
    expect(worst).toBeGreaterThan(1e3);
  });

  it('reproduces the Earth perihelion and aphelion distances and dates', () => {
    // Perihelion in early January at 0.9833 AU, aphelion in early July at
    // 1.0167 AU. Both are facts about the sky, not about this code.
    let minR = Infinity;
    let maxR = 0;
    let minDay = 0;
    let maxDay = 0;
    const jan1 = isoToJd('2026-01-01T00:00:00Z');
    for (let d = 0; d < 365; d++) {
      const r = earthHeliocentric(jan1 + d).distance / AU;
      if (r < minR) {
        minR = r;
        minDay = d;
      }
      if (r > maxR) {
        maxR = r;
        maxDay = d;
      }
    }
    expect(minR).toBeCloseTo(0.9833, 3);
    expect(maxR).toBeCloseTo(1.0167, 3);
    expect(minDay).toBeLessThan(10); // early January
    expect(maxDay).toBeGreaterThan(175); // early July
    expect(maxDay).toBeLessThan(195);
  });

  it('gives the published synodic periods', () => {
    // Earth-Mars 779.9 days, Earth-Venus 583.9 days. These set the launch
    // window spacing the Mission panel quotes.
    expect(synodicPeriod('earth', 'mars') / SEC_PER_DAY).toBeCloseTo(779.9, 0);
    expect(synodicPeriod('earth', 'venus') / SEC_PER_DAY).toBeCloseTo(583.9, 0);
  });
});

// ---------------------------------------------------------------------------
// The heliocentric frame
// ---------------------------------------------------------------------------

describe('heliocentric environment', () => {
  const epochJd = isoToJd('2026-03-20T12:00:00Z');

  it('puts the Sun at the origin and the Earth at 1 AU', () => {
    const env = evaluateEnvironment({ epochJd, centre: 'sun', moonModel: 'series' }, 0);
    expect(norm(env.sun.position)).toBe(0);
    expect(env.sun.isCentral).toBe(true);
    expect(env.muCentral).toBe(MU_SUN);
    expect(env.radiusCentral).toBe(R_SUN);
    expect(norm(env.earth.position) / AU).toBeCloseTo(1, 1);
  });

  it('keeps the Moon beside the Earth, not at the origin', () => {
    const env = evaluateEnvironment({ epochJd, centre: 'sun', moonModel: 'series' }, 0);
    const gap = norm(sub(env.moon.position, env.earth.position));
    // One lunar distance, give or take the lunar eccentricity.
    expect(gap).toBeGreaterThan(3.5e8);
    expect(gap).toBeLessThan(4.1e8);
  });

  it('expresses planets in whichever frame is in force', () => {
    // The same planet, seen from the Sun and from the Earth, must differ by
    // exactly the Sun -> Earth vector. This is the frame-shift arithmetic
    // that a heliocentric mode is most likely to get quietly wrong.
    const helio = evaluateEnvironment(
      { epochJd, centre: 'sun', moonModel: 'series', planets: ['mars'] },
      0,
    );
    const geo = evaluateEnvironment(
      { epochJd, centre: 'earth', moonModel: 'series', planets: ['mars'] },
      0,
    );
    const shift = sub(helio.planets[0].position, geo.planets[0].position);
    // helio - geo should equal (Sun -> Earth) = -(Earth -> Sun).
    const sunToEarth = helio.earth.position;
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(shift[k] - sunToEarth[k]) / AU).toBeLessThan(1e-9);
    }
  });

  it('computes no planets unless asked', () => {
    const env = evaluateEnvironment({ epochJd, centre: 'sun', moonModel: 'series' }, 0);
    expect(env.planets).toEqual([]);
  });

  it('never lists the Earth among the perturbing planets', () => {
    // The Earth is always `env.earth`, from the solar series. Listing it
    // again would double its gravity.
    const env = evaluateEnvironment(
      { epochJd, centre: 'sun', moonModel: 'series', planets: ['earth', 'mars'] },
      0,
    );
    expect(env.planets.map((p) => p.name)).toEqual(['Mars']);
  });
});

// ---------------------------------------------------------------------------
// Heliocentric propagation
// ---------------------------------------------------------------------------

/** A clean two-body heliocentric configuration with no sail and no planets. */
function twoBodyHeliocentric(overrides: (c: SimulationConfig) => void = () => {}) {
  const cfg = buildScenario('helio-cruise');
  cfg.forces.planetGravity = false;
  cfg.forces.moonGravity = false;
  cfg.forces.solarRadiationPressure = false;
  cfg.forces.eclipse = false;
  cfg.perturbingPlanets = [];
  overrides(cfg);
  return cfg;
}

describe('heliocentric propagation', () => {
  it('conserves the semi-major axis of a 1 AU orbit over a year', async () => {
    const res = await propagate(twoBodyHeliocentric(), { yieldToEventLoop: false });
    const first = res.samples[0];
    const last = res.samples[res.samples.length - 1];
    // The same conservation check the geocentric suite applies, at a scale
    // 24,000 times larger. If the frame switch had broken anything
    // structurally, this is where it would show.
    expect(Math.abs(last.sma - first.sma) / first.sma).toBeLessThan(1e-10);
    expect(Math.abs(last.energy - first.energy) / Math.abs(first.energy)).toBeLessThan(1e-10);
    expect(res.summary.deltaVEquivalent).toBe(0);
  }, 120000);

  it('reports solar distance as the radius from the origin', async () => {
    const res = await propagate(twoBodyHeliocentric(), { yieldToEventLoop: false });
    for (const s of res.samples) {
      // With the Sun at the origin, `sunDistance` and `radius` are the same
      // quantity - which is exactly why `pressureAt` needed no change.
      expect(Math.abs(s.sunDistance - s.radius) / s.radius).toBeLessThan(1e-12);
    }
    expect(res.summary.minSolarDistance / AU).toBeGreaterThan(0.95);
    expect(res.summary.maxSolarDistance / AU).toBeLessThan(1.05);
  }, 120000);

  it('never applies drag, J2 or J3 about the Sun', async () => {
    const cfg = twoBodyHeliocentric((c) => {
      c.forces.atmosphericDrag = true;
      c.forces.earthJ2 = true;
      c.forces.earthJ3 = true;
    });
    const res = await propagate(cfg, { yieldToEventLoop: false });
    expect(res.summary.dragDeltaVEquivalent).toBe(0);
    for (const s of res.samples) expect(s.dragAccel).toBe(0);
    // And the orbit is still the clean two-body one.
    const first = res.samples[0];
    const last = res.samples[res.samples.length - 1];
    expect(Math.abs(last.sma - first.sma) / first.sma).toBeLessThan(1e-10);
  }, 120000);

  it('scales the sail acceleration as 1/r^2 across the trajectory', async () => {
    const res = await propagate(buildScenario('helio-solar-pass'), {
      yieldToEventLoop: false,
    });
    // Pick the sunlit samples where the sail is actually producing force, and
    // check that a * r^2 is constant to within the incidence-angle variation.
    const lit = res.samples.filter((s) => s.sailAccel > 0 && s.illumination > 0.99);
    expect(lit.length).toBeGreaterThan(100);
    const pressures = lit.map((s) => s.pressure * (s.sunDistance / AU) ** 2);
    const p0 = pressures[0];
    for (const p of pressures) {
      // Pressure is a pure 1/r^2 law: once scaled by r^2 it must be constant
      // exactly, independent of attitude.
      expect(Math.abs(p - p0) / p0).toBeLessThan(1e-9);
    }
    // And the pass really did cover a wide range of solar distance.
    expect(res.summary.maxSolarDistance / res.summary.minSolarDistance).toBeGreaterThan(5);
  }, 200000);
});

// ---------------------------------------------------------------------------
// The lightness number, which only means anything out here
// ---------------------------------------------------------------------------

describe('lightness number escape threshold', () => {
  /**
   * Build a circular 1 AU orbit carrying a Sun-facing sail of exactly the
   * requested lightness number.
   *
   * The analytic result being tested: a sail held normal to the Sun line
   * reduces the effective gravitational parameter to mu(1 - beta), because
   * both the sail force and solar gravity are radial and both fall off as
   * 1/r^2. A spacecraft on a circular orbit has v^2 = mu/r, and escapes the
   * reduced field when v^2 >= 2 mu(1 - beta)/r - that is, when beta >= 0.5.
   *
   * This is the cleanest possible check of the heliocentric mode: it ties the
   * ephemeris, the frame, the SRP law, the attitude frame and the integrator
   * together against one number that can be derived on paper.
   */
  function betaConfig(beta: number, days: number): SimulationConfig {
    const cfg = buildScenario('helio-custom');
    cfg.forces.planetGravity = false;
    cfg.forces.moonGravity = false;
    cfg.forces.eclipse = false;
    cfg.perturbingPlanets = [];
    cfg.targetBody = undefined;

    // Ideal sail: force coefficient exactly 2, so beta is exact.
    cfg.sail = { ...IDEAL_SAIL, area: 1 };
    cfg.spacecraft = { ...cfg.spacecraft, dryMass: 1, propellantMass: 0 };
    // beta = k P0 A / (m * mu_sun / AU^2), with k = 2 for an ideal sail.
    const solarGravity1Au = MU_SUN / AU ** 2;
    cfg.sail.area = (beta * cfg.spacecraft.dryMass * solarGravity1Au) / (2 * pressure1Au(cfg.sail));

    // Circular orbit at exactly 1 AU, Sun-facing sail.
    cfg.initial = {
      mode: 'elements',
      altitude: AU - R_SUN,
      eccentricity: 0,
      inclination: 0,
      raan: 0,
      argumentOfPeriapsis: 0,
      trueAnomaly: 0,
    };
    cfg.attitude = { kind: 'sunRelative', cone: 0, clock: 0 };
    cfg.integration.duration = days * SEC_PER_DAY;
    cfg.integration.outputInterval = (days * SEC_PER_DAY) / 2000;
    return cfg;
  }

  it('builds a configuration with the beta it was asked for', () => {
    for (const beta of [0.3, 0.7]) {
      const cfg = betaConfig(beta, 10);
      expect(sailPerformance(cfg.sail, cfg.spacecraft).lightnessNumber).toBeCloseTo(beta, 9);
    }
  });

  it('escapes when beta is above 0.5', async () => {
    const res = await propagate(betaConfig(0.7, 1200), { yieldToEventLoop: false });
    const last = res.samples[res.samples.length - 1];
    expect(last.energy).toBeGreaterThan(0);
    expect(res.summary.escaped).toBe(true);
    expect(res.summary.maxSolarDistance / AU).toBeGreaterThan(5);
  }, 200000);

  it('stays bound when beta is below 0.5, at the analytic apoapsis', async () => {
    // In the reduced field the orbit is an ellipse with periapsis at 1 AU and
    //   a' = r (1 - beta) / (1 - 2 beta)
    // so for beta = 0.3, a' = 1.75 AU and apoapsis = 2 a' - r = 2.5 AU.
    const beta = 0.3;
    const res = await propagate(betaConfig(beta, 1500), { yieldToEventLoop: false });
    expect(res.summary.escaped).toBe(false);

    const predictedApoapsis = (2 * (1 - beta)) / (1 - 2 * beta) - 1;
    expect(res.summary.maxSolarDistance / AU).toBeCloseTo(predictedApoapsis, 1);
    // And it comes back: a bounded orbit, not a slow escape.
    expect(res.summary.minSolarDistance / AU).toBeCloseTo(1, 2);
  }, 200000);
});

// ---------------------------------------------------------------------------
// Scenario-level behaviour
// ---------------------------------------------------------------------------

describe('interplanetary scenarios', () => {
  const shorten = (cfg: SimulationConfig, days: number) => {
    cfg.integration.duration = Math.min(cfg.integration.duration, days * SEC_PER_DAY);
    cfg.integration.outputInterval = Math.max(600, cfg.integration.duration / 800);
    return cfg;
  };

  it('spirals outward under prograde steering and inward under retrograde', async () => {
    const out = await propagate(shorten(buildScenario('helio-mars'), 200), {
      yieldToEventLoop: false,
    });
    const inward = await propagate(shorten(buildScenario('helio-venus'), 200), {
      yieldToEventLoop: false,
    });

    expect(out.summary.finalSma).toBeGreaterThan(out.summary.initialSma);
    expect(inward.summary.finalSma).toBeLessThan(inward.summary.initialSma);
    // Prograde adds energy, retrograde removes it. Both are the sail: no
    // propellant is expended either way, which is the point.
    expect(out.summary.finalEnergy).toBeGreaterThan(out.summary.initialEnergy);
    expect(inward.summary.finalEnergy).toBeLessThan(inward.summary.initialEnergy);
  }, 300000);

  it('reaches the orbital radius of Mars without reaching Mars', async () => {
    // The honest outcome of an unphased departure, and the thing the Results
    // panel is careful to report as two separate facts.
    const res = await propagate(buildScenario('helio-mars'), { yieldToEventLoop: false });
    const marsSma = planetElements('mars', J2000).sma;
    expect(res.summary.maxSolarDistance).toBeGreaterThan(marsSma);
    expect(res.summary.enteredTargetSoi).toBe(false);
    expect(res.summary.minTargetDistance / AU).toBeGreaterThan(0.1);
  }, 300000);

  it('escapes the solar system on the escape scenario', async () => {
    const res = await propagate(buildScenario('helio-escape'), { yieldToEventLoop: false });
    expect(res.summary.escaped).toBe(true);
    expect(res.summary.finalEnergy).toBeGreaterThan(0);
    // beta = 0.50 by construction - the analytic threshold.
    const cfg = buildScenario('helio-escape');
    expect(sailPerformance(cfg.sail, cfg.spacecraft).lightnessNumber).toBeCloseTo(0.5, 1);
  }, 300000);

  it('turns a bound sail into an escaping one via a close solar pass', async () => {
    // The Oberth-like result: the same sail that cannot escape from 1 AU
    // escapes easily after falling in, because the pressure it works with
    // grows as 1/r^2.
    const pass = buildScenario('helio-solar-pass');
    const beta = sailPerformance(pass.sail, pass.spacecraft).lightnessNumber;
    expect(beta).toBeLessThan(0.5); // could not escape from a circular 1 AU orbit

    const res = await propagate(pass, { yieldToEventLoop: false });
    expect(res.summary.minSolarDistance / R_SUN).toBeLessThan(30);
    expect(res.summary.minSolarDistance / R_SUN).toBeGreaterThan(5);
    expect(res.summary.escaped).toBe(true);
  }, 300000);

  it('holds the cruise baseline flat, so any later change is attributable', async () => {
    const res = await propagate(buildScenario('helio-cruise'), { yieldToEventLoop: false });
    const first = res.samples[0];
    const last = res.samples[res.samples.length - 1];
    expect(Math.abs(last.sma - first.sma) / first.sma).toBeLessThan(1e-10);
    expect(res.summary.deltaVEquivalent).toBe(0);
    expect(res.summary.escaped).toBe(false);
  }, 120000);

  it('records target distance on every sample when a target is set', async () => {
    const res = await propagate(shorten(buildScenario('helio-venus'), 100), {
      yieldToEventLoop: false,
    });
    let observedMin = Infinity;
    for (const s of res.samples) {
      expect(Number.isFinite(s.targetDistance)).toBe(true);
      expect(s.targetDistance).toBeGreaterThan(0);
      observedMin = Math.min(observedMin, s.targetDistance);
    }
    expect(res.summary.minTargetDistance).toBeCloseTo(observedMin, 0);
  }, 200000);

  it('leaves the target distance infinite when no target is set', async () => {
    const cfg = shorten(buildScenario('helio-cruise'), 60);
    expect(cfg.targetBody).toBeUndefined();
    const res = await propagate(cfg, { yieldToEventLoop: false });
    for (const s of res.samples) expect(s.targetDistance).toBe(Infinity);
    expect(res.summary.enteredTargetSoi).toBe(false);
  }, 120000);
});
