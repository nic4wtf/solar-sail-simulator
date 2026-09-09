/**
 * Three.js trajectory view.
 *
 * Imperative Three.js inside one React component, rather than a React
 * renderer for the scene graph: the trajectory is a single BufferGeometry
 * whose draw range advances every animation frame, and reconciling that
 * through React each frame would be pure overhead. React owns WHEN the scene
 * is rebuilt (new run, new camera target); the render loop owns the frames.
 *
 * SCALE: the scene works in units of 1000 km (Mm) so that a LEO orbit and the
 * lunar distance can share one depth buffer without z-fighting. Earth radius
 * is 6.378 units, the Moon orbit is 384 units.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { R_EARTH, R_MOON } from '../../core/constants.ts';
import { useStore } from '../../state/store.ts';
import { moonPosition } from '../../core/environment/moon.ts';
import { sunDirection } from '../../core/environment/sun.ts';

/** Scene units per metre: 1 unit = 1000 km. */
const S = 1e-6;

const COLORS = {
  sun: 0xffd479,
  normal: 0x7ee081,
  velocity: 0x6fc2ff,
  accel: 0xff7a7a,
  trail: 0x4da3ff,
  future: 0x35507a,
  earth: 0x2f6ba8,
  earthLine: 0x4f8fd0,
  moon: 0xa9a49a,
  moonOrbit: 0x4a4a52,
  craft: 0xffffff,
  sail: 0x9fe8a3,
};

/** Fixed on-screen length for the direction vectors, in scene units. */
function vectorScale(radiusUnits: number): number {
  // Long enough to read against the body, short enough not to leave the view.
  return Math.max(1.2, radiusUnits * 0.85);
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;

  earth: THREE.Group;
  moon: THREE.Group;
  moonOrbit: THREE.Line;
  earthMarker: THREE.Sprite;
  moonMarker: THREE.Sprite;

  trailGeom: THREE.BufferGeometry;
  trail: THREE.Line;
  futureGeom: THREE.BufferGeometry;
  future: THREE.Line;

  craft: THREE.Mesh;
  sailPlane: THREE.Mesh;
  vectors: {
    sun: THREE.ArrowHelper;
    normal: THREE.ArrowHelper;
    velocity: THREE.ArrowHelper;
    accel: THREE.ArrowHelper;
  };
  craftGroup: THREE.Group;

  dispose: () => void;
}

/** Build the Earth: shaded sphere, graticule, and a thin atmosphere shell. */
function buildEarth(): THREE.Group {
  const g = new THREE.Group();
  const r = R_EARTH * S;

  // No external texture assets are used anywhere in this application: a
  // procedural shaded sphere plus a graticule keeps the build fully
  // self-contained (important for static GitHub Pages hosting) and reads more
  // like an engineering display than a photographic globe would.
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(r, 64, 48),
    new THREE.MeshPhongMaterial({
      color: COLORS.earth,
      shininess: 12,
      specular: 0x1a2a3a,
    }),
  );
  g.add(sphere);

  // Graticule: parallels every 30 deg, meridians every 30 deg.
  const grid = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({
    color: COLORS.earthLine,
    transparent: true,
    opacity: 0.34,
  });
  const equatorMat = new THREE.LineBasicMaterial({
    color: 0x8fc4f5,
    transparent: true,
    opacity: 0.6,
  });

  for (let lat = -60; lat <= 60; lat += 30) {
    const phi = (lat * Math.PI) / 180;
    const rr = r * Math.cos(phi) * 1.001;
    const z = r * Math.sin(phi) * 1.001;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(rr * Math.cos(a), rr * Math.sin(a), z));
    }
    grid.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        lat === 0 ? equatorMat : mat,
      ),
    );
  }
  for (let lon = 0; lon < 180; lon += 30) {
    const a = (lon * Math.PI) / 180;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) {
      const t = (i / 96) * Math.PI * 2;
      const rr = r * 1.001;
      pts.push(
        new THREE.Vector3(rr * Math.cos(t) * Math.cos(a), rr * Math.cos(t) * Math.sin(a), rr * Math.sin(t)),
      );
    }
    grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
  g.add(grid);

  // Atmosphere: additive back-face shell for a limb glow.
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(r * 1.025, 48, 32),
    new THREE.MeshBasicMaterial({
      color: 0x4d9fe0,
      transparent: true,
      opacity: 0.09,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  g.add(atmo);

  return g;
}

function buildMoon(): THREE.Group {
  const g = new THREE.Group();
  const r = R_MOON * S;
  g.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(r, 40, 28),
      new THREE.MeshPhongMaterial({ color: COLORS.moon, shininess: 3 }),
    ),
  );
  return g;
}

/**
 * Screen-space marker for a body that is too small to see.
 *
 * At lunar scale the Earth subtends about 1.6% of the frame height and the
 * Moon about 0.4% - a few pixels each - so on a transfer trajectory both are
 * effectively invisible and the user cannot tell where anything is.
 *
 * The fix is a sprite carrying a ring and a label, scaled every frame to a
 * CONSTANT on-screen size and shown only while the body itself renders smaller
 * than the ring. The true-size sphere is never scaled, so the display stays
 * honest: the ring is visibly an annotation rather than the body.
 */
function makeBodyMarker(label: string, color: string): THREE.Sprite {
  const SIZE = 128;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  // Ring, drawn in the upper-middle so the label sits beneath it.
  const cx = SIZE / 2;
  const cy = SIZE * 0.38;
  const r = SIZE * 0.16;
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // Centre dot.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = '600 26px system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(label, cx, cy + r + 10);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      // Draw over the body sphere rather than z-fighting with it.
      depthTest: false,
    }),
  );
  sprite.renderOrder = 10;
  return sprite;
}

function makeArrow(color: number, len: number): THREE.ArrowHelper {
  const a = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 0),
    len,
    color,
    len * 0.22,
    len * 0.11,
  );
  return a;
}

export function Scene3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const refs = useRef<SceneRefs | null>(null);

  const result = useStore((s) => s.result);
  const cameraTarget = useStore((s) => s.cameraTarget);
  const showVectors = useStore((s) => s.showVectors);
  const showOrbitTrail = useStore((s) => s.showOrbitTrail);
  const showFullTrajectory = useStore((s) => s.showFullTrajectory);

  const samples = result?.samples;
  const centre = result?.config.centralBody ?? 'earth';

  // The trajectory as a flat Float32Array in scene units, rebuilt only when a
  // new run arrives.
  const positions = useMemo(() => {
    if (!samples || samples.length === 0) return new Float32Array(0);
    const arr = new Float32Array(samples.length * 3);
    for (let i = 0; i < samples.length; i++) {
      arr[i * 3] = samples[i].x * S;
      arr[i * 3 + 1] = samples[i].y * S;
      arr[i * 3 + 2] = samples[i].z * S;
    }
    return arr;
  }, [samples]);

  // --- One-time scene construction -----------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x05070c, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 20000);
    camera.up.set(0, 0, 1); // ECI z is the pole; keep it "up" on screen
    camera.position.set(30, -30, 18);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 0.05;
    controls.maxDistance = 6000;

    // Sunlight is repositioned every frame from the real Sun direction, so the
    // terminator on the Earth and Moon is physically correct.
    const sunLight = new THREE.DirectionalLight(0xfff4e0, 2.6);
    scene.add(sunLight);
    scene.add(new THREE.AmbientLight(0x2a3550, 0.55));

    // Starfield: a few thousand points on a large sphere. Purely for depth
    // perception when the camera is far out.
    const starGeom = new THREE.BufferGeometry();
    const starCount = 2400;
    const stars = new Float32Array(starCount * 3);
    // Deterministic pseudo-random so the star field is stable between runs.
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < starCount; i++) {
      const u = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const R = 9000;
      stars[i * 3] = R * s * Math.cos(a);
      stars[i * 3 + 1] = R * s * Math.sin(a);
      stars[i * 3 + 2] = R * u;
    }
    starGeom.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    scene.add(
      new THREE.Points(
        starGeom,
        // `sizeAttenuation: false` makes `size` a PIXEL size, so this must stay
        // small - a value of 12 renders each star as a 12 px square.
        new THREE.PointsMaterial({
          color: 0x8fa0c4,
          size: 1.6,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.7,
        }),
      ),
    );

    const earth = buildEarth();
    scene.add(earth);
    const moon = buildMoon();
    scene.add(moon);

    const earthMarker = makeBodyMarker('Earth', '#7fb6ee');
    const moonMarker = makeBodyMarker('Moon', '#d8d3c6');
    scene.add(earthMarker);
    scene.add(moonMarker);

    // Lunar orbit reference circle, filled in on each rebuild.
    const moonOrbit = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: COLORS.moonOrbit, transparent: true, opacity: 0.5 }),
    );
    scene.add(moonOrbit);

    // Trajectory: two lines sharing one position buffer. `trail` draws the
    // travelled part, `future` the remainder, using draw ranges rather than
    // separate buffers so nothing is copied per frame.
    const trailGeom = new THREE.BufferGeometry();
    const trail = new THREE.Line(
      trailGeom,
      new THREE.LineBasicMaterial({ color: COLORS.trail, linewidth: 2 }),
    );
    trail.frustumCulled = false;
    scene.add(trail);

    const futureGeom = new THREE.BufferGeometry();
    const future = new THREE.Line(
      futureGeom,
      new THREE.LineBasicMaterial({
        color: COLORS.future,
        transparent: true,
        opacity: 0.55,
      }),
    );
    future.frustumCulled = false;
    scene.add(future);

    // Spacecraft group: marker, sail plane and the four vectors, all moved
    // together each frame.
    const craftGroup = new THREE.Group();
    scene.add(craftGroup);

    const craft = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: COLORS.craft }),
    );
    craftGroup.add(craft);

    // The sail plane is drawn as a thin double-sided square whose normal is
    // the commanded sail normal - this is what makes "why is it accelerating"
    // legible at a glance.
    const sailPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: COLORS.sail,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    craftGroup.add(sailPlane);

    const vectors = {
      sun: makeArrow(COLORS.sun, 1),
      normal: makeArrow(COLORS.normal, 1),
      velocity: makeArrow(COLORS.velocity, 1),
      accel: makeArrow(COLORS.accel, 1),
    };
    for (const a of Object.values(vectors)) craftGroup.add(a);

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    let raf = 0;
    const tmp = {
      v1: new THREE.Vector3(),
      v2: new THREE.Vector3(),
      v3: new THREE.Vector3(),
      q: new THREE.Quaternion(),
    };

    /**
     * Render loop.
     *
     * Reads the store imperatively via `getState()` instead of through React
     * props: this runs at 60 Hz and must not trigger a re-render. The playback
     * cursor is advanced here too, so a single rAF drives both the animation
     * and the timeline.
     */
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const st = useStore.getState();
      const res = st.result;

      controls.update();

      if (res && res.samples.length > 0) {
        const idx = Math.min(st.cursor, res.samples.length - 1);
        const s = res.samples[idx];
        const isMoonCentred = res.config.centralBody === 'moon';

        // --- Body positions -------------------------------------------
        const moonRel = moonPosition(s.jd, res.config.moonModel);
        const sunDir = sunDirection(s.jd);

        if (isMoonCentred) {
          moon.position.set(0, 0, 0);
          earth.position.set(-moonRel[0] * S, -moonRel[1] * S, -moonRel[2] * S);
        } else {
          earth.position.set(0, 0, 0);
          moon.position.set(moonRel[0] * S, moonRel[1] * S, moonRel[2] * S);
        }

        // Sunlight from the true Sun direction (as seen from the Earth).
        sunLight.position.set(sunDir[0] * 5000, sunDir[1] * 5000, sunDir[2] * 5000);
        sunLight.target.position.set(0, 0, 0);

        // --- Body markers ----------------------------------------------
        // A sprite of constant on-screen size, shown only while the body
        // renders smaller than the marker itself.
        const viewH = Math.max(1, mount.clientHeight);
        const halfFovTan = Math.tan((camera.fov * Math.PI) / 360);
        const MARKER_PX = 54;

        const placeMarker = (
          marker: THREE.Sprite,
          bodyPos: THREE.Vector3,
          bodyRadiusUnits: number,
          visible: boolean,
        ) => {
          if (!visible) {
            marker.visible = false;
            return;
          }
          const dist = camera.position.distanceTo(bodyPos);
          // World size subtended by MARKER_PX pixels at this distance.
          const worldPerPx = (2 * halfFovTan * dist) / viewH;
          const markerWorld = MARKER_PX * worldPerPx;
          // Apparent body diameter in pixels.
          const bodyPx = (2 * bodyRadiusUnits) / worldPerPx;
          marker.visible = bodyPx < MARKER_PX * 0.55;
          marker.position.copy(bodyPos);
          marker.scale.setScalar(markerWorld);
        };

        placeMarker(earthMarker, earth.position, R_EARTH * S, true);
        placeMarker(moonMarker, moon.position, R_MOON * S, moon.visible);

        // --- Spacecraft ------------------------------------------------
        const px = s.x * S;
        const py = s.y * S;
        const pz = s.z * S;
        craftGroup.position.set(px, py, pz);

        // Sizes are driven by the camera distance so the marker, the sail and
        // the arrows stay legible at every zoom level, from a 100 km lunar
        // orbit to the whole Earth-Moon system.
        const camDist = camera.position.distanceTo(craftGroup.position);
        const markerR = Math.max(0.02, camDist * 0.008);
        craft.scale.setScalar(markerR);

        const vLen = vectorScale(camDist * 0.12);
        const sailSize = vLen * 0.75;
        sailPlane.scale.set(sailSize, sailSize, 1);

        // Orient the sail plane so its face normal is the sail normal.
        tmp.v1.set(s.nx, s.ny, s.nz).normalize();
        tmp.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmp.v1);
        sailPlane.setRotationFromQuaternion(tmp.q);

        // --- Vectors ---------------------------------------------------
        const showVec = st.showVectors;
        for (const a of Object.values(vectors)) a.visible = showVec;

        if (showVec) {
          // Sun direction: from the spacecraft toward the Sun. At these
          // distances the geocentric and spacecraft-centric Sun directions
          // differ by well under a milliradian, so the geocentric one is used.
          tmp.v2.set(sunDir[0], sunDir[1], sunDir[2]).normalize();
          vectors.sun.setDirection(tmp.v2);
          vectors.sun.setLength(vLen, vLen * 0.2, vLen * 0.1);

          // Sail normal.
          vectors.normal.setDirection(tmp.v1);
          vectors.normal.setLength(vLen * 0.9, vLen * 0.2, vLen * 0.1);

          // Velocity.
          tmp.v3.set(s.vx, s.vy, s.vz).normalize();
          vectors.velocity.setDirection(tmp.v3);
          vectors.velocity.setLength(vLen * 0.9, vLen * 0.2, vLen * 0.1);

          // Sail acceleration. Hidden entirely when the sail produces no
          // force (eclipse or edge-on) rather than drawn as a zero-length
          // stub, because an arrow that is present but tiny reads as "small
          // force" when the truth is "no force at all".
          const aMag = Math.hypot(s.ax, s.ay, s.az);
          if (aMag > 1e-14) {
            tmp.v2.set(s.ax / aMag, s.ay / aMag, s.az / aMag);
            vectors.accel.setDirection(tmp.v2);
            vectors.accel.setLength(vLen * 0.75, vLen * 0.2, vLen * 0.1);
            vectors.accel.visible = true;
          } else {
            vectors.accel.visible = false;
          }
        }

        // --- Trajectory draw ranges ------------------------------------
        const count = res.samples.length;
        if (st.showOrbitTrail) {
          trail.visible = idx >= 1;
          trailGeom.setDrawRange(0, Math.max(2, idx + 1));
          // Draw the not-yet-travelled remainder, starting at the cursor so
          // there is no visible gap. Needs at least two vertices left, or the
          // draw range would run past the end of the buffer.
          const remaining = count - idx;
          if (st.showFullTrajectory && remaining >= 2) {
            future.visible = true;
            futureGeom.setDrawRange(idx, remaining);
          } else {
            future.visible = false;
          }
        } else {
          trail.visible = false;
          future.visible = false;
        }

        // --- Camera follow ---------------------------------------------
        // Only the orbit target moves; the user's rotation and zoom are
        // preserved, so following a body never fights the mouse.
        if (st.cameraTarget === 'spacecraft') {
          controls.target.set(px, py, pz);
        } else if (st.cameraTarget === 'moon') {
          controls.target.copy(moon.position);
        } else if (st.cameraTarget === 'earth') {
          controls.target.copy(earth.position);
        }

        // --- Advance playback ------------------------------------------
        if (st.runState === 'playing') {
          // Samples per frame, from the speed multiplier. Sub-1 speeds
          // accumulate fractionally so slow motion is smooth.
          acc += st.playbackSpeed;
          if (acc >= 1) {
            const step = Math.floor(acc);
            acc -= step;
            st.stepCursor(step);
          }
        } else {
          acc = 0;
        }
      }

      renderer.render(scene, camera);
    };

    let acc = 0;
    raf = requestAnimationFrame(tick);

    refs.current = {
      renderer,
      scene,
      camera,
      controls,
      earth,
      moon,
      moonOrbit,
      earthMarker,
      moonMarker,
      trailGeom,
      trail,
      futureGeom,
      future,
      craft,
      sailPlane,
      vectors,
      craftGroup,
      dispose: () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        renderer.dispose();
        scene.traverse((o) => {
          const any = o as unknown as {
            geometry?: THREE.BufferGeometry;
            material?: THREE.Material | THREE.Material[];
          };
          any.geometry?.dispose();
          if (Array.isArray(any.material)) any.material.forEach((m) => m.dispose());
          else any.material?.dispose();
        });
        if (renderer.domElement.parentNode === mount) {
          mount.removeChild(renderer.domElement);
        }
      },
    };

    return () => {
      refs.current?.dispose();
      refs.current = null;
    };
  }, []);

  // --- Upload a new trajectory ---------------------------------------
  useEffect(() => {
    const r = refs.current;
    if (!r) return;

    const attr = new THREE.BufferAttribute(positions, 3);
    r.trailGeom.setAttribute('position', attr);
    r.futureGeom.setAttribute('position', attr);
    r.trailGeom.setDrawRange(0, 0);
    r.futureGeom.setDrawRange(0, 0);
    r.trailGeom.computeBoundingSphere();

    // Lunar orbit reference path, sampled from the actual ephemeris over one
    // sidereal month starting at the run epoch - so it shows the plane and
    // eccentricity the simulation is really using, not an idealised circle.
    //
    // Only drawn for Earth-centred runs: in a Moon-centred frame the Moon sits
    // at the origin and its own orbit is not a meaningful thing to draw.
    if (samples && samples.length > 0) {
      const model = result?.config.moonModel ?? 'series';
      const usesMoon =
        centre === 'earth' &&
        ((result?.config.forces.moonGravity ?? false) ||
          (samples[samples.length - 1]?.radius ?? 0) > 1e8);

      if (usesMoon) {
        const jd0 = samples[0].jd;
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 180; i++) {
          const p = moonPosition(jd0 + (i / 180) * 27.321661, model);
          pts.push(new THREE.Vector3(p[0] * S, p[1] * S, p[2] * S));
        }
        r.moonOrbit.geometry.dispose();
        r.moonOrbit.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      }
      r.moonOrbit.visible = usesMoon;
      // The Moon body itself is still worth showing in a Moon-centred run.
      r.moon.visible = usesMoon || centre === 'moon';
    }

    // Frame the trajectory: fit the camera distance to the trajectory extent
    // so a new run is immediately visible whatever its scale.
    if (positions.length >= 3) {
      let maxR = 0;
      for (let i = 0; i < positions.length; i += 3) {
        const d = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
        if (d > maxR) maxR = d;
      }
      const bodyR = (centre === 'earth' ? R_EARTH : R_MOON) * S;
      // Frame on the trajectory extent, not on the body: a 500 km LEO ring sits
      // only 8% outside the Earth's limb, so padding by the body radius would
      // push the camera far enough out to hide the orbit entirely.
      // At a 45 deg vertical field of view the visible half-height at the
      // origin is distance * tan(22.5 deg) = 0.414 * distance, so a factor of
      // 3.0 leaves the trajectory occupying ~80% of the frame height.
      const fit = Math.max(maxR, bodyR * 1.05) * 3.0;
      const dir = r.camera.position.clone().normalize();
      if (dir.lengthSq() === 0) dir.set(0.6, -0.6, 0.4).normalize();
      r.camera.position.copy(dir.multiplyScalar(fit));
      r.camera.near = Math.max(0.001, fit * 1e-4);
      r.camera.far = Math.max(20000, fit * 40);
      r.camera.updateProjectionMatrix();
      r.controls.update();
    }
  }, [positions, samples, centre, result]);

  // Camera target changes are applied by the render loop; nothing to do here
  // beyond keeping the effect dependencies honest for lint.
  void cameraTarget;
  void showVectors;
  void showOrbitTrail;
  void showFullTrajectory;

  return <div ref={mountRef} className="viewport-canvas" style={{ width: '100%', height: '100%' }} />;
}
