/**
 * Validation: attitude rules, reference frames, steering law and the
 * expression parser.
 */

import { describe, expect, it } from 'vitest';
import { DEG, MU_EARTH, R_EARTH, RAD } from '../core/constants.ts';
import { angleBetween, cross, dot, norm, unit, type Vec3 } from '../core/vec3.ts';
import { buildFrame, sailNormalConeClock, sailNormalFromAngles } from '../core/orbital/frames.ts';
import { rvToElements } from '../core/orbital/elements.ts';
import {
  optimalIncidenceAngle,
  optimalNormal,
  steeringEfficiency,
  thrustDirectionVector,
} from '../core/attitude/optimal.ts';
import { evaluateAttitude, interpolateSchedule } from '../core/attitude/rules.ts';
import { compileExpression, validateExpression } from '../core/attitude/expression.ts';
import { EXPRESSION_VARIABLE_NAMES } from '../core/attitude/rules.ts';
import type { AttitudeInput } from '../core/attitude/types.ts';

/** A 500 km circular equatorial-ish state, with the Sun along +x. */
function testInput(): AttitudeInput {
  const r: Vec3 = [R_EARTH + 500e3, 0, 0];
  const v: Vec3 = [0, Math.sqrt(MU_EARTH / (R_EARTH + 500e3)), 0];
  // Sun far along -x, so sunToCraft points along +x.
  const sunToCraft: Vec3 = [1.5e11, 0, 0];
  return { t: 0, r, v, sunToCraft, elements: rvToElements(r, v, MU_EARTH), mu: MU_EARTH };
}

describe('reference frames', () => {
  it('builds orthonormal right-handed triads', () => {
    const { r, v, sunToCraft } = testInput();
    for (const kind of ['rsw', 'vnb', 'sun', 'inertial'] as const) {
      const f = buildFrame(kind, r, v, sunToCraft);
      expect(norm(f.e1)).toBeCloseTo(1, 12);
      expect(norm(f.e2)).toBeCloseTo(1, 12);
      expect(norm(f.e3)).toBeCloseTo(1, 12);
      expect(dot(f.e1, f.e2)).toBeCloseTo(0, 12);
      expect(dot(f.e2, f.e3)).toBeCloseTo(0, 12);
      expect(dot(f.e1, f.e3)).toBeCloseTo(0, 12);
      // Right-handed: e1 x e2 = e3
      const c = cross(f.e1, f.e2);
      expect(c[0]).toBeCloseTo(f.e3[0], 10);
      expect(c[1]).toBeCloseTo(f.e3[1], 10);
      expect(c[2]).toBeCloseTo(f.e3[2], 10);
      expect(f.degenerate).toBe(false);
    }
  });

  it('RSW: e1 is radial out, e3 is the orbit normal', () => {
    const { r, v, sunToCraft } = testInput();
    const f = buildFrame('rsw', r, v, sunToCraft);
    expect(angleBetween(f.e1, r)).toBeCloseTo(0, 10);
    expect(angleBetween(f.e3, cross(r, v))).toBeCloseTo(0, 10);
    // For a circular orbit the along-track axis coincides with the velocity.
    expect(angleBetween(f.e2, v)).toBeCloseTo(0, 8);
  });

  it('VNB: e1 is the velocity direction', () => {
    const { r, v, sunToCraft } = testInput();
    const f = buildFrame('vnb', r, v, sunToCraft);
    expect(angleBetween(f.e1, v)).toBeCloseTo(0, 10);
  });

  it('Sun frame: e1 is the Sun-to-spacecraft direction', () => {
    const { r, v, sunToCraft } = testInput();
    const f = buildFrame('sun', r, v, sunToCraft);
    expect(angleBetween(f.e1, sunToCraft)).toBeCloseTo(0, 10);
  });

  it('flags a degenerate frame for purely radial motion', () => {
    const r: Vec3 = [7000e3, 0, 0];
    const v: Vec3 = [100, 0, 0]; // parallel to r, so no orbit plane
    const f = buildFrame('rsw', r, v, [1e11, 0, 0]);
    expect(f.degenerate).toBe(true);
    // Even degenerate, the triad must remain usable.
    expect(norm(f.e3)).toBeCloseTo(1, 10);
  });

  it('zero angles give the frame primary axis', () => {
    const { r, v, sunToCraft } = testInput();
    const f = buildFrame('rsw', r, v, sunToCraft);
    const n = sailNormalFromAngles(f, 0, 0);
    expect(angleBetween(n, f.e1)).toBeCloseTo(0, 12);
  });

  it('cone/clock: cone 0 faces away from the Sun, cone 90 is edge-on', () => {
    const { r, v, sunToCraft } = testInput();
    const f = buildFrame('sun', r, v, sunToCraft);
    const facing = sailNormalConeClock(f, 0, 0);
    expect(angleBetween(facing, sunToCraft)).toBeCloseTo(0, 12);
    const edgeOn = sailNormalConeClock(f, Math.PI / 2, 0);
    expect(angleBetween(edgeOn, sunToCraft) * RAD).toBeCloseTo(90, 10);
  });
});

describe('locally optimal steering law', () => {
  it('gives alpha = 0 when the target is along the Sun line', () => {
    expect(optimalIncidenceAngle(0)).toBeCloseTo(0, 12);
  });

  it('gives alpha = 35.264 degrees for a perpendicular target', () => {
    expect(optimalIncidenceAngle(Math.PI / 2) * RAD).toBeCloseTo(35.2644, 3);
  });

  it('satisfies tan(theta - alpha) = 2 tan(alpha)', () => {
    for (const thetaDeg of [5, 20, 45, 60, 90, 120, 150, 175]) {
      const theta = thetaDeg * DEG;
      const alpha = optimalIncidenceAngle(theta);
      const lhs = Math.tan(theta - alpha);
      const rhs = 2 * Math.tan(alpha);
      expect(lhs).toBeCloseTo(rhs, 8);
    }
  });

  it('genuinely maximises the projected force, verified by brute force', () => {
    for (const thetaDeg of [10, 30, 50, 70, 90, 110, 140]) {
      const theta = thetaDeg * DEG;
      const alphaOpt = optimalIncidenceAngle(theta);
      const objective = (a: number) => Math.cos(a) ** 2 * Math.cos(theta - a);
      const best = objective(alphaOpt);
      // No nearby angle may do better.
      for (let a = 0; a <= Math.PI / 2; a += 0.0005) {
        expect(objective(a)).toBeLessThanOrEqual(best + 1e-12);
      }
    }
  });

  it('alpha increases monotonically with theta and stays within bounds', () => {
    let previous = -1;
    for (let deg = 0; deg <= 90; deg += 1) {
      const alpha = optimalIncidenceAngle(deg * DEG) * RAD;
      expect(alpha).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(alpha).toBeLessThanOrEqual(35.2645);
      previous = alpha;
    }
  });

  it('the optimal normal lies in the plane of the Sun line and the target', () => {
    const u: Vec3 = [1, 0, 0];
    const d: Vec3 = [0, 1, 0];
    const n = optimalNormal(u, d);
    // Must be perpendicular to the plane normal (u x d) = +z
    expect(Math.abs(n[2])).toBeLessThan(1e-12);
    // And tilted from u by the optimal angle, toward d.
    expect(angleBetween(n, u) * RAD).toBeCloseTo(35.2644, 3);
    expect(dot(n, d)).toBeGreaterThan(0);
  });

  it('steering efficiency is 1 on-axis and 0.385 perpendicular', () => {
    expect(steeringEfficiency([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 10);
    // cos^2(35.26) * cos(90 - 35.26) = 0.6667 * 0.5774 = 0.3849
    expect(steeringEfficiency([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.3849, 3);
  });

  it('resolves named thrust directions correctly', () => {
    const { r, v } = testInput();
    expect(angleBetween(thrustDirectionVector('prograde', r, v), v)).toBeCloseTo(0, 10);
    expect(angleBetween(thrustDirectionVector('retrograde', r, v), v) * RAD).toBeCloseTo(180, 8);
    expect(angleBetween(thrustDirectionVector('radialOut', r, v), r)).toBeCloseTo(0, 10);
    expect(
      angleBetween(thrustDirectionVector('normal', r, v), cross(r, v)),
    ).toBeCloseTo(0, 10);
    expect(
      angleBetween(
        thrustDirectionVector('antiNormal', r, v),
        thrustDirectionVector('normal', r, v),
      ) * RAD,
    ).toBeCloseTo(180, 8);
  });
});

describe('orbit-fraction schedule interpolation', () => {
  const knots = [
    { fraction: 0, angle1: 0, angle2: 0 },
    { fraction: 0.5, angle1: 100, angle2: -100 },
  ];

  it('reproduces knot values exactly at the knots', () => {
    expect(interpolateSchedule(knots, 0)[0]).toBeCloseTo(0, 12);
    expect(interpolateSchedule(knots, 0.5)[0]).toBeCloseTo(100, 12);
  });

  it('interpolates linearly between knots', () => {
    expect(interpolateSchedule(knots, 0.25)[0]).toBeCloseTo(50, 12);
    expect(interpolateSchedule(knots, 0.25)[1]).toBeCloseTo(-50, 12);
  });

  it('wraps continuously from the last knot back to the first', () => {
    // From 0.5 (=100) round to 1.0/0.0 (=0), so 0.75 must be halfway: 50.
    expect(interpolateSchedule(knots, 0.75)[0]).toBeCloseTo(50, 12);
  });

  it('is periodic in the phase argument', () => {
    for (const x of [0.1, 0.37, 0.62, 0.94]) {
      expect(interpolateSchedule(knots, x)[0]).toBeCloseTo(
        interpolateSchedule(knots, x + 1)[0],
        12,
      );
      expect(interpolateSchedule(knots, x)[0]).toBeCloseTo(
        interpolateSchedule(knots, x - 1)[0],
        12,
      );
    }
  });

  it('handles unsorted knots and a single knot', () => {
    const unsorted = [
      { fraction: 0.8, angle1: 8, angle2: 0 },
      { fraction: 0.2, angle1: 2, angle2: 0 },
    ];
    expect(interpolateSchedule(unsorted, 0.5)[0]).toBeCloseTo(5, 12);
    expect(interpolateSchedule([{ fraction: 0.3, angle1: 42, angle2: 7 }], 0.9)).toEqual([42, 7]);
    expect(interpolateSchedule([], 0.5)).toEqual([0, 0]);
  });
});

describe('attitude rule dispatch', () => {
  it('every rule returns a unit normal and names its frame', () => {
    const input = testInput();
    const configs = [
      { kind: 'fixed', frame: 'rsw', angle1: 0.3, angle2: 0.1 },
      {
        kind: 'timeBased',
        frame: 'rsw',
        profile: 'ramp',
        initialAngle: 0,
        rate: 1e-5,
        minAngle: -1,
        maxAngle: 1,
        angle2: 0,
      },
      {
        kind: 'orbitFraction',
        frame: 'sun',
        phaseVariable: 'sunPhase',
        knots: [{ fraction: 0, angle1: 0.5, angle2: 0 }],
      },
      { kind: 'sunRelative', cone: 0.4, clock: 0.9 },
      { kind: 'optimalDirection', direction: 'prograde' },
      { kind: 'expression', frame: 'sun', angle1Expr: '35', angle2Expr: '0' },
    ] as const;

    for (const cfg of configs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out = evaluateAttitude(cfg as any, input);
      expect(norm(out.normal)).toBeCloseTo(1, 10);
      expect(out.frameName.length).toBeGreaterThan(0);
      expect(out.angleNames.length).toBe(2);
      expect(Number.isFinite(out.angles[0])).toBe(true);
    }
  });

  it('a time-based ramp respects its clamps', () => {
    const cfg = {
      kind: 'timeBased' as const,
      frame: 'rsw' as const,
      profile: 'ramp' as const,
      initialAngle: 0,
      rate: 1, // 1 rad/s - will saturate immediately
      minAngle: -0.5,
      maxAngle: 0.5,
      angle2: 0,
    };
    const late = evaluateAttitude(cfg, { ...testInput(), t: 1000 });
    expect(late.angles[0]).toBeCloseTo(0.5, 12);
    const early = evaluateAttitude({ ...cfg, rate: -1 }, { ...testInput(), t: 1000 });
    expect(early.angles[0]).toBeCloseTo(-0.5, 12);
  });

  it('a triangle profile oscillates within its band', () => {
    const cfg = {
      kind: 'timeBased' as const,
      frame: 'rsw' as const,
      profile: 'triangle' as const,
      initialAngle: -0.5,
      rate: 0.01,
      minAngle: -0.5,
      maxAngle: 0.5,
      angle2: 0,
    };
    for (let t = 0; t < 1000; t += 7) {
      const a = evaluateAttitude(cfg, { ...testInput(), t }).angles[0];
      expect(a).toBeGreaterThanOrEqual(-0.5 - 1e-9);
      expect(a).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('falls back to Sun-facing and flags an invalid expression', () => {
    const out = evaluateAttitude(
      { kind: 'expression', frame: 'sun', angle1Expr: 'bogus(', angle2Expr: '0' },
      testInput(),
    );
    expect(out.degenerate).toBe(true);
    expect(angleBetween(out.normal, testInput().sunToCraft)).toBeCloseTo(0, 8);
  });

  it('optimalDirection prograde beats a Sun-facing sail at along-track force', () => {
    const input = testInput();
    const optimal = evaluateAttitude(
      { kind: 'optimalDirection', direction: 'prograde' },
      input,
    );
    const facing = evaluateAttitude({ kind: 'sunRelative', cone: 0, clock: 0 }, input);

    // Here the Sun line is radial (+x) and the velocity is +y, so theta = 90
    // degrees: the Sun-facing sail delivers exactly zero along-track force,
    // while the optimal law delivers the maximum available.
    const vHat = unit(input.v);
    // Ideal-sail force direction is the normal, magnitude proportional to cos^2.
    const along = (n: Vec3) => dot(n, vHat) * dot(unit(input.sunToCraft), n) ** 2;
    expect(along(optimal.normal)).toBeGreaterThan(along(facing.normal));
    expect(along(facing.normal)).toBeCloseTo(0, 10);
  });
});

describe('expression parser', () => {
  const vars = EXPRESSION_VARIABLE_NAMES;

  it('evaluates arithmetic with correct precedence', () => {
    const cases: Array<[string, number]> = [
      ['1 + 2 * 3', 7],
      ['(1 + 2) * 3', 9],
      ['2 ^ 3 ^ 2', 512], // right-associative
      ['-2 ^ 2', -4], // unary minus binds looser than ^
      ['10 / 4', 2.5],
      ['7 % 3', 1],
      ['2 * pi', 2 * Math.PI],
      ['1e-3 * 1000', 1],
      ['-(3 - 5)', 2],
    ];
    for (const [src, want] of cases) {
      expect(compileExpression(src, vars).evaluate({})).toBeCloseTo(want, 10);
    }
  });

  it('evaluates whitelisted functions', () => {
    expect(compileExpression('sin(0)', vars).evaluate({})).toBeCloseTo(0, 12);
    expect(compileExpression('cos(pi)', vars).evaluate({})).toBeCloseTo(-1, 12);
    expect(compileExpression('sqrt(16)', vars).evaluate({})).toBe(4);
    expect(compileExpression('deg(pi)', vars).evaluate({})).toBeCloseTo(180, 10);
    expect(compileExpression('rad(180)', vars).evaluate({})).toBeCloseTo(Math.PI, 12);
    expect(compileExpression('max(3, 9)', vars).evaluate({})).toBe(9);
    expect(compileExpression('clamp(15, 0, 10)', vars).evaluate({})).toBe(10);
    expect(compileExpression('if(1, 40, 90)', vars).evaluate({})).toBe(40);
    expect(compileExpression('if(-1, 40, 90)', vars).evaluate({})).toBe(90);
    expect(compileExpression('mod(-1, 360)', vars).evaluate({})).toBe(359);
  });

  it('substitutes variables', () => {
    const c = compileExpression('35 * sin(rad(nu)) + tDays', vars);
    expect(c.evaluate({ nu: 90, tDays: 2 })).toBeCloseTo(37, 10);
    // A variable that is absent reads as zero rather than NaN.
    expect(c.evaluate({})).toBeCloseTo(0, 10);
  });

  it('reproduces the feathering schedule formula', () => {
    const c = compileExpression('if(sunPhase - 180, 35, 90)', vars);
    expect(c.evaluate({ sunPhase: 270 })).toBe(35);
    expect(c.evaluate({ sunPhase: 90 })).toBe(90);
  });

  it('rejects unknown names and malformed input', () => {
    for (const bad of [
      'window',
      'alert(1)',
      'process.exit',
      'nu +',
      '((1)',
      '1 + + ',
      'sin()',
      'atan2(1)',
      '',
      'foo(1)',
      '1 @ 2',
    ]) {
      expect(validateExpression(bad, vars)).not.toBeNull();
    }
  });

  it('accepts every documented example', () => {
    for (const good of [
      'if(sunPhase - 180, 35, 90)',
      '35 + 20 * sin(2 * pi * tDays)',
      '35 * sin(rad(nu))',
      'if(abs(betaAngle) - 20, 0, 90)',
      '0',
    ]) {
      expect(validateExpression(good, vars)).toBeNull();
    }
  });

  it('never returns a non-finite value', () => {
    // Division by zero and out-of-domain calls must degrade to 0, not NaN,
    // because the result feeds straight into the integrator.
    expect(compileExpression('1 / 0', vars).evaluate({})).toBe(0);
    expect(compileExpression('sqrt(-1)', vars).evaluate({})).toBe(0);
    expect(compileExpression('log(0)', vars).evaluate({})).toBe(0);
  });

  it('refuses an over-long expression', () => {
    expect(validateExpression('1+'.repeat(400) + '1', vars)).not.toBeNull();
  });
});
