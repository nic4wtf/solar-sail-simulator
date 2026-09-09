/**
 * Minimal 3-vector utilities.
 *
 * Vectors are plain `[x, y, z]` tuples so that trajectory samples serialise
 * directly to JSON/CSV and so the hot integration loop allocates as little as
 * possible. All functions are pure.
 */

export type Vec3 = [number, number, number];

export const vec = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const ZERO: Vec3 = [0, 0, 0];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const normSq = (a: Vec3): number => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
export const norm = (a: Vec3): number => Math.sqrt(normSq(a));

/** Unit vector. Returns [0,0,0] for a zero-length input rather than NaN. */
export function unit(a: Vec3): Vec3 {
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
}

/** Linear combination `a*sa + b*sb` — avoids a temporary in the integrators. */
export const lin2 = (a: Vec3, sa: number, b: Vec3, sb: number): Vec3 => [
  a[0] * sa + b[0] * sb,
  a[1] * sa + b[1] * sb,
  a[2] * sa + b[2] * sb,
];

/** Angle between two vectors [rad], numerically safe near 0 and pi. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  const c = Math.min(1, Math.max(-1, dot(a, b) / (na * nb)));
  return Math.acos(c);
}

/**
 * Component of `a` perpendicular to unit vector `n`, normalised.
 * Returns [0,0,0] when `a` is (anti)parallel to `n`.
 */
export function perpUnit(a: Vec3, n: Vec3): Vec3 {
  const d = dot(a, n);
  return unit(sub(a, scale(n, d)));
}

/** Rotate `v` about unit axis `k` by `angle` [rad] (Rodrigues' formula). */
export function rotateAbout(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kv = cross(k, v);
  const kdv = dot(k, v);
  return [
    v[0] * c + kv[0] * s + k[0] * kdv * (1 - c),
    v[1] * c + kv[1] * s + k[1] * kdv * (1 - c),
    v[2] * c + kv[2] * s + k[2] * kdv * (1 - c),
  ];
}

/** Any unit vector orthogonal to `n` (chosen for numerical stability). */
export function anyPerpendicular(n: Vec3): Vec3 {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  // Cross with whichever basis axis is least aligned with n.
  const helper: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  return unit(cross(n, helper));
}

/** Clamp helper used throughout the physics code. */
export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;
