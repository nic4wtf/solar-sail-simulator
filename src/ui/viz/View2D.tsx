/**
 * 2D trajectory view (Canvas 2D).
 *
 * Shows the trajectory projected onto a chosen plane. Deliberately NOT a
 * simplified 3D view: an orthographic projection with a visible grid, a scale
 * bar and exact axis labels is often easier to read quantitatively than the
 * perspective 3D view, particularly for judging whether an orbit is growing.
 *
 * Projections available:
 *   XY / XZ / YZ - inertial coordinate planes
 *   orbit        - the instantaneous orbit plane of the FIRST sample, which
 *                  turns a near-circular orbit into a near-circle regardless
 *                  of its inclination
 */

import { useEffect, useRef, useState } from 'react';
import { R_EARTH, R_MOON } from '../../core/constants.ts';
import { type Vec3, cross, norm, unit } from '../../core/vec3.ts';
import { moonPosition } from '../../core/environment/moon.ts';
import { sunDirection } from '../../core/environment/sun.ts';
import { selectPalette, useStore } from '../../state/store.ts';
import { PALETTES } from '../theme.ts';

type Projection = 'xy' | 'xz' | 'yz' | 'orbit';

const PROJECTION_LABELS: Record<Projection, string> = {
  xy: 'X-Y plane (equatorial)',
  xz: 'X-Z plane',
  yz: 'Y-Z plane',
  orbit: 'Initial orbit plane',
};

/**
 * Canvas 2D takes CSS colour strings and cannot resolve CSS custom
 * properties, so the palette is read from the store rather than from
 * styles.css. `theme.ts` is the single source both share.
 */
function canvasColors(theme: 'dark' | 'light') {
  const p = PALETTES[theme];
  return {
    bg: p.canvasBackground,
    grid: p.canvasGrid,
    gridMajor: p.canvasGridMajor,
    earth: p.canvasEarth,
    earthEdge: p.canvasEarthEdge,
    moon: p.canvasMoon,
    trail: p.canvasTrail,
    future: p.canvasFuture,
    craft: p.canvasCraft,
    text: p.canvasText,
    sun: `#${p.vecSun.toString(16).padStart(6, '0')}`,
    normal: `#${p.vecNormal.toString(16).padStart(6, '0')}`,
    velocity: `#${p.vecVelocity.toString(16).padStart(6, '0')}`,
    accel: `#${p.vecAccel.toString(16).padStart(6, '0')}`,
  };
}

/** Orthonormal basis for the chosen projection: (horizontal, vertical). */
function projectionBasis(
  projection: Projection,
  r0: Vec3,
  v0: Vec3,
): { u: Vec3; w: Vec3; uLabel: string; wLabel: string } {
  switch (projection) {
    case 'xy':
      return { u: [1, 0, 0], w: [0, 1, 0], uLabel: 'X', wLabel: 'Y' };
    case 'xz':
      return { u: [1, 0, 0], w: [0, 0, 1], uLabel: 'X', wLabel: 'Z' };
    case 'yz':
      return { u: [0, 1, 0], w: [0, 0, 1], uLabel: 'Y', wLabel: 'Z' };
    case 'orbit': {
      const h = cross(r0, v0);
      if (norm(h) === 0) return { u: [1, 0, 0], w: [0, 1, 0], uLabel: 'X', wLabel: 'Y' };
      const u = unit(r0);
      const n = unit(h);
      const w = unit(cross(n, u));
      // Kept short: these are drawn as corner annotations and a long string
      // runs underneath the vector legend.
      return { u, w, uLabel: 'radial (t=0)', wLabel: 'along-track (t=0)' };
    }
  }
}

/** Choose a round grid spacing that yields roughly 8 divisions. */
function niceStep(span: number): number {
  const raw = span / 8;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const mult = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return mult * mag;
}

function formatKm(m: number): string {
  const km = m / 1000;
  if (Math.abs(km) >= 1e6) return `${(km / 1e6).toFixed(2)}e6 km`;
  if (Math.abs(km) >= 1000) return `${(km / 1000).toFixed(0)}e3 km`;
  return `${km.toFixed(0)} km`;
}

export function View2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [projection, setProjection] = useState<Projection>('orbit');
  const palette = useStore(selectPalette);
  const themeName = palette.name;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    let raf = 0;
    let acc = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = parent.clientWidth * dpr;
      canvas.height = parent.clientHeight * dpr;
      canvas.style.width = `${parent.clientWidth}px`;
      canvas.style.height = `${parent.clientHeight}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    const COLORS = canvasColors(themeName);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;
      const dpr = Math.min(window.devicePixelRatio, 2);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, W, H);

      const st = useStore.getState();
      const res = st.result;

      if (!res || res.samples.length === 0) {
        ctx.fillStyle = COLORS.text;
        ctx.font = `${13 * dpr}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('Press Run to propagate a trajectory', W / 2, H / 2);
        return;
      }

      const samples = res.samples;
      const idx = Math.min(st.cursor, samples.length - 1);
      const s = samples[idx];
      const centre = res.config.centralBody;
      const bodyRadius = centre === 'earth' ? R_EARTH : R_MOON;

      const r0: Vec3 = [samples[0].x, samples[0].y, samples[0].z];
      const v0: Vec3 = [samples[0].vx, samples[0].vy, samples[0].vz];
      const { u, w, uLabel, wLabel } = projectionBasis(projection, r0, v0);

      // --- Scale ------------------------------------------------------
      let maxExtent = bodyRadius * 1.4;
      for (const p of samples) {
        const pu = Math.abs(p.x * u[0] + p.y * u[1] + p.z * u[2]);
        const pw = Math.abs(p.x * w[0] + p.y * w[1] + p.z * w[2]);
        if (pu > maxExtent) maxExtent = pu;
        if (pw > maxExtent) maxExtent = pw;
      }
      const margin = 44 * dpr;
      const scale = (Math.min(W, H) / 2 - margin) / (maxExtent * 1.06);
      const cx = W / 2;
      const cy = H / 2;

      const px = (p: { x: number; y: number; z: number }) =>
        cx + (p.x * u[0] + p.y * u[1] + p.z * u[2]) * scale;
      const py = (p: { x: number; y: number; z: number }) =>
        cy - (p.x * w[0] + p.y * w[1] + p.z * w[2]) * scale;

      // --- Grid -------------------------------------------------------
      const step = niceStep(maxExtent * 2);
      ctx.lineWidth = 1 * dpr;
      ctx.font = `${9.5 * dpr}px ui-monospace, monospace`;
      ctx.textAlign = 'left';
      for (let k = -20; k <= 20; k++) {
        const val = k * step;
        const sx = cx + val * scale;
        const sy = cy - val * scale;
        const major = k === 0;
        ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.grid;
        if (sx > 0 && sx < W) {
          ctx.beginPath();
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, H);
          ctx.stroke();
        }
        if (sy > 0 && sy < H) {
          ctx.beginPath();
          ctx.moveTo(0, sy);
          ctx.lineTo(W, sy);
          ctx.stroke();
        }
      }

      // --- Central body ------------------------------------------------
      const bodyPx = bodyRadius * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2 * dpr, bodyPx), 0, Math.PI * 2);
      ctx.fillStyle = centre === 'earth' ? COLORS.earth : COLORS.moon;
      // A 0.75 alpha fill reads as a solid body against a dark sky but looks
      // washed out on a light one, so light mode draws the body opaque.
      ctx.globalAlpha = themeName === 'dark' ? 0.75 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = centre === 'earth' ? COLORS.earthEdge : COLORS.text;
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();

      // --- Moon (Earth-centred runs) -----------------------------------
      if (centre === 'earth') {
        const mp = moonPosition(s.jd, res.config.moonModel);
        const mPoint = { x: mp[0], y: mp[1], z: mp[2] };
        const mx = px(mPoint);
        const my = py(mPoint);
        if (mx > -100 && mx < W + 100 && my > -100 && my < H + 100) {
          ctx.beginPath();
          ctx.arc(mx, my, Math.max(2.5 * dpr, R_MOON * scale), 0, Math.PI * 2);
          ctx.fillStyle = COLORS.moon;
          ctx.fill();
          ctx.fillStyle = COLORS.text;
          ctx.font = `${9.5 * dpr}px ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.fillText('Moon', mx, my - 8 * dpr - Math.max(2.5 * dpr, R_MOON * scale));
        }
      }

      // --- Trajectory ---------------------------------------------------
      if (st.showOrbitTrail) {
        if (st.showFullTrajectory) {
          ctx.strokeStyle = COLORS.future;
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath();
          for (let i = idx; i < samples.length; i++) {
            const X = px(samples[i]);
            const Y = py(samples[i]);
            if (i === idx) ctx.moveTo(X, Y);
            else ctx.lineTo(X, Y);
          }
          ctx.stroke();
        }

        ctx.strokeStyle = COLORS.trail;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        for (let i = 0; i <= idx; i++) {
          const X = px(samples[i]);
          const Y = py(samples[i]);
          if (i === 0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        }
        ctx.stroke();
      }

      // --- Spacecraft and vectors ----------------------------------------
      const sx = px(s);
      const sy = py(s);

      if (st.showVectors) {
        const L = Math.min(W, H) * 0.11;
        const arrow = (vx: number, vy: number, vz: number, color: string, len: number) => {
          const cu = vx * u[0] + vy * u[1] + vz * u[2];
          const cw = vx * w[0] + vy * w[1] + vz * w[2];
          const m = Math.hypot(cu, cw);
          if (m < 1e-9) return;
          // Arrows are drawn at their PROJECTED length: a vector pointing out
          // of the displayed plane appears short, which is real information
          // rather than a rendering artefact. Inputs are unit vectors, so the
          // on-screen length is |component in plane| x len.
          const ex = sx + cu * len;
          const ey = sy - cw * len;
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = 1.8 * dpr;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          // Head
          const ang = Math.atan2(ey - sy, ex - sx);
          const hs = 5 * dpr;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - hs * Math.cos(ang - 0.4), ey - hs * Math.sin(ang - 0.4));
          ctx.lineTo(ex - hs * Math.cos(ang + 0.4), ey - hs * Math.sin(ang + 0.4));
          ctx.closePath();
          ctx.fill();
        };

        const sd = sunDirection(s.jd);
        arrow(sd[0], sd[1], sd[2], COLORS.sun, L);
        arrow(s.nx, s.ny, s.nz, COLORS.normal, L * 0.9);
        const vm = Math.hypot(s.vx, s.vy, s.vz) || 1;
        arrow(s.vx / vm, s.vy / vm, s.vz / vm, COLORS.velocity, L * 0.9);
        const am = Math.hypot(s.ax, s.ay, s.az);
        if (am > 1e-14) arrow(s.ax / am, s.ay / am, s.az / am, COLORS.accel, L * 0.75);

        // Sail plane, drawn as the line where the sail intersects this view.
        const nu = s.nx * u[0] + s.ny * u[1] + s.nz * u[2];
        const nw = s.nx * w[0] + s.ny * w[1] + s.nz * w[2];
        const nm = Math.hypot(nu, nw);
        if (nm > 1e-9) {
          // In-plane direction perpendicular to the projected normal.
          const tx = -nw / nm;
          const ty = -nu / nm;
          const half = L * 0.5;
          ctx.strokeStyle = COLORS.normal;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 3 * dpr;
          ctx.beginPath();
          ctx.moveTo(sx - tx * half, sy - ty * half);
          ctx.lineTo(sx + tx * half, sy + ty * half);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      ctx.beginPath();
      ctx.arc(sx, sy, 3.2 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.craft;
      ctx.fill();

      // --- Annotations ----------------------------------------------------
      ctx.fillStyle = COLORS.text;
      ctx.font = `${10 * dpr}px ui-monospace, monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(`grid: ${formatKm(step)}`, 10 * dpr, H - 10 * dpr);
      ctx.fillText(PROJECTION_LABELS[projection], 10 * dpr, 16 * dpr);
      // Left-aligned at the bottom, above the grid note, so they never collide
      // with the vector legend in the bottom-right corner.
      ctx.textAlign = 'left';
      ctx.fillText(`horizontal: ${uLabel}`, 10 * dpr, H - 38 * dpr);
      ctx.fillText(`vertical: ${wLabel}`, 10 * dpr, H - 24 * dpr);

      // Advance playback here too, so 2D mode animates identically to 3D.
      if (st.runState === 'playing') {
        acc += st.playbackSpeed;
        if (acc >= 1) {
          const stepN = Math.floor(acc);
          acc -= stepN;
          st.stepCursor(stepN);
        }
      } else {
        acc = 0;
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [projection, themeName]);

  return (
    <>
      <canvas ref={canvasRef} />
      <div className="viewport-toolbar" style={{ top: 40 }}>
        <div className="seg">
          <span className="seg-label">Plane</span>
          {(['orbit', 'xy', 'xz', 'yz'] as Projection[]).map((p) => (
            <button
              key={p}
              className={projection === p ? 'active' : ''}
              onClick={() => setProjection(p)}
              title={PROJECTION_LABELS[p]}
            >
              {p === 'orbit' ? 'Orbit' : p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/** Exported for any consumer that needs the same canvas colours. */
export { canvasColors };
