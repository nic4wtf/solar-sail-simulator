/**
 * Validation: the perturbations added after the first release - atmospheric
 * drag, Earth albedo and infrared radiation pressure, and the J3 zonal
 * harmonic.
 *
 * Every assertion here checks against something INDEPENDENT of the code being
 * tested: a published table, an exact analytic limit, a numerical gradient of
 * the potential the acceleration claims to come from, or a sign that physics
 * requires. Checking a force term against itself is how a plausible-looking
 * bug survives.
 */

import { describe, expect, it } from 'vitest';
import {
  C_LIGHT,
  EARTH_ALBEDO,
  EARTH_IR_EXITANCE,
  EARTH_ROTATION_RATE,
  J2_EARTH,
  J3_EARTH,
  MU_EARTH,
  R_EARTH,
  SEC_PER_DAY,
  SOLAR_IRRADIANCE_1AU_CLASSICAL,
} from '../core/constants.ts';
import { type Vec3, dot, norm, unit } from '../core/vec3.ts';
import {
  ATMOSPHERE_CUTOFF_ALTITUDE,
  atmosphericDensity,
  scaleHeightAt,
} from '../core/environment/atmosphere.ts';
import { atmosphericDrag, ballisticCoefficient } from '../core/forces/drag.ts';
import { albedoPhaseFactor, earthRadiationPressure } from '../core/forces/albedo.ts';
import { j2Earth, j3Earth } from '../core/forces/gravity.ts';
import { DEFAULT_SAIL, IDEAL_SAIL } from '../core/sail/sail.ts';
import { buildScenario } from '../sim/scenarios.ts';
import { propagate } from '../sim/propagator.ts';

// ---------------------------------------------------------------------------
// Atmosphere
// ---------------------------------------------------------------------------

describe('atmospheric density model', () => {
  /**
   * Independent reference: the US Standard Atmosphere 1976 / CIRA-72 values
   * tabulated by Vallado (Table 8-4), read at the band base altitudes where
   * the fit reproduces the table exactly.
   */
  const TABLE: ReadonlyArray<[altitudeKm: number, density: number]> = [
    [0, 1.225],
    [100, 5.297e-7],
    [200, 2.789e-10],
    [300, 2.418e-11],
    [400, 3.725e-12],
    [500, 6.967e-13],
    [600, 1.454e-13],
    [800, 1.17e-14],
    [1000, 3.019e-15],
  ];

  it.each(TABLE)('matches the tabulated density at %i km', (altKm, expected) => {
    expect(atmosphericDensity(altKm * 1000, 'mean')).toBeCloseTo(
      expected,
      // toBeCloseTo works in absolute terms, so compare the logs instead:
      // these values span fifteen orders of magnitude.
      -Math.log10(expected) + 6,
    );
  });

  it('falls monotonically from the surface to the cutoff', () => {
    let previous = Infinity;
    for (let h = 0; h < 2000e3; h += 5e3) {
      const rho = atmosphericDensity(h, 'mean');
      expect(rho).toBeLessThan(previous);
      previous = rho;
    }
  });

  it('is exactly zero above the cutoff, and negligible just below it', () => {
    expect(atmosphericDensity(ATMOSPHERE_CUTOFF_ALTITUDE, 'mean')).toBe(0);
    expect(atmosphericDensity(ATMOSPHERE_CUTOFF_ALTITUDE + 1e6, 'mean')).toBe(0);
    // Just under the cutoff the density must already be irrelevant, or the
    // cutoff would introduce a real discontinuity in the dynamics.
    expect(atmosphericDensity(ATMOSPHERE_CUTOFF_ALTITUDE - 1, 'mean')).toBeLessThan(1e-16);
  });

  it('drops by exactly 1/e over one scale height inside a band', () => {
    // Definitional within a band: it checks that the band lookup and the
    // exponent agree with each other. Both altitudes are chosen so that
    // h + H stays inside the same band.
    for (const h of [250e3, 500e3]) {
      const H = scaleHeightAt(h);
      const ratio = atmosphericDensity(h + H, 'mean') / atmosphericDensity(h, 'mean');
      expect(ratio).toBeCloseTo(Math.exp(-1), 12);
    }
  });

  it('stays within the fit residual when a scale height crosses a band', () => {
    // Where h + H lands in the next band up the two exponentials disagree
    // slightly. That residual is the price of a 28-line table instead of an
    // atmosphere model, and it must stay small enough not to matter: under
    // 10% on a quantity whose real-world uncertainty is a factor of several.
    for (const h of [450e3, 650e3]) {
      const H = scaleHeightAt(h);
      const ratio = atmosphericDensity(h + H, 'mean') / atmosphericDensity(h, 'mean');
      expect(ratio / Math.exp(-1)).toBeGreaterThan(0.9);
      expect(ratio / Math.exp(-1)).toBeLessThan(1.1);
    }
  });

  it('is continuous across the band boundaries to within the fit residual', () => {
    // The piecewise fit is not exactly continuous; a jump large enough to
    // matter would show up as a kink the integrator has to chase.
    for (const h of [100e3, 200e3, 300e3, 500e3, 700e3]) {
      const below = atmosphericDensity(h - 1, 'mean');
      const above = atmosphericDensity(h + 1, 'mean');
      expect(above / below).toBeGreaterThan(0.7);
      expect(above / below).toBeLessThan(1.4);
    }
  });

  it('scales the thermosphere with solar activity but leaves the troposphere alone', () => {
    // Below the ramp the solar cycle must have no effect at all.
    expect(atmosphericDensity(50e3, 'high')).toBe(atmosphericDensity(50e3, 'mean'));
    expect(atmosphericDensity(50e3, 'low')).toBe(atmosphericDensity(50e3, 'mean'));

    // Above it, the full multiplier applies and the ordering is strict.
    const low = atmosphericDensity(400e3, 'low');
    const mean = atmosphericDensity(400e3, 'mean');
    const high = atmosphericDensity(400e3, 'high');
    expect(low).toBeLessThan(mean);
    expect(mean).toBeLessThan(high);
    expect(high / mean).toBeCloseTo(3, 6);
    expect(low / mean).toBeCloseTo(0.4, 6);
  });
});

// ---------------------------------------------------------------------------
// Drag
// ---------------------------------------------------------------------------

describe('atmospheric drag', () => {
  const base = {
    sailArea: 100,
    busArea: 1,
    dragCoefficient: 2.2,
    mass: 100,
    activity: 'mean' as const,
  };

  /** A 400 km circular equatorial state. */
  const r400: Vec3 = [R_EARTH + 400e3, 0, 0];
  const v400: Vec3 = [0, Math.sqrt(MU_EARTH / (R_EARTH + 400e3)), 0];

  it('always opposes the relative wind and always removes energy', () => {
    // Sample a range of positions, velocities and sail orientations. Drag can
    // never do positive work; if it ever does, a sign is wrong somewhere.
    for (let i = 0; i < 40; i++) {
      const theta = (i / 40) * 2 * Math.PI;
      const alt = 250e3 + (i % 5) * 60e3;
      const rad = R_EARTH + alt;
      const r: Vec3 = [rad * Math.cos(theta), rad * Math.sin(theta), rad * 0.2 * Math.sin(3 * theta)];
      const speed = Math.sqrt(MU_EARTH / norm(r));
      const v: Vec3 = [-speed * Math.sin(theta), speed * Math.cos(theta), 0];
      const n: Vec3 = unit([Math.cos(i), Math.sin(2 * i), Math.cos(3 * i) + 0.1]);

      const res = atmosphericDrag({ ...base, sailNormal: n }, r, v);
      expect(res.density).toBeGreaterThan(0);
      // Work done against the INERTIAL velocity must be negative.
      expect(dot(res.acceleration, v)).toBeLessThan(0);
    }
  });

  it('uses the sail as its drag area, projected on the relative wind', () => {
    // Broadside: the normal is along the wind, so the full sail area counts.
    const wind = unit([v400[0] + EARTH_ROTATION_RATE * r400[1], v400[1] - EARTH_ROTATION_RATE * r400[0], v400[2]]);
    const broadside = atmosphericDrag({ ...base, sailNormal: wind }, r400, v400);
    expect(broadside.cosWind).toBeCloseTo(1, 9);
    expect(broadside.dragArea).toBeCloseTo(base.busArea + base.sailArea, 6);

    // Edge-on: the normal is perpendicular to the wind, so only the bus counts.
    const edgeOn = atmosphericDrag({ ...base, sailNormal: unit(r400) }, r400, v400);
    expect(edgeOn.cosWind).toBeCloseTo(0, 6);
    expect(edgeOn.dragArea).toBeCloseTo(base.busArea, 6);

    // THE point of the coupling: two orders of magnitude of authority over
    // the decay rate, from attitude alone.
    expect(norm(broadside.acceleration) / norm(edgeOn.acceleration)).toBeGreaterThan(50);
  });

  it('matches the drag equation evaluated by hand at 400 km', () => {
    const res = atmosphericDrag({ ...base, sailNormal: unit(r400) }, r400, v400);
    // Edge-on, so A = bus area only.
    const rho = atmosphericDensity(400e3, 'mean');
    const vRelExpected = Math.hypot(v400[1] - EARTH_ROTATION_RATE * r400[0], 0);
    const expected =
      (0.5 * rho * base.dragCoefficient * base.busArea * vRelExpected ** 2) / base.mass;
    expect(res.relativeSpeed).toBeCloseTo(vRelExpected, 6);
    expect(norm(res.acceleration)).toBeCloseTo(expected, 20);
  });

  it('subtracts the co-rotating atmosphere from the inertial velocity', () => {
    // A prograde equatorial orbit flies with the atmosphere, so the relative
    // speed is lower than the inertial speed by exactly the co-rotation speed.
    const res = atmosphericDrag({ ...base, sailNormal: unit(r400) }, r400, v400);
    const corotation = EARTH_ROTATION_RATE * norm(r400);
    expect(res.relativeSpeed).toBeCloseTo(norm(v400) - corotation, 6);
    // ~494 m/s at this radius (465 m/s at the equatorial surface, scaled by
    // radius): a 6% speed reduction, hence ~12% less drag than the inertial
    // velocity alone would give.
    expect(corotation).toBeGreaterThan(450);
    expect(corotation).toBeLessThan(550);
    expect(corotation / norm(v400)).toBeGreaterThan(0.05);
  });

  it('reports a ballistic coefficient that shows how extreme a sail is', () => {
    // A 100 m^2 sail on 100 kg, broadside, is around 0.45 kg/m^2. A cubesat is
    // ~50 and a spent rocket body ~100. That three-order-of-magnitude gap is
    // the whole reason a sail cannot ignore drag in LEO.
    const broadside = ballisticCoefficient(100, 2.2, 101);
    expect(broadside).toBeGreaterThan(0.4);
    expect(broadside).toBeLessThan(0.5);
    const edgeOn = ballisticCoefficient(100, 2.2, 1);
    expect(edgeOn / broadside).toBeGreaterThan(90);
  });

  it('vanishes above the atmosphere cutoff', () => {
    const rGeo: Vec3 = [42164e3, 0, 0];
    const vGeo: Vec3 = [0, 3074.7, 0];
    const res = atmosphericDrag({ ...base, sailNormal: [1, 0, 0] }, rGeo, vGeo);
    expect(res.density).toBe(0);
    expect(norm(res.acceleration)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Earth albedo and infrared
// ---------------------------------------------------------------------------

describe('Earth radiation pressure', () => {
  const sail = { ...IDEAL_SAIL, area: 1 };
  const inp = { sail, mass: 1, albedo: true, infrared: true };
  const earth: Vec3 = [0, 0, 0];
  /** Sun placed along +x at 1 AU so the phase angle is easy to control. */
  const sunAt = (angleRad: number): Vec3 => [
    1.495978707e11 * Math.cos(angleRad),
    1.495978707e11 * Math.sin(angleRad),
    0,
  ];

  const alt = 500e3;
  const rCraft: Vec3 = [R_EARTH + alt, 0, 0];
  const viewFactor = (R_EARTH / (R_EARTH + alt)) ** 2;

  it('reproduces the exact uniform-sphere result for the infrared term', () => {
    // E_ir = M (R/r)^2 is exact for a uniform Lambertian sphere, so this is a
    // closed-form check, not a tolerance-based one.
    const res = earthRadiationPressure(
      { ...inp, albedo: false },
      rCraft,
      earth,
      sunAt(0),
      [1, 0, 0],
    );
    expect(res.infraredPressure).toBeCloseTo((EARTH_IR_EXITANCE * viewFactor) / C_LIGHT, 18);
    // ~206 W/m^2 at 500 km, which is the figure in every thermal-control
    // handbook for Earth IR on a nadir-facing surface in LEO.
    expect(res.infraredPressure * C_LIGHT).toBeGreaterThan(195);
    expect(res.infraredPressure * C_LIGHT).toBeLessThan(215);
  });

  it('keeps pushing in eclipse, where every other radiation term is zero', () => {
    // Anti-sunward side: the spacecraft is over the night hemisphere.
    const night = earthRadiationPressure(inp, rCraft, earth, sunAt(Math.PI), [1, 0, 0]);
    // Not exactly zero only because sin(Math.PI) is 1.2e-16 rather than 0;
    // seventeen orders of magnitude below the infrared term beside it.
    expect(night.albedoPressure).toBeLessThan(1e-20);
    expect(night.infraredPressure).toBeGreaterThan(0);
    expect(norm(night.acceleration)).toBeGreaterThan(0);
    // And it pushes outward, away from the Earth.
    expect(dot(night.acceleration, unit(rCraft))).toBeGreaterThan(0);
  });

  it('gives an albedo irradiance in the published LEO range over the subsolar point', () => {
    const noon = earthRadiationPressure({ ...inp, infrared: false }, rCraft, earth, sunAt(0), [
      1, 0, 0,
    ]);
    const irradiance = noon.albedoPressure * C_LIGHT;
    // a * S * (R/r)^2 = 0.30 * 1368 * 0.860 = 353 W/m^2 at full phase, less a
    // few percent from the phase blend. Handbook values for peak Earth albedo
    // irradiance in LEO run 300-500 W/m^2 depending on cloud and surface.
    expect(irradiance).toBeGreaterThan(300);
    expect(irradiance).toBeLessThan(EARTH_ALBEDO * SOLAR_IRRADIANCE_1AU_CLASSICAL * viewFactor);
    // acos near 1 loses half the mantissa, so 1e-6 rad is the meaningful floor.
    expect(noon.phaseAngle).toBeCloseTo(0, 6);
  });

  it('falls monotonically from the subsolar point to the terminator', () => {
    let previous = Infinity;
    for (let deg = 0; deg <= 90; deg += 10) {
      const res = earthRadiationPressure(
        { ...inp, infrared: false },
        rCraft,
        earth,
        sunAt((deg * Math.PI) / 180),
        [1, 0, 0],
      );
      expect(res.albedoPressure).toBeLessThan(previous);
      previous = res.albedoPressure;
    }
  });

  it('has a phase factor with the right closed-form limits', () => {
    // Near field, full phase: the whole visible cap is at normal incidence.
    expect(albedoPhaseFactor(0, 1)).toBeCloseTo(1, 12);
    // Far field, full phase: the Lambert-sphere value 2/3.
    expect(albedoPhaseFactor(0, 0)).toBeCloseTo(2 / 3, 12);
    // Far field, quadrature: (2/3pi) * 1.
    expect(albedoPhaseFactor(Math.PI / 2, 0)).toBeCloseTo(2 / (3 * Math.PI), 12);
    // Anywhere, opposition: nothing is reflected toward the observer.
    expect(albedoPhaseFactor(Math.PI, 0)).toBeCloseTo(0, 12);
    expect(albedoPhaseFactor(Math.PI, 1)).toBe(0);
  });

  it('falls off as 1/r^2 and is negligible at lunar distance', () => {
    const near = earthRadiationPressure(inp, [2 * R_EARTH, 0, 0], earth, sunAt(0), [1, 0, 0]);
    const far = earthRadiationPressure(inp, [4 * R_EARTH, 0, 0], earth, sunAt(0), [1, 0, 0]);
    expect(near.infraredPressure / far.infraredPressure).toBeCloseTo(4, 6);

    // The Moon sits at 60 Earth radii, inside the 100-radius cutoff, so the
    // term is still evaluated there - it just does not matter. Against the
    // 9.1e-6 m/s^2 a 1 m^2/kg sail gets from the Sun at 1 AU, this is 1e-4.
    const lunar = earthRadiationPressure(inp, [3.844e8, 0, 0], earth, sunAt(0), [1, 0, 0]);
    expect(norm(lunar.acceleration)).toBeLessThan(1e-9);
    expect(norm(lunar.acceleration) / 9.126e-6).toBeLessThan(1e-3);

    // Past the cutoff it is switched off entirely.
    const beyond = earthRadiationPressure(inp, [200 * R_EARTH, 0, 0], earth, sunAt(0), [1, 0, 0]);
    expect(norm(beyond.acceleration)).toBe(0);
  });

  it('is a large fraction of the direct solar flux, but mostly radial', async () => {
    // The headline number worth knowing: at 500 km the Earth returns of order
    // 40% of the direct solar flux. It does not translate into 40% more
    // thrust, because it arrives along the local vertical, where it does
    // almost no work on the orbit - which is exactly why it was safe to leave
    // out of the first release and worth stating explicitly now.
    const res = earthRadiationPressure(inp, rCraft, earth, sunAt(0), [1, 0, 0]);
    const total = (res.albedoPressure + res.infraredPressure) * C_LIGHT;
    const direct = SOLAR_IRRADIANCE_1AU_CLASSICAL;
    expect(total / direct).toBeGreaterThan(0.3);
    expect(total / direct).toBeLessThan(0.5);

    // Both components push radially outward, with no transverse bias.
    const radial = unit(rCraft);
    expect(dot(unit(res.acceleration), radial)).toBeCloseTo(1, 9);
  });
});

// ---------------------------------------------------------------------------
// J3
// ---------------------------------------------------------------------------

describe('J3 zonal harmonic', () => {
  /**
   * Zonal disturbing potential, from which the acceleration must be the
   * gradient. This is the independent reference: the accelerations are
   * hand-derived closed forms, and a sign slip in either is invisible until
   * they are checked against the potential they claim to come from.
   *
   *   U_n = -(mu/r) J_n (Re/r)^n P_n(z/r)
   */
  const potentialJ2 = (r: Vec3): number => {
    const rm = norm(r);
    const u = r[2] / rm;
    const p2 = (3 * u * u - 1) / 2;
    return -(MU_EARTH / rm) * J2_EARTH * (R_EARTH / rm) ** 2 * p2;
  };
  const potentialJ3 = (r: Vec3): number => {
    const rm = norm(r);
    const u = r[2] / rm;
    const p3 = (5 * u * u * u - 3 * u) / 2;
    return -(MU_EARTH / rm) * J3_EARTH * (R_EARTH / rm) ** 3 * p3;
  };

  /**
   * Relative agreement, because a central difference carries a truncation
   * error of order f'''h^2/6 - about 1e-10 relative here - which an absolute
   * tolerance on a value of order 1e-2 cannot express.
   */
  const expectRelative = (actual: number, expected: number, tol: number): void => {
    expect(Math.abs(actual - expected) / Math.max(1e-30, Math.abs(expected))).toBeLessThan(tol);
  };

  const numericalGradient = (f: (r: Vec3) => number, r: Vec3, h = 50): Vec3 => {
    const g: number[] = [];
    for (let i = 0; i < 3; i++) {
      const plus = [...r] as Vec3;
      const minus = [...r] as Vec3;
      plus[i] += h;
      minus[i] -= h;
      g.push((f(plus) - f(minus)) / (2 * h));
    }
    return g as Vec3;
  };

  const samples: Vec3[] = [
    [R_EARTH + 500e3, 0, 0],
    [0, R_EARTH + 800e3, 0],
    [0, 0, R_EARTH + 700e3],
    [4000e3, 3000e3, 5000e3],
    [-5000e3, 2000e3, -4000e3],
    [20000e3, -10000e3, 8000e3],
  ];

  it.each(samples.map((r, i) => [i, r] as const))(
    'J3 acceleration is the gradient of its potential (sample %i)',
    (_i, r) => {
      const analytic = j3Earth(r, MU_EARTH);
      const numeric = numericalGradient(potentialJ3, r);
      for (let k = 0; k < 3; k++) {
        if (Math.abs(numeric[k]) < 1e-16) continue; // component is zero by symmetry
        expectRelative(analytic[k], numeric[k], 1e-6);
      }
    },
  );

  it.each(samples.map((r, i) => [i, r] as const))(
    'J2 acceleration is the gradient of its potential (sample %i)',
    (_i, r) => {
      // The same check on the term that was already shipping: it pins the
      // sign convention the J3 derivation was matched against.
      const analytic = j2Earth(r, MU_EARTH);
      const numeric = numericalGradient(potentialJ2, r);
      for (let k = 0; k < 3; k++) {
        if (Math.abs(numeric[k]) < 1e-16) continue;
        expectRelative(analytic[k], numeric[k], 1e-6);
      }
    },
  );

  it('is smaller than J2 by roughly the ratio of the harmonic coefficients', () => {
    const r: Vec3 = [4000e3, 3000e3, 5000e3];
    const ratio = norm(j3Earth(r, MU_EARTH)) / norm(j2Earth(r, MU_EARTH));
    // (5/2 J3) / (3/2 J2) * (Re/r) ~ 4e-3 in LEO. Anything wildly different
    // means a factor is wrong.
    expect(ratio).toBeGreaterThan(1e-3);
    expect(ratio).toBeLessThan(2e-2);
  });

  it('vanishes in the equatorial plane except along z, as its symmetry requires', () => {
    // P3 is odd in z: on the equator the in-plane components must be exactly
    // zero and only the out-of-plane push survives.
    const r: Vec3 = [R_EARTH + 600e3, 0, 0];
    const a = j3Earth(r, MU_EARTH);
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(0);
    expect(Math.abs(a[2])).toBeGreaterThan(0);
  });

  it('is antisymmetric about the equator', () => {
    const north: Vec3 = [3000e3, 1000e3, 6000e3];
    const south: Vec3 = [3000e3, 1000e3, -6000e3];
    const an = j3Earth(north, MU_EARTH);
    const as = j3Earth(south, MU_EARTH);
    // Horizontal components flip sign, the vertical component does not.
    expect(an[0]).toBeCloseTo(-as[0], 18);
    expect(an[1]).toBeCloseTo(-as[1], 18);
    expect(an[2]).toBeCloseTo(as[2], 18);
  });
});

// ---------------------------------------------------------------------------
// Integration-level consequences
// ---------------------------------------------------------------------------

describe('drag changes the LEO answer', () => {
  it('turns a sail that would raise a 500 km orbit into one that decays', async () => {
    // This is the result the drag model exists to produce, and the reason the
    // first release could not answer the LEO question honestly.
    const base = buildScenario('leo-circular');
    base.attitude = { kind: 'optimalDirection', direction: 'prograde' };
    base.integration.duration = 2 * SEC_PER_DAY;
    base.integration.outputInterval = 60;

    const withDrag = structuredClone(base);
    const withoutDrag = structuredClone(base);
    withoutDrag.forces.atmosphericDrag = false;
    withoutDrag.forces.earthAlbedo = false;
    withoutDrag.forces.earthInfrared = false;

    const a = await propagate(withDrag, { yieldToEventLoop: false });
    const b = await propagate(withoutDrag, { yieldToEventLoop: false });

    const dragged = a.summary.finalSma - a.summary.initialSma;
    const clean = b.summary.finalSma - b.summary.initialSma;

    expect(clean).toBeGreaterThan(0); // the sail alone raises the orbit
    expect(dragged).toBeLessThan(0); // with the atmosphere it does not
    expect(a.summary.dragDeltaVEquivalent).toBeGreaterThan(a.summary.deltaVEquivalent);
    expect(a.summary.maxAirDensity).toBeGreaterThan(0);
    expect(b.summary.dragDeltaVEquivalent).toBe(0);
  }, 200000);

  it('decays faster with a bigger sail - the deorbit-sail result', async () => {
    const run = async (area: number) => {
      const cfg = buildScenario('leo-circular');
      cfg.sail = { ...DEFAULT_SAIL, area };
      // Hold the sail Sun-facing so the attitude law cannot confound the
      // comparison; only the area changes between the two runs.
      cfg.attitude = { kind: 'sunRelative', cone: 0, clock: 0 };
      cfg.integration.duration = SEC_PER_DAY;
      cfg.integration.outputInterval = 60;
      const res = await propagate(cfg, { yieldToEventLoop: false });
      return res.summary.finalSma - res.summary.initialSma;
    };

    const small = await run(20);
    const large = await run(200);
    expect(large).toBeLessThan(small);
    expect(large).toBeLessThan(0);
  }, 200000);

  it('records drag diagnostics on every sample', async () => {
    const cfg = buildScenario('leo-circular');
    cfg.integration.duration = 0.2 * SEC_PER_DAY;
    cfg.integration.outputInterval = 60;
    const res = await propagate(cfg, { yieldToEventLoop: false });

    for (const s of res.samples) {
      expect(Number.isFinite(s.dragAccel)).toBe(true);
      expect(s.airDensity).toBeGreaterThan(0);
      // The drag area is bounded by the bus alone and bus + full sail.
      expect(s.dragArea).toBeGreaterThanOrEqual(cfg.spacecraft.busArea - 1e-9);
      expect(s.dragArea).toBeLessThanOrEqual(cfg.spacecraft.busArea + cfg.sail.area + 1e-9);
      expect(s.earthRadiationAccel).toBeGreaterThanOrEqual(0);
    }
    // The impulse budget must be non-decreasing along the run.
    for (let i = 1; i < res.samples.length; i++) {
      expect(res.samples[i].dragDeltaVEquivalent).toBeGreaterThanOrEqual(
        res.samples[i - 1].dragDeltaVEquivalent,
      );
    }
  }, 120000);

  it('leaves high orbits untouched', async () => {
    // GEO is above the atmosphere cutoff, so switching drag on must change
    // nothing at all - a cheap guard against the term leaking upward.
    const off = buildScenario('geo');
    off.integration.duration = 0.5 * SEC_PER_DAY;
    const on = structuredClone(off);
    on.forces.atmosphericDrag = true;

    const a = await propagate(off, { yieldToEventLoop: false });
    const b = await propagate(on, { yieldToEventLoop: false });
    expect(b.summary.finalSma).toBeCloseTo(a.summary.finalSma, 6);
    expect(b.summary.dragDeltaVEquivalent).toBe(0);
  }, 120000);
});

// ---------------------------------------------------------------------------
// Guard against accidental coupling
// ---------------------------------------------------------------------------

describe('new terms stay switched off when they are switched off', () => {
  it('reproduces the pre-drag trajectory exactly with every new toggle off', async () => {
    const cfg = buildScenario('leo-circular');
    cfg.integration.duration = 0.5 * SEC_PER_DAY;
    cfg.forces.atmosphericDrag = false;
    cfg.forces.earthAlbedo = false;
    cfg.forces.earthInfrared = false;
    cfg.forces.earthJ3 = false;

    const res = await propagate(cfg, { yieldToEventLoop: false });
    expect(res.summary.dragDeltaVEquivalent).toBe(0);
    expect(res.summary.meanDragAccel).toBe(0);
    expect(res.summary.maxAirDensity).toBe(0);
    for (const s of res.samples) {
      expect(s.dragAccel).toBe(0);
      expect(s.earthRadiationAccel).toBe(0);
      // The DIAGNOSTICS must be zero too, not just the force: a recorded
      // density would describe an atmosphere this trajectory was never flown
      // through, and the panels promise that a disabled term is not computed.
      expect(s.airDensity).toBe(0);
      expect(s.dragArea).toBe(0);
    }
  }, 120000);

  it('never applies drag or J3 when integrating about the Moon', async () => {
    const cfg = buildScenario('lunar-orbit');
    cfg.integration.duration = 0.5 * SEC_PER_DAY;
    // Force them on: the force model must refuse them for a lunar centre.
    cfg.forces.atmosphericDrag = true;
    cfg.forces.earthJ3 = true;

    const res = await propagate(cfg, { yieldToEventLoop: false });
    expect(res.summary.dragDeltaVEquivalent).toBe(0);
    for (const s of res.samples) expect(s.dragAccel).toBe(0);
  }, 120000);
});
