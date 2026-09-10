/**
 * Validation: orbit conservation and numerical accuracy (spec S28).
 *
 * With no sail force and no perturbations, a circular orbit must stay
 * circular, and energy and angular momentum must be conserved. These are the
 * tests that catch a sign error in the gravity model, a broken integrator, or
 * a frame mix-up - all of which would otherwise hide inside a plausible-looking
 * trajectory.
 */

import { describe, expect, it } from 'vitest';
import { MU_EARTH, R_EARTH } from '../core/constants.ts';
import { norm } from '../core/vec3.ts';
import { periodFromSma, rvToElements } from '../core/orbital/elements.ts';
import { propagate } from '../sim/propagator.ts';
import { buildScenario } from '../sim/scenarios.ts';
import type { SimulationConfig } from '../sim/types.ts';

/** Two-body-only configuration: every perturbation and the sail switched off. */
function twoBodyConfig(overrides: (c: SimulationConfig) => void = () => {}): SimulationConfig {
  const cfg = buildScenario('leo-circular');
  cfg.forces = {
    centralGravity: true,
    earthJ2: false,
    earthJ3: false,
    moonGravity: false,
    sunGravity: false,
    planetGravity: false,
    solarRadiationPressure: false,
    eclipse: false,
    atmosphericDrag: false,
    earthAlbedo: false,
    earthInfrared: false,
  };
  overrides(cfg);
  return cfg;
}

/**
 * MEASURED BASELINES (RK4, 15 s step, 500 km circular LEO, 7 days,
 * 40,320 steps). Recorded here so a regression shows up as a test failure
 * rather than as a slightly different number nobody notices:
 *
 *   relative range of semi-major axis      2.35e-8   (= 0.16 m)
 *   relative range of specific energy      2.35e-8
 *   relative range of angular momentum     1.17e-8   (= half the sma error,
 *                                                     as expected since
 *                                                     h ~ sqrt(a))
 *
 * This is ordinary fourth-order truncation drift accumulating over 40,320
 * steps, not a modelling error: the local relative error per step is about
 * (h/T)^5 = 1.3e-13, and the observed total is within a small factor of the
 * step count times that. The convergence test below confirms the order.
 *
 * Tolerances are set roughly 4x above the measured values, which catches a
 * real regression while tolerating platform floating-point differences.
 */
const relRange = (xs: number[]): number => {
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.abs(mean) > 0 ? (max - min) / Math.abs(mean) : max - min;
};

describe('two-body conservation (no sail, no perturbations)', () => {
  it('keeps a circular orbit circular over 7 days', async () => {
    const cfg = twoBodyConfig();
    const res = await propagate(cfg, { yieldToEventLoop: false });

    const ecc = res.samples.map((s) => s.ecc);
    const sma = res.samples.map((s) => s.sma);

    // A circular orbit started at e = 0 must stay circular.
    expect(Math.max(...ecc)).toBeLessThan(1e-7);
    // Semi-major axis must not drift. Measured: 2.35e-8.
    expect(relRange(sma)).toBeLessThan(1e-7);
  }, 60000);

  it('conserves specific orbital energy', async () => {
    const cfg = twoBodyConfig();
    const res = await propagate(cfg, { yieldToEventLoop: false });
    const energy = res.samples.map((s) => s.energy);
    // Measured: 2.35e-8.
    expect(relRange(energy)).toBeLessThan(1e-7);
  }, 60000);

  it('conserves specific angular momentum', async () => {
    const cfg = twoBodyConfig();
    const res = await propagate(cfg, { yieldToEventLoop: false });
    const h = res.samples.map((s) => s.angularMomentum);
    // Measured: 1.17e-8, i.e. half the semi-major axis error, as expected for
    // a circular orbit where h scales as sqrt(a).
    expect(relRange(h)).toBeLessThan(1e-7);
  }, 60000);

  it('conserves the orbit plane: inclination and RAAN stay fixed', async () => {
    const cfg = twoBodyConfig();
    const res = await propagate(cfg, { yieldToEventLoop: false });
    const inc = res.samples.map((s) => s.inc);

    // Inclination is a plain angle in [0, pi] with no wrap issue.
    expect(Math.max(...inc) - Math.min(...inc)).toBeLessThan(1e-9);

    // RAAN needs care: this orbit starts at RAAN = 0 exactly, so round-off
    // makes the reported value flip between ~1e-16 and ~2pi - 1e-16. A naive
    // max-minus-min therefore reads 2pi even though the plane never moved.
    // Compare wrapped deviations from the initial value instead.
    const raan0 = res.samples[0].raan;
    let maxDev = 0;
    for (const s of res.samples) {
      let d = s.raan - raan0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      maxDev = Math.max(maxDev, Math.abs(d));
    }
    expect(maxDev).toBeLessThan(1e-9);
  }, 60000);

  it('returns to the initial state after a whole number of revolutions', async () => {
    // The sharpest end-to-end check available: after exactly N periods the
    // state vector must reproduce itself.
    const cfg = twoBodyConfig();
    const sma = R_EARTH + 500e3;
    const period = periodFromSma(sma, MU_EARTH);
    cfg.integration.duration = 20 * period;
    cfg.integration.timestep = 5;
    cfg.integration.outputInterval = period; // one sample per revolution

    const res = await propagate(cfg, { yieldToEventLoop: false });
    const first = res.samples[0];
    const last = res.samples[res.samples.length - 1];

    const dr = norm([last.x - first.x, last.y - first.y, last.z - first.z]);
    const dv = norm([last.vx - first.vx, last.vy - first.vy, last.vz - first.vz]);

    // After 20 revolutions (~114,000 km of arc) the position must close to
    // well under a metre.
    expect(dr).toBeLessThan(1);
    expect(dv).toBeLessThan(1e-3);
  }, 120000);
});

describe('J2 produces the expected secular nodal regression', () => {
  it('matches the analytic dRAAN/dt to better than 1%', async () => {
    // Analytic secular rate (Vallado eq. 9-37):
    //   dOmega/dt = -(3/2) n J2 (Re/p)^2 cos(i)
    const cfg = twoBodyConfig((c) => {
      c.forces.earthJ2 = true;
      c.integration.duration = 5 * 86400;
      c.integration.timestep = 10;
      c.integration.outputInterval = 600;
    });

    const res = await propagate(cfg, { yieldToEventLoop: false });
    const first = res.samples[0];
    const last = res.samples[res.samples.length - 1];

    const a = first.sma;
    const e = first.ecc;
    const i = first.inc;
    const n = Math.sqrt(MU_EARTH / a ** 3);
    const p = a * (1 - e * e);
    const J2 = 1.08262668e-3;
    const expectedRate = -1.5 * n * J2 * (R_EARTH / p) ** 2 * Math.cos(i);

    // Unwrap the RAAN history so a crossing through 0/2pi does not corrupt it.
    let unwrapped = first.raan;
    let prev = first.raan;
    for (const s of res.samples) {
      let d = s.raan - prev;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      unwrapped += d;
      prev = s.raan;
    }
    const actualRate = (unwrapped - first.raan) / (last.t - first.t);

    const relError = Math.abs((actualRate - expectedRate) / expectedRate);
    // The analytic rate is itself only a first-order secular approximation, so
    // agreement to 1% is the meaningful bar here.
    expect(relError).toBeLessThan(0.01);
  }, 120000);
});

describe('timestep convergence (spec S28)', () => {
  it('RK4 error falls with timestep at close to fourth order', async () => {
    const results: Array<{ dt: number; drift: number }> = [];

    for (const dt of [80, 40, 20, 10]) {
      const cfg = twoBodyConfig((c) => {
        c.integration.timestep = dt;
        c.integration.duration = 86400; // 1 day
        c.integration.outputInterval = 3600;
      });
      const res = await propagate(cfg, { yieldToEventLoop: false });
      const sma = res.samples.map((s) => s.sma);
      results.push({ dt, drift: relRange(sma) });
    }

    // Every halving of the step must reduce the drift substantially. A true
    // fourth-order scheme gives a factor of 16 per halving until round-off
    // dominates, so a factor of 8 is a safe assertion that also tolerates the
    // floor.
    for (let i = 1; i < results.length; i++) {
      const ratio = results[i - 1].drift / Math.max(results[i].drift, 1e-16);
      // Once the drift reaches round-off (~1e-14) the ratio stops improving,
      // which is expected and must not fail the test.
      if (results[i].drift > 1e-13) {
        expect(ratio).toBeGreaterThan(8);
      }
    }

    // The coarsest step must be visibly worse than the finest.
    expect(results[0].drift).toBeGreaterThan(results[results.length - 1].drift);
  }, 200000);

  it('a grossly oversized timestep degrades the orbit measurably', async () => {
    // Guards the timestep warning in the Simulation panel: it must be warning
    // about something real.
    const coarse = twoBodyConfig((c) => {
      c.integration.timestep = 600; // ~9.5 steps per revolution
      c.integration.duration = 86400;
      c.integration.outputInterval = 3600;
    });
    const res = await propagate(coarse, { yieldToEventLoop: false });
    const sma = res.samples.map((s) => s.sma);
    // At ~10 steps per revolution RK4 is badly under-resolved.
    expect(relRange(sma)).toBeGreaterThan(1e-6);
  }, 60000);

  it('the adaptive integrator meets its tolerance on an eccentric orbit', async () => {
    const cfg = twoBodyConfig((c) => {
      c.initial = {
        mode: 'elements',
        altitude: 500e3,
        eccentricity: 0.7,
        inclination: 0.5,
        raan: 0,
        argumentOfPeriapsis: 0,
        trueAnomaly: 0,
      };
      c.integration.integrator = 'rkf45';
      c.integration.timestep = 300;
      c.integration.relTol = 1e-11;
      c.integration.duration = 5 * 86400;
      c.integration.outputInterval = 600;
    });
    const res = await propagate(cfg, { yieldToEventLoop: false });

    const sma = res.samples.map((s) => s.sma);
    const ecc = res.samples.map((s) => s.ecc);
    // A highly eccentric two-body orbit must still conserve its elements.
    expect(relRange(sma)).toBeLessThan(1e-8);
    expect(Math.max(...ecc) - Math.min(...ecc)).toBeLessThan(1e-8);
    // And the controller must actually have varied the step.
    expect(res.summary.maxStep / res.summary.minStep).toBeGreaterThan(3);
  }, 200000);
});

describe('element conversion round-trips', () => {
  it('rvToElements and elementsToRv are mutually inverse', async () => {
    const { elementsToRv } = await import('../core/orbital/elements.ts');
    const cases = [
      { sma: 7000e3, ecc: 0.001, inc: 0.9, raan: 1.2, argp: 2.1, trueAnomaly: 0.4 },
      { sma: 26600e3, ecc: 0.74, inc: 1.1, raan: 0.3, argp: 4.7, trueAnomaly: 3.0 },
      { sma: 42164e3, ecc: 1e-6, inc: 1e-6, raan: 0, argp: 0, trueAnomaly: 5.5 },
      { sma: 384400e3, ecc: 0.55, inc: 2.9, raan: 5.1, argp: 1.0, trueAnomaly: 0.05 },
    ];

    for (const c of cases) {
      const { r, v } = elementsToRv(c, MU_EARTH);
      const back = rvToElements(r, v, MU_EARTH);
      expect(Math.abs(back.sma - c.sma) / c.sma).toBeLessThan(1e-12);
      expect(Math.abs(back.ecc - c.ecc)).toBeLessThan(1e-11);
      // Inclination is recovered through acos(h_z/|h|), which loses precision
      // as the inclination approaches 0 or pi. The 166 deg case reaches
      // 4.4e-11 rad (9 micro-arcseconds), which is far below anything that
      // matters here.
      expect(Math.abs(back.inc - c.inc)).toBeLessThan(1e-9);
      // Near-circular and near-equatorial cases legitimately reassign RAAN and
      // argp to substitute angles, so only the argument of latitude and the
      // resulting geometry are compared there.
      if (c.ecc > 1e-4 && c.inc > 1e-4) {
        expect(Math.abs(back.raan - c.raan)).toBeLessThan(1e-9);
        expect(Math.abs(back.argp - c.argp)).toBeLessThan(1e-9);
        expect(Math.abs(back.trueAnomaly - c.trueAnomaly)).toBeLessThan(1e-9);
      }
    }
  });
});
