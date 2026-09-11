/**
 * Three.js trajectory view.
 *
 * Imperative Three.js inside one React component, rather than a React
 * renderer for the scene graph: the trajectory is a single BufferGeometry
 * whose draw range advances every animation frame, and reconciling that
 * through React each frame would be pure overhead. React owns WHEN the scene
 * is rebuilt (new run, new camera target); the render loop owns the frames.
 *
 * SCALE: the scene works in units of 1000 km (Mm) about a planet, so that a
 * LEO orbit and the lunar distance can share one depth buffer without
 * z-fighting - Earth radius is 6.378 units, the Moon orbit is 384 units.
 *
 * Heliocentrically that breaks down: 1 AU would be 149,600 units and Neptune
 * 4.5 million, which no single depth buffer survives alongside a 6-unit
 * Earth. So the scale is switched with the integration centre, to units of
 * 1e6 km (Gm) about the Sun: 1 AU becomes 149.6 units and the solar radius
 * 0.696, which is the same dynamic range the Earth-Moon view already handles.
 *
 * The bodies are still BUILT at the planetary scale and rescaled by a group
 * transform, so there is one set of geometry rather than two.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AU, R_EARTH, R_MOON, R_SUN } from '../../core/constants.ts';
import { interpolatedState, selectPalette, useStore } from '../../state/store.ts';
import { type ThemePalette, PALETTES } from '../theme.ts';
import { moonPosition } from '../../core/environment/moon.ts';
import { sunDirection } from '../../core/environment/sun.ts';
import {
  type CentralBody,
  CENTRAL_RADIUS,
} from '../../core/environment/environment.ts';
import {
  type PlanetId,
  PLANET_FACTS,
  earthHeliocentric,
  planetPeriod,
  planetState,
} from '../../core/environment/planets.ts';

/**
 * Reference scene scale: 1 unit = 1000 km.
 *
 * All geometry is built at this scale. The active scale below is applied as a
 * group transform on top of it.
 */
const S = 1e-6;

/** Scene units per metre, by integration centre. */
const SCALE_BY_CENTRE: Record<CentralBody, number> = {
  earth: 1e-6,
  moon: 1e-6,
  // 1 unit = 1e6 km. 1 AU = 149.6 units, solar radius 0.696.
  sun: 1e-9,
};

/**
 * Planets drawn in the heliocentric view.
 *
 * The inner system plus Jupiter: far enough to give the outer scenarios
 * something to be measured against, near enough that the view is not
 * dominated by empty space. Saturn outward would put 1 AU inside 3% of the
 * frame.
 */
const SHOWN_PLANETS: PlanetId[] = ['mercury', 'venus', 'mars', 'jupiter'];

/**
 * Materials and objects whose colour depends on the theme.
 *
 * Collected at build time so a theme change can be applied by mutating them in
 * place. Rebuilding the scene instead would be simpler to write but would
 * discard the user's camera position and zoom on every toggle, which is a
 * poor trade for something as incidental as a colour change.
 */
/** One drawn planet: body, orbit ring and screen-space marker. */
interface PlanetVisual {
  id: PlanetId;
  group: THREE.Group;
  orbit: THREE.Line;
  marker: THREE.Sprite;
  surface: THREE.MeshPhongMaterial;
}

interface ThemeTargets {
  earthSurface: THREE.MeshPhongMaterial;
  graticule: THREE.LineBasicMaterial;
  equator: THREE.LineBasicMaterial;
  atmosphere: THREE.MeshBasicMaterial;
  moonSurface: THREE.MeshPhongMaterial;
  moonOrbit: THREE.LineBasicMaterial;
  sunSurface: THREE.MeshBasicMaterial;
  sunGlow: THREE.MeshBasicMaterial;
  planetSurfaces: THREE.MeshPhongMaterial[];
  planetOrbits: THREE.LineBasicMaterial[];
  stars: THREE.PointsMaterial;
  trail: THREE.LineBasicMaterial;
  future: THREE.LineBasicMaterial;
  craft: THREE.MeshBasicMaterial;
  sailPlane: THREE.MeshBasicMaterial;
  ambient: THREE.AmbientLight;
  sunLight: THREE.DirectionalLight;
}

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
  sun: THREE.Group;
  earthOrbit: THREE.Line;
  planets: PlanetVisual[];

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
function buildEarth(p: ThemePalette): {
  group: THREE.Group;
  surface: THREE.MeshPhongMaterial;
  graticule: THREE.LineBasicMaterial;
  equator: THREE.LineBasicMaterial;
  atmosphere: THREE.MeshBasicMaterial;
} {
  const g = new THREE.Group();
  const r = R_EARTH * S;

  // No external texture assets are used anywhere in this application: a
  // procedural shaded sphere plus a graticule keeps the build fully
  // self-contained (important for static GitHub Pages hosting) and reads more
  // like an engineering display than a photographic globe would.
  const surface = new THREE.MeshPhongMaterial({
    color: p.earthSurface,
    shininess: 12,
    specular: 0x1a2a3a,
  });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 64, 48), surface));

  // Graticule: parallels every 30 deg, meridians every 30 deg.
  const grid = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({
    color: p.earthGraticule,
    transparent: true,
    opacity: 0.34,
  });
  const equatorMat = new THREE.LineBasicMaterial({
    color: p.earthEquator,
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

  // Atmosphere: a back-face shell for a limb glow. Additive blending only
  // works against a dark sky - on a light background it washes the limb out
  // to white - so light mode uses normal blending instead.
  const atmosphere = new THREE.MeshBasicMaterial({
    color: p.earthAtmosphere,
    transparent: true,
    opacity: p.earthAtmosphereOpacity,
    side: THREE.BackSide,
    blending: p.name === 'dark' ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
  });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.025, 48, 32), atmosphere));

  return { group: g, surface, graticule: mat, equator: equatorMat, atmosphere };
}

function buildMoon(p: ThemePalette): {
  group: THREE.Group;
  surface: THREE.MeshPhongMaterial;
} {
  const g = new THREE.Group();
  const r = R_MOON * S;
  const surface = new THREE.MeshPhongMaterial({ color: p.moonSurface, shininess: 3 });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), surface));
  return { group: g, surface };
}

/**
 * The Sun: an unlit disc plus a corona shell.
 *
 * `MeshBasicMaterial` rather than Phong because the Sun is the light source -
 * shading it would draw a terminator on the one object in the scene that
 * cannot have one.
 */
function buildSun(p: ThemePalette): {
  group: THREE.Group;
  surface: THREE.MeshBasicMaterial;
  glow: THREE.MeshBasicMaterial;
} {
  const g = new THREE.Group();
  const r = R_SUN * S;
  const surface = new THREE.MeshBasicMaterial({ color: p.sunSurface });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), surface));

  const glow = new THREE.MeshBasicMaterial({
    color: p.sunGlow,
    transparent: true,
    opacity: p.sunGlowOpacity,
    side: THREE.BackSide,
    depthWrite: false,
  });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r * 2.2, 32, 24), glow));
  return { group: g, surface, glow };
}

/** One perturbing planet: sphere, orbit ring and marker. */
function buildPlanet(id: PlanetId, p: ThemePalette): PlanetVisual {
  const facts = PLANET_FACTS[id];
  const g = new THREE.Group();
  const surface = new THREE.MeshPhongMaterial({ color: p.planetSurface, shininess: 4 });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(facts.radius * S, 24, 16), surface));

  const orbitMat = new THREE.LineBasicMaterial({
    color: p.planetOrbitLine,
    transparent: true,
    opacity: 0.55,
  });
  const orbit = new THREE.Line(new THREE.BufferGeometry(), orbitMat);
  orbit.frustumCulled = false;

  return { id, group: g, orbit, marker: makeBodyMarker(facts.name, p.planetMarker), surface };
}

/**
 * Sample one planet's orbit into a closed ring, from the ephemeris itself
 * rather than from an idealised ellipse - so the drawn ring is the orbit the
 * force model is actually using, inclination and all.
 */
function planetOrbitPoints(id: PlanetId, jd0: number, scale: number): THREE.Vector3[] {
  const periodDays = planetPeriod(id) / 86400;
  const pts: THREE.Vector3[] = [];
  const N = 160;
  for (let i = 0; i <= N; i++) {
    const q = planetState(id, jd0 + (i / N) * periodDays).position;
    pts.push(new THREE.Vector3(q[0] * scale, q[1] * scale, q[2] * scale));
  }
  return pts;
}

/** The Earth's heliocentric orbit, from the solar series the model uses. */
function earthOrbitPoints(jd0: number, scale: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const N = 160;
  for (let i = 0; i <= N; i++) {
    const q = earthHeliocentric(jd0 + (i / N) * 365.256).position;
    pts.push(new THREE.Vector3(q[0] * scale, q[1] * scale, q[2] * scale));
  }
  return pts;
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
  /**
   * Set by the mount effect; called by the retheme effect.
   *
   * Held in a ref rather than in `SceneRefs` so the retheme effect does not
   * need the scene to have finished building before it can be declared.
   */
  const applyPaletteRef = useRef<((p: ThemePalette) => void) | null>(null);
  const palette = useStore(selectPalette);

  const result = useStore((s) => s.result);
  const cameraTarget = useStore((s) => s.cameraTarget);
  const showVectors = useStore((s) => s.showVectors);
  const showOrbitTrail = useStore((s) => s.showOrbitTrail);
  const showFullTrajectory = useStore((s) => s.showFullTrajectory);

  const samples = result?.samples;
  const centre: CentralBody = result?.config.centralBody ?? 'earth';
  const activeScale = SCALE_BY_CENTRE[centre];

  // The trajectory as a flat Float32Array in scene units, rebuilt only when a
  // new run arrives.
  const positions = useMemo(() => {
    if (!samples || samples.length === 0) return new Float32Array(0);
    const sc = SCALE_BY_CENTRE[centre];
    const arr = new Float32Array(samples.length * 3);
    for (let i = 0; i < samples.length; i++) {
      arr[i * 3] = samples[i].x * sc;
      arr[i * 3 + 1] = samples[i].y * sc;
      arr[i * 3 + 2] = samples[i].z * sc;
    }
    return arr;
  }, [samples, centre]);

  // --- One-time scene construction -----------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // The palette is read once here for construction. Later changes are
    // applied by the retheme effect below, which mutates the collected
    // materials rather than rebuilding the scene.
    const p0 = PALETTES[useStore.getState().theme];

    // Central body radius in scene units, used to size the chase-camera
    // standoff. Read per frame from the result so it follows a scenario change.
    let env0BodyRadius = R_EARTH * S;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(p0.sceneBackground, 1);
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
    const sunLight = new THREE.DirectionalLight(p0.sunLight, p0.sunLightIntensity);
    scene.add(sunLight);
    const ambient = new THREE.AmbientLight(p0.ambientLight, p0.ambientIntensity);
    scene.add(ambient);

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
    // `sizeAttenuation: false` makes `size` a PIXEL size, so this must stay
    // small - a value of 12 renders each star as a 12 px square.
    const starMat = new THREE.PointsMaterial({
      color: p0.starColor,
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: p0.starOpacity,
    });
    const starPoints = new THREE.Points(starGeom, starMat);
    // Pale dots on a pale sky read as rendering dirt, so light mode hides
    // the starfield entirely rather than recolouring it.
    starPoints.visible = p0.starOpacity > 0;
    scene.add(starPoints);

    const earthBuilt = buildEarth(p0);
    const earth = earthBuilt.group;
    scene.add(earth);
    const moonBuilt = buildMoon(p0);
    const moon = moonBuilt.group;
    scene.add(moon);

    const sunBuilt = buildSun(p0);
    const sun = sunBuilt.group;
    sun.visible = false;
    scene.add(sun);

    // A point light at the origin lights the planets correctly in the
    // heliocentric view, where the light source is literally at the centre of
    // the scene. The directional light used about a planet cannot do that -
    // it has no position, only a direction, so every planet would be lit from
    // the same side regardless of where it is in its orbit.
    const sunPointLight = new THREE.PointLight(p0.sunLight, 3, 0, 0);
    sunPointLight.visible = false;
    scene.add(sunPointLight);

    const planetVisuals = SHOWN_PLANETS.map((id) => {
      const pv = buildPlanet(id, p0);
      pv.group.visible = false;
      pv.orbit.visible = false;
      pv.marker.visible = false;
      scene.add(pv.group);
      scene.add(pv.orbit);
      scene.add(pv.marker);
      return pv;
    });

    const earthOrbitMat = new THREE.LineBasicMaterial({
      color: p0.planetOrbitLine,
      transparent: true,
      opacity: 0.7,
    });
    const earthOrbit = new THREE.Line(new THREE.BufferGeometry(), earthOrbitMat);
    earthOrbit.frustumCulled = false;
    earthOrbit.visible = false;
    scene.add(earthOrbit);

    let sunMarker = makeBodyMarker('Sun', p0.sunMarker);
    sunMarker.visible = false;
    scene.add(sunMarker);

    // Marker sprites bake their colour into a canvas texture, so a theme
    // change replaces them rather than recolouring them.
    let earthMarker = makeBodyMarker('Earth', p0.earthMarker);
    let moonMarker = makeBodyMarker('Moon', p0.moonMarker);
    scene.add(earthMarker);
    scene.add(moonMarker);

    // Lunar orbit reference circle, filled in on each rebuild.
    const moonOrbitMat = new THREE.LineBasicMaterial({
      color: p0.moonOrbitLine,
      transparent: true,
      opacity: 0.5,
    });
    const moonOrbit = new THREE.Line(new THREE.BufferGeometry(), moonOrbitMat);
    scene.add(moonOrbit);

    // Trajectory: two lines sharing one position buffer. `trail` draws the
    // travelled part, `future` the remainder, using draw ranges rather than
    // separate buffers so nothing is copied per frame.
    const trailGeom = new THREE.BufferGeometry();
    const trailMat = new THREE.LineBasicMaterial({ color: p0.trailColor, linewidth: 2 });
    const trail = new THREE.Line(trailGeom, trailMat);
    trail.frustumCulled = false;
    scene.add(trail);

    const futureGeom = new THREE.BufferGeometry();
    const futureMat = new THREE.LineBasicMaterial({
      color: p0.futureColor,
      transparent: true,
      opacity: p0.futureOpacity,
    });
    const future = new THREE.Line(futureGeom, futureMat);
    future.frustumCulled = false;
    scene.add(future);

    // Spacecraft group: marker, sail plane and the four vectors, all moved
    // together each frame.
    const craftGroup = new THREE.Group();
    scene.add(craftGroup);

    const craftMat = new THREE.MeshBasicMaterial({ color: p0.craftColor });
    const craft = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), craftMat);
    craftGroup.add(craft);

    // The sail plane is drawn as a thin double-sided square whose normal is
    // the commanded sail normal - this is what makes "why is it accelerating"
    // legible at a glance.
    const sailPlaneMat = new THREE.MeshBasicMaterial({
      color: p0.sailPlaneColor,
      transparent: true,
      opacity: p0.sailPlaneOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const sailPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sailPlaneMat);
    craftGroup.add(sailPlane);

    const vectors = {
      sun: makeArrow(p0.vecSun, 1),
      normal: makeArrow(p0.vecNormal, 1),
      velocity: makeArrow(p0.vecVelocity, 1),
      accel: makeArrow(p0.vecAccel, 1),
    };
    for (const a of Object.values(vectors)) craftGroup.add(a);

    const themeTargets: ThemeTargets = {
      earthSurface: earthBuilt.surface,
      graticule: earthBuilt.graticule,
      equator: earthBuilt.equator,
      atmosphere: earthBuilt.atmosphere,
      moonSurface: moonBuilt.surface,
      moonOrbit: moonOrbitMat,
      sunSurface: sunBuilt.surface,
      sunGlow: sunBuilt.glow,
      planetSurfaces: planetVisuals.map((v) => v.surface),
      planetOrbits: [
        ...planetVisuals.map((v) => v.orbit.material as THREE.LineBasicMaterial),
        earthOrbitMat,
      ],
      stars: starMat,
      trail: trailMat,
      future: futureMat,
      craft: craftMat,
      sailPlane: sailPlaneMat,
      ambient,
      sunLight,
    };

    /** Apply a palette to the live scene, without rebuilding it. */
    applyPaletteRef.current = (p: ThemePalette) => {
      renderer.setClearColor(p.sceneBackground, 1);
      themeTargets.earthSurface.color.setHex(p.earthSurface);
      themeTargets.graticule.color.setHex(p.earthGraticule);
      themeTargets.equator.color.setHex(p.earthEquator);
      themeTargets.atmosphere.color.setHex(p.earthAtmosphere);
      themeTargets.atmosphere.opacity = p.earthAtmosphereOpacity;
      themeTargets.atmosphere.blending =
        p.name === 'dark' ? THREE.AdditiveBlending : THREE.NormalBlending;
      themeTargets.moonSurface.color.setHex(p.moonSurface);
      themeTargets.moonOrbit.color.setHex(p.moonOrbitLine);
      themeTargets.sunSurface.color.setHex(p.sunSurface);
      themeTargets.sunGlow.color.setHex(p.sunGlow);
      themeTargets.sunGlow.opacity = p.sunGlowOpacity;
      for (const m of themeTargets.planetSurfaces) m.color.setHex(p.planetSurface);
      for (const m of themeTargets.planetOrbits) m.color.setHex(p.planetOrbitLine);
      sunPointLight.color.setHex(p.sunLight);
      themeTargets.stars.color.setHex(p.starColor);
      themeTargets.stars.opacity = p.starOpacity;
      starPoints.visible = p.starOpacity > 0;
      themeTargets.trail.color.setHex(p.trailColor);
      themeTargets.future.color.setHex(p.futureColor);
      themeTargets.future.opacity = p.futureOpacity;
      themeTargets.craft.color.setHex(p.craftColor);
      themeTargets.sailPlane.color.setHex(p.sailPlaneColor);
      themeTargets.sailPlane.opacity = p.sailPlaneOpacity;
      themeTargets.ambient.color.setHex(p.ambientLight);
      themeTargets.ambient.intensity = p.ambientIntensity;
      themeTargets.sunLight.color.setHex(p.sunLight);
      themeTargets.sunLight.intensity = p.sunLightIntensity;

      vectors.sun.setColor(p.vecSun);
      vectors.normal.setColor(p.vecNormal);
      vectors.velocity.setColor(p.vecVelocity);
      vectors.accel.setColor(p.vecAccel);

      // Marker labels are baked into canvas textures, so the sprites have to
      // be replaced rather than recoloured. The old texture and material are
      // disposed to avoid leaking GPU memory on repeated toggles.
      const swap = (old: THREE.Sprite, next: THREE.Sprite) => {
        next.visible = old.visible;
        next.position.copy(old.position);
        next.scale.copy(old.scale);
        scene.remove(old);
        old.material.map?.dispose();
        old.material.dispose();
        scene.add(next);
      };
      const nextEarth = makeBodyMarker('Earth', p.earthMarker);
      const nextMoon = makeBodyMarker('Moon', p.moonMarker);
      swap(earthMarker, nextEarth);
      swap(moonMarker, nextMoon);
      earthMarker = nextEarth;
      moonMarker = nextMoon;

      const nextSun = makeBodyMarker('Sun', p.sunMarker);
      swap(sunMarker, nextSun);
      sunMarker = nextSun;

      for (const pv of planetVisuals) {
        const next = makeBodyMarker(PLANET_FACTS[pv.id].name, p.planetMarker);
        swap(pv.marker, next);
        pv.marker = next;
      }
    };

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
    // Real-time clock for playback. The rate is expressed in simulation
    // seconds per real second, so the loop must measure elapsed wall time
    // rather than counting frames - otherwise the speed would vary with the
    // display refresh rate.
    let lastFrameMs = performance.now();
    const tmp = {
      v1: new THREE.Vector3(),
      v2: new THREE.Vector3(),
      v3: new THREE.Vector3(),
      follow: new THREE.Vector3(),
      delta: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      R: new THREE.Vector3(),
      Sax: new THREE.Vector3(),
      W: new THREE.Vector3(),
      q: new THREE.Quaternion(),
    };

    /**
     * Previous frame's orbital basis for the chase camera, and whether it is
     * valid yet. See the camera-follow block for why this is needed.
     */
    const chase = {
      valid: false,
      R: new THREE.Vector3(),
      S: new THREE.Vector3(),
      W: new THREE.Vector3(),
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

      // Advance playback from measured wall time.
      const nowMs = performance.now();
      const frameDt = (nowMs - lastFrameMs) / 1000;
      lastFrameMs = nowMs;
      if (st.runState === 'playing') st.advancePlayback(frameDt);

      if (res && res.samples.length > 0) {
        const idx = Math.min(st.cursor, res.samples.length - 1);
        const s = res.samples[idx];
        // Interpolated position and vectors, so slow playback glides rather
        // than stepping between samples.
        const view = interpolatedState(st) ?? s;
        const frameCentre: CentralBody = res.config.centralBody;
        const isMoonCentred = frameCentre === 'moon';
        const isSunCentred = frameCentre === 'sun';
        const SC = SCALE_BY_CENTRE[frameCentre];
        // Geometry is built at the reference scale S, so a group transform of
        // SC / S puts every body at the right size for the active frame.
        const bodyScale = SC / S;
        env0BodyRadius = CENTRAL_RADIUS[frameCentre] * SC;

        // --- Body positions -------------------------------------------
        const moonRel = moonPosition(s.jd, res.config.moonModel);
        const sunDir = sunDirection(s.jd);

        earth.scale.setScalar(bodyScale);
        moon.scale.setScalar(bodyScale);
        sun.scale.setScalar(bodyScale);

        if (isSunCentred) {
          const earthHelio = earthHeliocentric(s.jd).position;
          sun.position.set(0, 0, 0);
          earth.position.set(earthHelio[0] * SC, earthHelio[1] * SC, earthHelio[2] * SC);
          // At this scale the Moon is a third of a pixel from the Earth.
          moon.position.copy(earth.position);
        } else if (isMoonCentred) {
          moon.position.set(0, 0, 0);
          earth.position.set(-moonRel[0] * SC, -moonRel[1] * SC, -moonRel[2] * SC);
        } else {
          earth.position.set(0, 0, 0);
          moon.position.set(moonRel[0] * SC, moonRel[1] * SC, moonRel[2] * SC);
        }

        sun.visible = isSunCentred;
        sunPointLight.visible = isSunCentred;
        // The directional light would double-light the planets and put a
        // terminator on the Sun's own glow shell, so the two are exclusive.
        sunLight.visible = !isSunCentred;

        if (isSunCentred) {
          for (const pv of planetVisuals) {
            const q = planetState(pv.id, s.jd).position;
            pv.group.position.set(q[0] * SC, q[1] * SC, q[2] * SC);
            pv.group.scale.setScalar(bodyScale);
            pv.group.visible = true;
            pv.orbit.visible = true;
          }
        } else {
          for (const pv of planetVisuals) {
            pv.group.visible = false;
            pv.orbit.visible = false;
            pv.marker.visible = false;
          }
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

        placeMarker(earthMarker, earth.position, R_EARTH * SC, true);
        placeMarker(moonMarker, moon.position, R_MOON * SC, moon.visible && !isSunCentred);
        placeMarker(sunMarker, sun.position, R_SUN * SC, isSunCentred);
        if (isSunCentred) {
          for (const pv of planetVisuals) {
            placeMarker(pv.marker, pv.group.position, PLANET_FACTS[pv.id].radius * SC, true);
          }
        }

        // --- Spacecraft ------------------------------------------------
        const px = view.x * SC;
        const py = view.y * SC;
        const pz = view.z * SC;
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
        tmp.v1.set(view.nx, view.ny, view.nz).normalize();
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
          const aMag = Math.hypot(view.ax, view.ay, view.az);
          if (aMag > 1e-14) {
            tmp.v2.set(view.ax / aMag, view.ay / aMag, view.az / aMag);
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
        //
        // Moving only `controls.target` (the look-at point) makes the camera
        // PIVOT IN PLACE: it swings round to keep the body in frame while
        // staying put itself. A followed spacecraft then slides past and the
        // viewing distance swings by the whole orbit diameter. That was the
        // original bug.
        //
        // For the Earth and the Moon, translating the camera by the same
        // delta as the target is the right fix - it preserves the offset the
        // user dragged and scrolled to while the rig travels with the body.
        //
        // For the SPACECRAFT that is not enough, because a fixed offset in
        // INERTIAL space can put the camera inside the planet. In a 500 km
        // orbit the craft sits only 0.5 scene units above the surface, so any
        // offset longer than that which happens to point Earthward buries the
        // camera in the Earth and the craft is occluded for much of the orbit.
        //
        // So the spacecraft is followed in its own ORBITAL frame: the offset
        // is held fixed in RSW (radial / along-track / orbit-normal) rather
        // than in inertial axes, and therefore revolves with the craft. The
        // camera keeps its relative viewpoint - "above and behind" stays above
        // and behind - and can never swing into the planet. This is also what
        // the request asked for: the camera orbits alongside the satellite.
        if (st.cameraTarget === 'spacecraft') {
          tmp.follow.set(px, py, pz);

          // Current orbital basis at the craft.
          tmp.R.copy(tmp.follow).normalize();
          tmp.W.set(
            s.y * s.vz - s.z * s.vy,
            s.z * s.vx - s.x * s.vz,
            s.x * s.vy - s.y * s.vx,
          ).normalize();
          tmp.Sax.crossVectors(tmp.W, tmp.R).normalize();

          if (tmp.R.lengthSq() > 0 && tmp.W.lengthSq() > 0) {
            // The offset as it currently stands, which includes anything the
            // user has just dragged or scrolled.
            tmp.offset.subVectors(camera.position, controls.target);

            if (chase.valid && tmp.offset.lengthSq() > 0) {
              // Re-express the offset in the PREVIOUS frame's basis, then
              // rebuild it in the current one. Decomposing and recomposing
              // this way is what lets the user's own camera changes survive:
              // they are read back out of the inertial offset every frame
              // rather than being overwritten.
              const cR = tmp.offset.dot(chase.R);
              const cS = tmp.offset.dot(chase.S);
              const cW = tmp.offset.dot(chase.W);
              camera.position
                .copy(tmp.follow)
                .addScaledVector(tmp.R, cR)
                .addScaledVector(tmp.Sax, cS)
                .addScaledVector(tmp.W, cW);
            } else {
              // First frame of the follow: place the camera above and behind
              // the craft. The radial component is deliberately positive and
              // dominant so the camera starts outside the central body
              // whatever the altitude.
              const standoff = env0BodyRadius * 0.5;
              camera.position
                .copy(tmp.follow)
                .addScaledVector(tmp.R, standoff * 0.55)
                .addScaledVector(tmp.Sax, -standoff * 0.75)
                .addScaledVector(tmp.W, standoff * 0.36);
              camera.near = Math.max(0.0005, standoff * 1e-3);
              camera.updateProjectionMatrix();
            }

            controls.target.copy(tmp.follow);
            chase.R.copy(tmp.R);
            chase.S.copy(tmp.Sax);
            chase.W.copy(tmp.W);
            chase.valid = true;
          }
        } else {
          chase.valid = false;
          const followTarget =
            st.cameraTarget === 'moon'
              ? moon.position
              : st.cameraTarget === 'earth'
                ? earth.position
                : st.cameraTarget === 'sun'
                  ? sun.position
                  : null;
          if (followTarget) {
            tmp.delta.subVectors(followTarget, controls.target);
            // Guard against the first frame after a target switch, where the
            // delta can be the whole scene width and would fling the camera.
            // Snapping the target without moving the camera is right there:
            // the user asked to look at something new.
            if (
              tmp.delta.lengthSq() <
              controls.target.distanceToSquared(camera.position) * 4
            ) {
              camera.position.add(tmp.delta);
            }
            controls.target.copy(followTarget);
          }
        }

      }

      // Applied after any follow adjustment so the damping interpolates
              // toward the new target on this frame rather than the next.
      controls.update();
      renderer.render(scene, camera);
    };

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
      sun,
      earthOrbit,
      planets: planetVisuals,
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
      const jd0 = samples[0].jd;
      const model = result?.config.moonModel ?? 'series';
      const usesMoon =
        centre === 'earth' &&
        ((result?.config.forces.moonGravity ?? false) ||
          (samples[samples.length - 1]?.radius ?? 0) > 1e8);

      if (usesMoon) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 180; i++) {
          const p = moonPosition(jd0 + (i / 180) * 27.321661, model);
          pts.push(new THREE.Vector3(p[0] * activeScale, p[1] * activeScale, p[2] * activeScale));
        }
        r.moonOrbit.geometry.dispose();
        r.moonOrbit.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      }
      r.moonOrbit.visible = usesMoon;
      // The Moon body itself is still worth showing in a Moon-centred run.
      r.moon.visible = usesMoon || centre === 'moon';

      // Heliocentric reference rings. Rebuilt per run rather than per frame:
      // each is 160 Kepler solves, and the orbits do not move perceptibly
      // over any run this tool propagates.
      if (centre === 'sun') {
        const setRing = (line: THREE.Line, pts: THREE.Vector3[]) => {
          line.geometry.dispose();
          line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
          line.visible = true;
        };
        setRing(r.earthOrbit, earthOrbitPoints(jd0, activeScale));
        for (const pv of r.planets) {
          setRing(pv.orbit, planetOrbitPoints(pv.id, jd0, activeScale));
        }
      } else {
        r.earthOrbit.visible = false;
        for (const pv of r.planets) pv.orbit.visible = false;
      }
    }

    // Frame the trajectory: fit the camera distance to the trajectory extent
    // so a new run is immediately visible whatever its scale.
    if (positions.length >= 3) {
      let maxR = 0;
      for (let i = 0; i < positions.length; i += 3) {
        const d = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
        if (d > maxR) maxR = d;
      }
      const bodyR = CENTRAL_RADIUS[centre] * activeScale;
      // Frame on the trajectory extent, not on the body: a 500 km LEO ring sits
      // only 8% outside the Earth's limb, so padding by the body radius would
      // push the camera far enough out to hide the orbit entirely.
      // At a 45 deg vertical field of view the visible half-height at the
      // origin is distance * tan(22.5 deg) = 0.414 * distance, so a factor of
      // 3.0 leaves the trajectory occupying ~80% of the frame height.
      // Heliocentrically the interesting context is the planetary orbits,
      // not just the trajectory: a run that only reaches 1.2 AU should still
      // show Mars, or there is no way to see that it fell short. So the fit
      // includes the outermost drawn orbit when the trajectory is smaller.
      const contextR =
        centre === 'sun' ? Math.max(maxR, 1.6 * AU * activeScale) : maxR;
      // The visible half-WIDTH is the half-height times the aspect ratio, so
      // on a portrait viewport - a phone, where the aspect is about 0.74 -
      // fitting the height is not enough and the orbit runs off the sides.
      // Dividing by the aspect when it is below 1 fits whichever dimension is
      // tighter. On a landscape viewport this is exactly 1 and changes nothing.
      const aspect = r.camera.aspect > 0 ? r.camera.aspect : 1;
      const fit = (Math.max(contextR, bodyR * 1.05) * 3.0) / Math.min(1, aspect);
      const dir = r.camera.position.clone().normalize();
      if (dir.lengthSq() === 0) dir.set(0.6, -0.6, 0.4).normalize();
      r.camera.position.copy(dir.multiplyScalar(fit));
      r.camera.near = Math.max(0.001, fit * 1e-4);
      r.camera.far = Math.max(20000, fit * 40);
      r.camera.updateProjectionMatrix();
      r.controls.update();
    }
  }, [positions, samples, centre, activeScale, result]);

  // --- Retheme --------------------------------------------------------
  // Runs on mount too, which is harmless (it re-applies the palette the scene
  // was just built with) and means there is only one code path.
  useEffect(() => {
    applyPaletteRef.current?.(palette);
  }, [palette]);

  // Read by the render loop via getState(); referenced here only to keep the
  // subscriptions alive.
  void cameraTarget;
  void showVectors;
  void showOrbitTrail;
  void showFullTrajectory;

  // Sized by the flex rule in styles.css rather than inline: the viewport is
  // a flex column that also has to fit the timeline scrubber, so a hard
  // `height: 100%` here would push the scrubber out of the box.
  return <div ref={mountRef} className="viewport-canvas" />;
}
