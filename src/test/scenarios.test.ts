/**
 * Validation: every shipped scenario and preset must run and produce a
 * physically sensible result.
 *
 * This is the integration-level safety net. It is what catches a scenario
 * whose initial conditions were mis-specified, a preset that immediately
 * re-enters, or a lunar transfer that quietly misses by a million kilometres.
 */

import { describe, expect, it } from 'vitest';
import { MOON_SOI_RADIUS, R_EARTH, SEC_PER_DAY } from '../core/constants.ts';
import { SCENARIOS, aimAtMoon, buildScenario } from '../sim/scenarios.ts';
import { PRESETS } from '../sim/presets.ts';
import { propagate } from '../sim/propagator.ts';
import { feasibilityReport } from '../sim/analysis.ts';
import { configFromJson, configToJson, trajectoryToCsv } from '../sim/exportData.ts';
import { runSweep } from '../sim/sensitivity.ts';

const runnable = SCENARIOS.filter((s) => !s.future && s.build);

describe('every scenario builds and propagates', () => {
  it.each(runnable.map((s) => [s.id] as const))('%s', async (id) => {
    const cfg = buildScenario(id);
    // Cap the duration so the suite stays fast; the physics is unchanged.
    cfg.integration.duration = Math.min(cfg.integration.duration, 2 * SEC_PER_DAY);
    cfg.integration.outputInterval = Math.max(
      cfg.integration.timestep,
      cfg.integration.duration / 500,
    );

    const res = await propagate(cfg, { yieldToEventLoop: false });

    expect(res.samples.length).toBeGreaterThan(10);
    // No NaNs anywhere in the recorded state.
    for (const s of [res.samples[0], res.samples[res.samples.length - 1]]) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.vx)).toBe(true);
      expect(Number.isFinite(s.sma)).toBe(true);
      expect(Number.isFinite(s.sailAccel)).toBe(true);
    }
    expect(res.summary.termination).not.toBe('numericalFailure');
    // Sail acceleration must be non-negative and physically small.
    expect(res.summary.meanSailAccel).toBeGreaterThanOrEqual(0);
    expect(res.summary.meanSailAccel).toBeLessThan(1e-2);
  }, 120000);
});

describe('every preset builds and propagates', () => {
  it.each(PRESETS.map((p) => [p.id] as const))('%s', async (id) => {
    const preset = PRESETS.find((p) => p.id === id)!;
    const cfg = preset.build();
    cfg.integration.duration = Math.min(cfg.integration.duration, 2 * SEC_PER_DAY);
    cfg.integration.outputInterval = Math.max(
      cfg.integration.timestep,
      cfg.integration.duration / 500,
    );

    const res = await propagate(cfg, { yieldToEventLoop: false });
    expect(res.samples.length).toBeGreaterThan(10);
    expect(res.summary.termination).not.toBe('numericalFailure');

    // The feasibility report must be computable without throwing.
    const report = feasibilityReport(res, cfg.sail, cfg.spacecraft);
    expect(report.characteristicAcceleration).toBeGreaterThan(0);
    expect(Number.isFinite(report.dutyFactor)).toBe(true);
  }, 120000);
});

describe('LEO orbit raising behaves as expected', () => {
  it('prograde steering raises the orbit and retrograde lowers it', async () => {
    const results: Record<string, number> = {};

    for (const direction of ['prograde', 'retrograde'] as const) {
      const cfg = buildScenario('leo-circular');
      cfg.attitude = { kind: 'optimalDirection', direction };
      const res = await propagate(cfg, { yieldToEventLoop: false });
      const report = feasibilityReport(res, cfg.sail, cfg.spacecraft);
      expect(report.deltaSma).not.toBeNull();
      results[direction] = report.deltaSma!;
    }

    expect(results.prograde).toBeGreaterThan(0);
    expect(results.retrograde).toBeLessThan(0);
    // The two must be near mirror images: the geometry is the same and only
    // the sign of the target direction differs.
    const asymmetry =
      Math.abs(results.prograde + results.retrograde) / Math.abs(results.prograde);
    expect(asymmetry).toBeLessThan(0.1);
  }, 200000);

  it('a larger sail produces a proportionally larger orbit change', async () => {
    const deltas: number[] = [];
    for (const area of [100, 200, 400]) {
      const cfg = buildScenario('leo-circular');
      cfg.attitude = { kind: 'optimalDirection', direction: 'prograde' };
      cfg.sail = { ...cfg.sail, area };
      const res = await propagate(cfg, { yieldToEventLoop: false });
      deltas.push(feasibilityReport(res, cfg.sail, cfg.spacecraft).deltaSma!);
    }
    // The sail force is linear in area, and over a week the response is still
    // effectively linear.
    expect(deltas[1] / deltas[0]).toBeCloseTo(2, 0);
    expect(deltas[2] / deltas[0]).toBeCloseTo(4, 0);
  }, 300000);

  it('no sail force means no secular orbit change', async () => {
    const cfg = buildScenario('leo-circular');
    cfg.forces.solarRadiationPressure = false;
    const res = await propagate(cfg, { yieldToEventLoop: false });
    const report = feasibilityReport(res, cfg.sail, cfg.spacecraft);
    // J2 is conservative and produces no secular change in the semi-major
    // axis, so the only residue should be averaging error. Measured: 8.5 m
    // against an osculating peak-to-peak of 12.7 km, which is 0.07%.
    //
    // This is precisely the quantity `smaResolution` reports as the noise
    // floor, so assert against that rather than a magic number.
    expect(Math.abs(report.deltaSma!)).toBeLessThan(3 * report.smaResolution);
    expect(Math.abs(report.deltaSma!)).toBeLessThan(20);
    expect(report.deltaVEquivalent).toBe(0);
  }, 120000);

  it('a dawn-dusk sun-synchronous orbit is far less eclipsed than a 51.6 degree LEO', async () => {
    const leo = buildScenario('leo-circular');
    const sso = buildScenario('leo-sso-dawn-dusk');
    leo.integration.duration = 3 * SEC_PER_DAY;
    sso.integration.duration = 3 * SEC_PER_DAY;

    const a = await propagate(leo, { yieldToEventLoop: false });
    const b = await propagate(sso, { yieldToEventLoop: false });

    expect(a.summary.eclipseFraction).toBeGreaterThan(0.3);
    expect(b.summary.eclipseFraction).toBeLessThan(a.summary.eclipseFraction);
  }, 200000);
});

describe('higher orbits', () => {
  it('the sail is a much larger relative perturbation at GEO than in LEO', async () => {
    const leo = buildScenario('leo-circular');
    const geo = buildScenario('geo');
    for (const c of [leo, geo]) {
      c.attitude = { kind: 'optimalDirection', direction: 'prograde' };
      c.integration.duration = 5 * SEC_PER_DAY;
    }

    const a = await propagate(leo, { yieldToEventLoop: false });
    const b = await propagate(geo, { yieldToEventLoop: false });

    // GEO gets more sunlight (fewer, shorter eclipses).
    expect(b.summary.eclipseFraction).toBeLessThan(a.summary.eclipseFraction);
    // And the same sail achieves a larger fraction of its characteristic
    // acceleration there.
    expect(b.summary.meanSailAccel).toBeGreaterThan(a.summary.meanSailAccel);
  }, 300000);
});

describe('lunar transfer aiming', () => {
  it('produces a departure ellipse that reaches the lunar distance', () => {
    const aim = aimAtMoon('2026-03-20T12:00:00Z', 400e3, 'series');
    // Apogee at the lunar distance.
    expect(aim.apogeeRadius / 1000).toBeGreaterThan(355000);
    expect(aim.apogeeRadius / 1000).toBeLessThan(410000);
    // Time of flight is the classical 4-6 days for such a transfer.
    const tofDays = aim.timeOfFlight / SEC_PER_DAY;
    expect(tofDays).toBeGreaterThan(4);
    expect(tofDays).toBeLessThan(6);
    // Perigee at the requested altitude.
    expect(Math.hypot(...aim.r) / 1000).toBeCloseTo((R_EARTH + 400e3) / 1000, 0);
  });

  it('actually gets close to the Moon', async () => {
    const cfg = buildScenario('lunar-transfer');
    const res = await propagate(cfg, { yieldToEventLoop: false });

    expect(res.summary.termination).not.toBe('numericalFailure');
    // The geometric aiming heuristic is not an optimiser, but it must at least
    // deliver an encounter rather than a random miss. Anything inside the
    // lunar sphere of influence (66,100 km) counts as an encounter.
    expect(res.summary.minMoonDistance).toBeLessThan(MOON_SOI_RADIUS);
    // And the closest approach must occur near the predicted arrival time,
    // not at the start of the run.
    expect(res.summary.minMoonDistanceTime / SEC_PER_DAY).toBeGreaterThan(3);
    expect(res.summary.enteredLunarSoi).toBe(true);
  }, 200000);

  it('the sail measurably shifts the lunar encounter', async () => {
    // The question the lunar scenario exists to answer.
    const withSail = buildScenario('lunar-transfer');
    withSail.sail = { ...withSail.sail, area: 400 };
    withSail.spacecraft = { dryMass: 50, propellantMass: 0 };

    const withoutSail = structuredClone(withSail);
    withoutSail.forces.solarRadiationPressure = false;

    const a = await propagate(withSail, { yieldToEventLoop: false });
    const b = await propagate(withoutSail, { yieldToEventLoop: false });

    const shift = Math.abs(a.summary.minMoonDistance - b.summary.minMoonDistance);
    // A 400 m^2 sail on 50 kg over ~5 days must move the closest approach by a
    // detectable amount - well above numerical noise.
    expect(shift).toBeGreaterThan(1000);
  }, 300000);

  it('does not claim lunar capture', async () => {
    const cfg = buildScenario('lunar-transfer');
    const res = await propagate(cfg, { yieldToEventLoop: false });
    // A ballistic transfer with a sail cannot capture: there is no braking
    // manoeuvre. The summary must say so.
    expect(res.summary.boundToMoonAtEnd).toBe(false);
  }, 200000);
});

describe('lunar orbit scenario', () => {
  it('stays bound about the Moon over 2 days', async () => {
    const cfg = buildScenario('lunar-orbit');
    cfg.integration.duration = 2 * SEC_PER_DAY;
    const res = await propagate(cfg, { yieldToEventLoop: false });

    expect(res.summary.termination).toBe('completed');
    // Energy must stay negative relative to the Moon.
    for (const s of res.samples) {
      expect(s.energy).toBeLessThan(0);
      expect(s.altitude).toBeGreaterThan(0);
    }
    // A 100 km lunar orbit has a period of about 118 minutes.
    expect(res.samples[0].period / 60).toBeGreaterThan(100);
    expect(res.samples[0].period / 60).toBeLessThan(140);
  }, 120000);
});

describe('export and configuration round-trip', () => {
  it('serialises and reloads a configuration losslessly', () => {
    for (const s of runnable) {
      const cfg = buildScenario(s.id);
      const restored = configFromJson(configToJson(cfg));
      expect(restored.epoch).toBe(cfg.epoch);
      expect(restored.centralBody).toBe(cfg.centralBody);
      expect(restored.sail.area).toBe(cfg.sail.area);
      expect(restored.attitude.kind).toBe(cfg.attitude.kind);
      expect(restored.integration.timestep).toBe(cfg.integration.timestep);
      expect(restored.forces).toEqual(cfg.forces);
    }
  });

  it('rejects malformed configurations with a useful message', () => {
    expect(() => configFromJson('not json')).toThrow(/Not valid JSON/);
    expect(() => configFromJson('[]')).toThrow(/must be a JSON object/);
    expect(() => configFromJson('{"version":99}')).toThrow(/Unsupported configuration version/);
    expect(() => configFromJson('{"version":1}')).toThrow(/missing/);
  });

  it('produces a CSV with a header row and one row per sample', async () => {
    const cfg = buildScenario('leo-circular');
    cfg.integration.duration = 3600;
    cfg.integration.outputInterval = 60;
    const res = await propagate(cfg, { yieldToEventLoop: false });

    const csv = trajectoryToCsv(res);
    const lines = csv.split('\n');
    const comments = lines.filter((l) => l.startsWith('#'));
    const dataLines = lines.filter((l) => !l.startsWith('#') && l.length > 0);

    expect(comments.length).toBeGreaterThan(5); // provenance header
    expect(dataLines.length).toBe(res.samples.length + 1); // + header row

    const header = dataLines[0].split(',');
    expect(header).toContain('time_s');
    expect(header).toContain('sma_km');
    expect(header).toContain('sail_accel_um_s2');
    expect(header).toContain('illumination_fraction');

    // Every data row must have the same number of columns as the header.
    for (const row of dataLines.slice(1)) {
      expect(row.split(',').length).toBe(header.length);
    }
  }, 60000);
});

describe('sensitivity sweep', () => {
  it('finds the expected monotonic scaling with area-to-mass ratio', async () => {
    const cfg = buildScenario('leo-circular');
    cfg.attitude = { kind: 'optimalDirection', direction: 'prograde' };
    cfg.integration.duration = 2 * SEC_PER_DAY;

    const sweep = await runSweep(cfg, {
      parameter: 'areaToMass',
      min: 1,
      max: 8,
      samples: 4,
      metric: 'deltaMeanSma',
    });

    expect(sweep.points.length).toBe(4);
    const values = sweep.points.map((p) => p.metric);
    for (const v of values) expect(v).not.toBeNull();
    // The orbit change must increase monotonically with the sail.
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
    // And be very nearly linear.
    const ratio = values[3]! / values[0]!;
    expect(ratio).toBeGreaterThan(6);
    expect(ratio).toBeLessThan(10);
  }, 300000);
});
