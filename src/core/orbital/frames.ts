/**
 * Reference frames used by the attitude controller.
 *
 * Every frame is returned as an explicit orthonormal triad expressed in the
 * INERTIAL integration frame, together with human-readable axis labels. The
 * attitude rules only ever work through this interface, which is what stops
 * frames from being silently mixed (see docs/attitude-rules.md, and the
 * "Reference frame" readout in the Attitude panel).
 *
 * The integration frame is a central-body-centred inertial frame:
 *   - Earth-centred: ECI, equatorial, x toward the J2000 vernal equinox,
 *     z along the Earth mean rotation axis.
 *   - Moon-centred: MCI, axes PARALLEL to ECI, origin at the Moon.
 * Both are treated as non-rotating for force evaluation.
 */

import {
  type Vec3,
  cross,
  dot,
  norm,
  scale,
  sub,
  unit,
  anyPerpendicular,
} from '../vec3.ts';

export type FrameKind = 'rsw' | 'vnb' | 'sun' | 'inertial';

export interface Triad {
  /** Primary axis - the sail normal points here when both angles are zero. */
  e1: Vec3;
  /** Secondary axis - the first angle rotates e1 toward e2. */
  e2: Vec3;
  /** Tertiary axis - the second angle rotates out of the e1-e2 plane. */
  e3: Vec3;
}

export interface FrameDefinition extends Triad {
  kind: FrameKind;
  /** Display name, shown in the UI. */
  name: string;
  /** Labels for (e1, e2, e3). */
  axes: [string, string, string];
  /** Labels for the two steering angles, in order. */
  angleNames: [string, string];
  /** True when the triad had to fall back to a degenerate construction. */
  degenerate: boolean;
}

export const FRAME_LABELS: Record<FrameKind, string> = {
  rsw: 'Orbital RSW (radial / along-track / orbit normal)',
  vnb: 'Orbital VNB (velocity / normal / bi-normal)',
  sun: 'Sun-relative (cone / clock)',
  inertial: 'Central-body inertial (right ascension / declination)',
};

/**
 * Build the requested frame.
 *
 * @param r          spacecraft position in the inertial integration frame [m]
 * @param v          spacecraft velocity in the inertial integration frame [m/s]
 * @param sunToCraft unit vector from the Sun to the spacecraft (photon travel
 *                   direction). Only used by the 'sun' frame.
 */
export function buildFrame(
  kind: FrameKind,
  r: Vec3,
  v: Vec3,
  sunToCraft: Vec3,
): FrameDefinition {
  switch (kind) {
    case 'rsw':
      return rswFrame(r, v);
    case 'vnb':
      return vnbFrame(r, v);
    case 'sun':
      return sunFrame(r, v, sunToCraft);
    case 'inertial':
      return {
        kind: 'inertial',
        name: FRAME_LABELS.inertial,
        e1: [1, 0, 0],
        e2: [0, 1, 0],
        e3: [0, 0, 1],
        axes: ['X (equinox)', 'Y', 'Z (pole)'],
        angleNames: ['Right ascension', 'Declination'],
        degenerate: false,
      };
  }
}

/**
 * RSW / LVLH orbital frame.
 *   R = radial outward
 *   W = orbit normal (along specific angular momentum)
 *   S = W x R  (in-plane, in the direction of motion; equals v_hat for a
 *               circular orbit, and is the along-track direction generally)
 *
 * Sail normal at (0, 0) points radially OUTWARD, i.e. directly away from the
 * central body. A positive first angle tilts it toward the direction of
 * motion, which is the classic sail "pitch" used for orbit raising.
 */
function rswFrame(r: Vec3, v: Vec3): FrameDefinition {
  const R = unit(r);
  const h = cross(r, v);
  let W = unit(h);
  let degenerate = false;
  if (norm(h) === 0) {
    // Purely radial motion: the orbit plane is undefined.
    W = anyPerpendicular(R);
    degenerate = true;
  }
  const S = unit(cross(W, R));
  return {
    kind: 'rsw',
    name: FRAME_LABELS.rsw,
    e1: R,
    e2: S,
    e3: W,
    axes: ['R (radial out)', 'S (along-track)', 'W (orbit normal)'],
    angleNames: ['Pitch (radial to along-track)', 'Yaw (out of plane)'],
    degenerate,
  };
}

/**
 * VNB frame.
 *   V = velocity direction
 *   N = orbit normal
 *   B = N x V  (bi-normal, completes the triad)
 *
 * Sail normal at (0, 0) points along the VELOCITY vector. Because the sail can
 * only push away from the Sun this is often unachievable - the reported
 * incidence angle makes that visible.
 *
 * HANDEDNESS: B is deliberately N x V and NOT the V x N that some references
 * use. With V x N the triad (e1, e2, e3) = (V, B, N) satisfies
 * e1 x e2 = -e3, i.e. it is LEFT-handed, and a positive second steering angle
 * would then tilt the sail toward -N here while tilting it toward +W in the
 * RSW frame. Every frame in this module is right-handed so that the two
 * steering angles mean the same thing whichever frame the user picks.
 *
 * The consequence of this choice is that B points radially INWARD for a
 * prograde circular orbit, which the axis label states.
 */
function vnbFrame(r: Vec3, v: Vec3): FrameDefinition {
  const V = unit(v);
  const h = cross(r, v);
  let N = unit(h);
  let degenerate = false;
  if (norm(h) === 0) {
    N = anyPerpendicular(V);
    degenerate = true;
  }
  const B = unit(cross(N, V));
  return {
    kind: 'vnb',
    name: FRAME_LABELS.vnb,
    e1: V,
    e2: B,
    e3: N,
    axes: ['V (velocity)', 'B (bi-normal, inward for a circular orbit)', 'N (orbit normal)'],
    angleNames: ['Pitch (velocity toward bi-normal)', 'Yaw (out of plane)'],
    degenerate,
  };
}

/**
 * Sun-relative cone/clock frame.
 *
 *   e1 = u_hat, the Sun -> spacecraft direction. The sail normal at (0, 0)
 *        points directly away from the Sun, giving maximum force and zero
 *        transverse component.
 *   The CONE angle is the rotation away from u_hat; the CLOCK angle selects
 *   the azimuth about u_hat.
 *
 * The clock reference direction is the component of the orbit normal
 * perpendicular to the Sun line, so clock = 0 tilts the normal toward the
 * orbit normal and clock = 90 deg tilts it within the orbit plane. If the Sun
 * line happens to be parallel to the orbit normal that reference degenerates
 * and we fall back to an arbitrary (but continuous) perpendicular.
 */
function sunFrame(r: Vec3, v: Vec3, sunToCraft: Vec3): FrameDefinition {
  const u = unit(sunToCraft);
  const h = cross(r, v);
  let degenerate = false;

  // Component of the orbit normal perpendicular to the Sun line.
  let ref = sub(h, scale(u, dot(h, u)));
  if (norm(ref) < 1e-6 * Math.max(1, norm(h))) {
    ref = anyPerpendicular(u);
    degenerate = true;
  }
  const p = unit(ref);
  const q = unit(cross(u, p));

  return {
    kind: 'sun',
    name: FRAME_LABELS.sun,
    e1: u,
    e2: p,
    e3: q,
    axes: ['u (Sun to spacecraft)', 'p (orbit normal, projected)', 'q (u x p)'],
    angleNames: ['Cone angle', 'Clock angle'],
    degenerate,
  };
}

/**
 * Sail normal from two steering angles in the given frame.
 *
 * Convention (identical for every frame, so the UI can relabel freely):
 *
 *   n = cos(a2) * [ cos(a1) e1 + sin(a1) e2 ] + sin(a2) * e3
 *
 * so a1 = a2 = 0 gives n = e1.
 *
 * NOTE for the Sun frame: the two angles are (cone, clock) rather than a
 * spherical pair, so it is handled separately by `sailNormalConeClock`.
 */
export function sailNormalFromAngles(frame: Triad, a1: number, a2: number): Vec3 {
  const c2 = Math.cos(a2);
  const s2 = Math.sin(a2);
  const c1 = Math.cos(a1);
  const s1 = Math.sin(a1);
  return unit([
    c2 * (c1 * frame.e1[0] + s1 * frame.e2[0]) + s2 * frame.e3[0],
    c2 * (c1 * frame.e1[1] + s1 * frame.e2[1]) + s2 * frame.e3[1],
    c2 * (c1 * frame.e1[2] + s1 * frame.e2[2]) + s2 * frame.e3[2],
  ]);
}

/**
 * Sail normal from a cone/clock pair about the frame primary axis.
 *
 *   n = cos(cone) e1 + sin(cone) [ cos(clock) e2 + sin(clock) e3 ]
 */
export function sailNormalConeClock(frame: Triad, cone: number, clock: number): Vec3 {
  const cc = Math.cos(cone);
  const sc = Math.sin(cone);
  const ccl = Math.cos(clock);
  const scl = Math.sin(clock);
  return unit([
    cc * frame.e1[0] + sc * (ccl * frame.e2[0] + scl * frame.e3[0]),
    cc * frame.e1[1] + sc * (ccl * frame.e2[1] + scl * frame.e3[1]),
    cc * frame.e1[2] + sc * (ccl * frame.e2[2] + scl * frame.e3[2]),
  ]);
}

/**
 * Decompose an inertial vector into RSW components - used for the results
 * table so the user can read the acceleration in orbit-relative terms.
 */
export function toRsw(vecInertial: Vec3, r: Vec3, v: Vec3): Vec3 {
  const f = rswFrame(r, v);
  return [dot(vecInertial, f.e1), dot(vecInertial, f.e2), dot(vecInertial, f.e3)];
}
