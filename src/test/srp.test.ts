/**
 * Validation: solar radiation pressure and the sail force model (spec S28).
 */

import { describe, expect, it } from 'vitest';
import {
  AU,
  C_LIGHT,
  RAD,
  SOLAR_IRRADIANCE_1AU_CLASSICAL,
  SRP_1AU_CLASSICAL,
  DEG,
} from '../core/constants.ts';
import { dot, norm, unit } from '../core/vec3.ts';
import { paToUpa } from '../core/units.ts';
import {
  DEFAULT_SAIL,
  DEFAULT_SPACECRAFT,
  IDEAL_SAIL,
  normalIncidenceCoefficient,
  pressureAt,
  sailPerformance,
} from '../core/sail/sail.ts';
import { solarRadiationPressure } from '../core/forces/srp.ts';
import { illuminationFraction } from '../core/environment/shadow.ts';
import { R_EARTH } from '../core/constants.ts';

const MASS = 100;
/** Sun at the origin, spacecraft at 1 AU along +x. */
const AT_1AU: [number, number, number] = [AU, 0, 0];

describe('radiation pressure magnitude', () => {
  it('reproduces P0 = 4.56 uN/m^2 at 1 AU', () => {
    expect(paToUpa(SRP_1AU_CLASSICAL)).toBeCloseTo(4.563, 3);
    // And it really is irradiance / c.
    expect(SRP_1AU_CLASSICAL).toBeCloseTo(SOLAR_IRRADIANCE_1AU_CLASSICAL / C_LIGHT, 15);
  });

  it('scales as the inverse square of heliocentric distance', () => {
    const p1 = pressureAt(DEFAULT_SAIL, AU);
    const p2 = pressureAt(DEFAULT_SAIL, 2 * AU);
    const pHalf = pressureAt(DEFAULT_SAIL, 0.5 * AU);

    expect(p2 / p1).toBeCloseTo(0.25, 12);
    expect(pHalf / p1).toBeCloseTo(4, 12);

    // Spot-check against the known values at the inner planets.
    expect(paToUpa(pressureAt(DEFAULT_SAIL, 0.723 * AU))).toBeCloseTo(8.73, 1); // Venus
    expect(paToUpa(pressureAt(DEFAULT_SAIL, 1.524 * AU))).toBeCloseTo(1.965, 2); // Mars
  });
});

describe('ideal sail reduction', () => {
  it('gives exactly 2 P A at normal incidence', () => {
    const res = solarRadiationPressure(IDEAL_SAIL, MASS, AT_1AU, [1, 0, 0], 1);
    const expected = 2 * SRP_1AU_CLASSICAL * IDEAL_SAIL.area;
    expect(res.force[0]).toBeCloseTo(expected, 12);
    expect(res.force[1]).toBeCloseTo(0, 15);
    expect(res.force[2]).toBeCloseTo(0, 15);
    expect(res.incidence).toBeCloseTo(0, 12);
    expect(res.transverseForce).toBeCloseTo(0, 15);
  });

  it('follows 2 P A cos^2(alpha) with the force along the normal only', () => {
    for (const alphaDeg of [0, 15, 30, 35.264, 45, 60, 75, 89]) {
      const alpha = alphaDeg * DEG;
      // Normal tilted by alpha from the Sun line, in the x-y plane.
      const n: [number, number, number] = [Math.cos(alpha), Math.sin(alpha), 0];
      const res = solarRadiationPressure(IDEAL_SAIL, MASS, AT_1AU, n, 1);

      const expectedMag = 2 * SRP_1AU_CLASSICAL * IDEAL_SAIL.area * Math.cos(alpha) ** 2;
      expect(norm(res.force)).toBeCloseTo(expectedMag, 10);
      expect(res.incidence * RAD).toBeCloseTo(alphaDeg, 8);
      // Force must be purely along the (effective) normal.
      const alongNormal = dot(res.force, unit(n));
      expect(alongNormal).toBeCloseTo(expectedMag, 10);
      expect(res.transverseForce).toBeCloseTo(0, 14);
    }
  });

  it('the ideal force-model option matches 2 eta P A cos^2(alpha)', () => {
    const sail = { ...DEFAULT_SAIL, forceModel: 'ideal' as const, efficiency: 0.85 };
    const alpha = 40 * DEG;
    const n: [number, number, number] = [Math.cos(alpha), 0, Math.sin(alpha)];
    const res = solarRadiationPressure(sail, MASS, AT_1AU, n, 1);
    const expected = 2 * 0.85 * SRP_1AU_CLASSICAL * sail.area * Math.cos(alpha) ** 2;
    expect(norm(res.force)).toBeCloseTo(expected, 12);
  });
});

describe('maximum transverse force occurs at 35.26 degrees', () => {
  it('is the peak of cos^2(alpha) sin(alpha) for an ideal sail', () => {
    // Scan the transverse (in-plane, perpendicular to the Sun line) component.
    let best = { alpha: 0, transverse: -Infinity };
    for (let deg = 0; deg <= 90; deg += 0.01) {
      const alpha = deg * DEG;
      const n: [number, number, number] = [Math.cos(alpha), Math.sin(alpha), 0];
      const res = solarRadiationPressure(IDEAL_SAIL, MASS, AT_1AU, n, 1);
      // Sun line is +x, so the transverse direction is +y.
      const transverse = res.force[1];
      if (transverse > best.transverse) best = { alpha: deg, transverse };
    }
    expect(best.alpha).toBeCloseTo(35.264, 1);
  });
});

describe('sail orientation behaviour (spec S28)', () => {
  it('produces no force when edge-on to the Sun', () => {
    const res = solarRadiationPressure(IDEAL_SAIL, MASS, AT_1AU, [0, 1, 0], 1);
    expect(norm(res.force)).toBeCloseTo(0, 14);
  });

  it('force decreases monotonically as the sail is tilted away', () => {
    let previous = Infinity;
    for (const deg of [0, 10, 20, 30, 40, 50, 60, 70, 80, 89]) {
      const alpha = deg * DEG;
      const n: [number, number, number] = [Math.cos(alpha), Math.sin(alpha), 0];
      const mag = norm(solarRadiationPressure(IDEAL_SAIL, MASS, AT_1AU, n, 1).force);
      expect(mag).toBeLessThan(previous);
      previous = mag;
    }
  });

  it('always pushes anti-sunward, flipping a reversed normal', () => {
    // A sail is a two-sided sheet: commanding the normal toward the Sun must
    // give the same force as commanding it away, not a force toward the Sun.
    const away = solarRadiationPressure(IDEAL_SAIL, MASS, AT_1AU, [1, 0, 0], 1);
    const toward = solarRadiationPressure(IDEAL_SAIL, MASS, AT_1AU, [-1, 0, 0], 1);

    expect(toward.flipped).toBe(true);
    expect(away.flipped).toBe(false);
    expect(toward.force[0]).toBeCloseTo(away.force[0], 12);
    // The force component along the Sun line must be positive (anti-sunward)
    // in both cases.
    expect(toward.force[0]).toBeGreaterThan(0);
  });

  it('reverses the transverse force when the tilt is reversed', () => {
    const alpha = 35 * DEG;
    const plus = solarRadiationPressure(
      DEFAULT_SAIL,
      MASS,
      AT_1AU,
      [Math.cos(alpha), Math.sin(alpha), 0],
      1,
    );
    const minus = solarRadiationPressure(
      DEFAULT_SAIL,
      MASS,
      AT_1AU,
      [Math.cos(alpha), -Math.sin(alpha), 0],
      1,
    );
    // Anti-sunward components equal, transverse components mirrored.
    expect(minus.force[0]).toBeCloseTo(plus.force[0], 14);
    expect(minus.force[1]).toBeCloseTo(-plus.force[1], 14);
  });
});

describe('non-ideal optical model', () => {
  it('always produces less force than an ideal sail', () => {
    for (const deg of [0, 20, 45, 70]) {
      const alpha = deg * DEG;
      const n: [number, number, number] = [Math.cos(alpha), Math.sin(alpha), 0];
      const real = norm(solarRadiationPressure(DEFAULT_SAIL, MASS, AT_1AU, n, 1).force);
      const ideal = norm(solarRadiationPressure(IDEAL_SAIL, MASS, AT_1AU, n, 1).force);
      expect(real).toBeLessThan(ideal);
    }
  });

  it('has a normal-incidence coefficient of about 1.83 for the default sail', () => {
    // The standard aluminium-on-Kapton reference sail.
    expect(normalIncidenceCoefficient(DEFAULT_SAIL)).toBeCloseTo(1.816, 2);
    expect(normalIncidenceCoefficient(IDEAL_SAIL)).toBeCloseTo(2, 10);
  });

  it('produces a non-zero transverse force at oblique incidence', () => {
    // This is the qualitative difference from the ideal model.
    const alpha = 45 * DEG;
    const n: [number, number, number] = [Math.cos(alpha), Math.sin(alpha), 0];
    const res = solarRadiationPressure(DEFAULT_SAIL, MASS, AT_1AU, n, 1);
    expect(res.transverseForce).toBeGreaterThan(0);
    // (1 - rho s - tau) = 1 - 0.88*0.94 = 0.1728
    const PA = SRP_1AU_CLASSICAL * DEFAULT_SAIL.area;
    const expected = PA * Math.cos(alpha) * Math.sin(alpha) * (1 - 0.88 * 0.94);
    expect(res.transverseForce).toBeCloseTo(expected, 12);
  });

  it('transmissivity strictly reduces the force', () => {
    const opaque = { ...DEFAULT_SAIL, transmissivity: 0 };
    const leaky = { ...DEFAULT_SAIL, transmissivity: 0.3 };
    const a = norm(solarRadiationPressure(opaque, MASS, AT_1AU, [1, 0, 0], 1).force);
    const b = norm(solarRadiationPressure(leaky, MASS, AT_1AU, [1, 0, 0], 1).force);
    expect(b).toBeLessThan(a);
  });
});

describe('characteristic acceleration', () => {
  it('is 2 P0 (A/m) for an ideal sail', () => {
    const perf = sailPerformance({ ...IDEAL_SAIL, area: 100 }, { ...DEFAULT_SPACECRAFT, dryMass: 100 });
    expect(perf.areaToMass).toBeCloseTo(1, 12);
    expect(perf.characteristicAcceleration).toBeCloseTo(2 * SRP_1AU_CLASSICAL * 1, 15);
    // 9.13 um/s^2 for 1 m^2/kg - the standard textbook figure.
    expect(perf.characteristicAcceleration * 1e6).toBeCloseTo(9.126, 2);
  });

  it('scales linearly with the area-to-mass ratio', () => {
    const a1 = sailPerformance({ ...IDEAL_SAIL, area: 100 }, DEFAULT_SPACECRAFT)
      .characteristicAcceleration;
    const a2 = sailPerformance({ ...IDEAL_SAIL, area: 200 }, DEFAULT_SPACECRAFT)
      .characteristicAcceleration;
    expect(a2 / a1).toBeCloseTo(2, 12);
  });

  it('gives a lightness number of 1 at the classical critical loading', () => {
    // beta = 1 requires a_c equal to solar gravity at 1 AU = 5.93 mm/s^2,
    // which for an ideal sail means A/m = 5.93e-3 / (2 * 4.563e-6) = 650 m^2/kg.
    const perf = sailPerformance(
      { ...IDEAL_SAIL, area: 650 },
      { ...DEFAULT_SPACECRAFT, dryMass: 1 },
    );
    expect(perf.lightnessNumber).toBeCloseTo(1, 1);
  });
});

describe('eclipse geometry', () => {
  const SUN: [number, number, number] = [AU, 0, 0];
  const EARTH: [number, number, number] = [0, 0, 0];

  it('reports full sunlight on the sunward side', () => {
    const craft: [number, number, number] = [R_EARTH + 500e3, 0, 0];
    expect(illuminationFraction(craft, SUN, EARTH, R_EARTH)).toBe(1);
  });

  it('reports total eclipse directly behind the Earth', () => {
    const craft: [number, number, number] = [-(R_EARTH + 500e3), 0, 0];
    expect(illuminationFraction(craft, SUN, EARTH, R_EARTH)).toBe(0);
  });

  it('reports full sunlight well outside the shadow cylinder', () => {
    // Behind the Earth along the anti-Sun axis, but far off to the side.
    const craft: [number, number, number] = [-(R_EARTH + 500e3), 3 * R_EARTH, 0];
    expect(illuminationFraction(craft, SUN, EARTH, R_EARTH)).toBe(1);
  });

  it('produces a monotonic penumbra ramp across the shadow edge', () => {
    // Sweep across the terminator at a fixed anti-sunward distance.
    const x = -(R_EARTH + 500e3);
    let previous = -1;
    let sawPartial = false;
    for (let y = 0; y <= 1.5 * R_EARTH; y += R_EARTH / 400) {
      const f = illuminationFraction([x, y, 0], SUN, EARTH, R_EARTH);
      expect(f).toBeGreaterThanOrEqual(previous - 1e-12);
      if (f > 0 && f < 1) sawPartial = true;
      previous = f;
    }
    expect(sawPartial).toBe(true);
    expect(previous).toBe(1);
  });

  it('gives an eclipse fraction near the analytic value for a LEO orbit', () => {
    // For a circular orbit of radius r with the Sun in the orbit plane, the
    // shadowed arc half-angle is acos(R_earth / r), so the eclipsed fraction
    // is (1/pi) * asin(R_earth / r) ... measured here by direct sampling.
    const r = R_EARTH + 500e3;
    let shadowed = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const th = (2 * Math.PI * i) / N;
      const f = illuminationFraction(
        [r * Math.cos(th), r * Math.sin(th), 0],
        SUN,
        EARTH,
        R_EARTH,
      );
      if (f < 0.5) shadowed++;
    }
    const fraction = shadowed / N;
    // Analytic: asin(Re/r)/pi for a Sun in the orbit plane.
    const analytic = Math.asin(R_EARTH / r) / Math.PI;
    expect(fraction).toBeCloseTo(analytic, 2);
    // Sanity: about 35% for a 500 km orbit with the Sun in plane.
    expect(fraction).toBeGreaterThan(0.3);
    expect(fraction).toBeLessThan(0.4);
  });

  it('zero illumination produces zero sail force', () => {
    const res = solarRadiationPressure(IDEAL_SAIL, MASS, AT_1AU, [1, 0, 0], 0);
    expect(norm(res.force)).toBe(0);
    expect(res.illumination).toBe(0);
  });

  it('partial illumination scales the force linearly', () => {
    const full = solarRadiationPressure(IDEAL_SAIL, MASS, AT_1AU, [1, 0, 0], 1);
    const half = solarRadiationPressure(IDEAL_SAIL, MASS, AT_1AU, [1, 0, 0], 0.5);
    expect(norm(half.force) / norm(full.force)).toBeCloseTo(0.5, 12);
  });
});
