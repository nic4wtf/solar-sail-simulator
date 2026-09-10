/**
 * Force model: assembles every enabled acceleration at a given state.
 *
 * This is the ONLY place where the individual force terms are combined, and
 * the only place the attitude controller is invoked. The integrator sees a
 * plain `(t, r, v) -> acceleration` function; the UI sees the annotated
 * `ForceBreakdown` for the diagnostics panels.
 */

import { type Vec3, ZERO, add, norm } from '../vec3.ts';
import { rvToElements } from '../orbital/elements.ts';
import {
  type EnvironmentConfig,
  type EnvironmentSnapshot,
  evaluateEnvironment,
  sunToCraft as sunToCraftVec,
} from '../environment/environment.ts';
import { computeShadow } from '../environment/shadow.ts';
import { centralGravity, j2Earth, j3Earth, thirdBodyGravity } from './gravity.ts';
import { type SrpResult, solarRadiationPressure } from './srp.ts';
import { type DragResult, atmosphericDrag } from './drag.ts';
import { type EarthRadiationResult, earthRadiationPressure } from './albedo.ts';
import type { AtmosphereActivity } from '../environment/atmosphere.ts';
import { type SailConfig, type SpacecraftConfig } from '../sail/sail.ts';
import { type AttitudeConfig, type AttitudeOutput } from '../attitude/types.ts';
import { evaluateAttitude } from '../attitude/rules.ts';

/** Which perturbations are switched on. Mirrors the Simulation panel. */
export interface ForceToggles {
  /** Central-body point-mass gravity. Effectively always on. */
  centralGravity: boolean;
  /** Earth J2 oblateness. Only applied when the centre is the Earth. */
  earthJ2: boolean;
  /** Earth J3 (pear-shape) zonal harmonic. Earth centre only. */
  earthJ3: boolean;
  /**
   * Third-body gravity of whichever of the Earth/Moon pair is not the
   * integration centre - the Moon when Earth-centred, the Earth when
   * Moon-centred, and both when heliocentric.
   */
  moonGravity: boolean;
  /** Third-body gravity of the Sun. Meaningless when the Sun IS the centre. */
  sunGravity: boolean;
  /**
   * Third-body gravity of the configured perturbing planets.
   *
   * Only meaningful heliocentrically: from Earth orbit, Jupiter's tidal
   * acceleration is ~1e-13 of the central term. Each enabled planet costs a
   * Kepler solve per acceleration evaluation, so the list is explicit rather
   * than "all of them".
   */
  planetGravity: boolean;
  /** Solar radiation pressure on the sail. */
  solarRadiationPressure: boolean;
  /** Earth/Moon eclipse of the Sun. */
  eclipse: boolean;
  /**
   * Atmospheric drag, with the sail contributing an attitude-dependent drag
   * area. Earth centre only - the Moon has no atmosphere.
   */
  atmosphericDrag: boolean;
  /** Radiation pressure from sunlight reflected off the Earth. */
  earthAlbedo: boolean;
  /**
   * Radiation pressure from the Earth's thermal infrared emission. Unlike
   * every other radiation term this one does NOT switch off in eclipse.
   */
  earthInfrared: boolean;
}

export const DEFAULT_TOGGLES: ForceToggles = {
  centralGravity: true,
  earthJ2: true,
  earthJ3: false,
  moonGravity: false,
  sunGravity: false,
  planetGravity: false,
  solarRadiationPressure: true,
  eclipse: true,
  atmosphericDrag: false,
  earthAlbedo: false,
  earthInfrared: false,
};

/** Zero drag, for the diagnostics when the term is switched off. */
const NO_DRAG_DETAIL: DragResult = {
  acceleration: ZERO,
  density: 0,
  relativeSpeed: 0,
  dragArea: 0,
  cosWind: 0,
  altitude: 0,
};

/** Everything needed to evaluate the dynamics. */
export interface DynamicsConfig {
  environment: EnvironmentConfig;
  toggles: ForceToggles;
  sail: SailConfig;
  spacecraft: SpacecraftConfig;
  attitude: AttitudeConfig;
  /** Total spacecraft mass [kg]. Derived from `spacecraft`, cached here. */
  mass: number;
  /** Solar-activity assumption for the atmosphere model. */
  atmosphereActivity: AtmosphereActivity;
}

/** Per-term accelerations, for the diagnostics readout and the plots. */
export interface ForceBreakdown {
  /** Sum of all enabled accelerations [m/s^2]. */
  total: Vec3;
  central: Vec3;
  j2: Vec3;
  j3: Vec3;
  moon: Vec3;
  sun: Vec3;
  /** Summed third-body acceleration from the perturbing planets [m/s^2]. */
  planets: Vec3;
  srp: Vec3;
  /** Atmospheric drag acceleration [m/s^2]. */
  drag: Vec3;
  /** Earth albedo + infrared radiation pressure acceleration [m/s^2]. */
  earthRadiation: Vec3;
  /** Full SRP diagnostic result. */
  srpDetail: SrpResult;
  /** Full drag diagnostic result. */
  dragDetail: DragResult;
  /** Full Earth-radiation diagnostic result. */
  earthRadiationDetail: EarthRadiationResult;
  /** Attitude controller output. */
  attitude: AttitudeOutput;
  /** Illumination fraction, 0..1. */
  illumination: number;
  /** Which body is eclipsing the Sun, if any. */
  occulter: 'none' | 'earth' | 'moon';
  /** Environment snapshot used. */
  env: EnvironmentSnapshot;
}

/**
 * Third-body acceleration from whichever of the Earth and Moon are not the
 * integration centre.
 *
 * Planet-centred, that is one body. Heliocentrically it is both, and they must
 * be summed separately rather than lumped at the barycentre: the Moon is
 * 4700 km from the Earth-Moon barycentre and 384,400 km from the Earth, and
 * for a spacecraft passing near either one that difference is the whole
 * encounter.
 */
function earthMoonThirdBody(env: EnvironmentSnapshot, r: Vec3): Vec3 {
  let ax = 0;
  let ay = 0;
  let az = 0;
  for (const body of [env.earth, env.moon]) {
    if (body.isCentral) continue;
    const a = thirdBodyGravity(r, body.position, body.mu);
    ax += a[0];
    ay += a[1];
    az += a[2];
  }
  return [ax, ay, az];
}

/** Summed third-body acceleration from the configured perturbing planets. */
function planetThirdBody(env: EnvironmentSnapshot, r: Vec3): Vec3 {
  let ax = 0;
  let ay = 0;
  let az = 0;
  for (const p of env.planets) {
    const a = thirdBodyGravity(r, p.position, p.mu);
    ax += a[0];
    ay += a[1];
    az += a[2];
  }
  return [ax, ay, az];
}

/**
 * Full annotated evaluation. Used for recorded samples and the live readouts.
 *
 * Cost is dominated by the two analytic ephemerides and the attitude rule;
 * everything else is a handful of flops. Measured at roughly 1.5 us per call,
 * so a 7-day RK4 run at 10 s (~242,000 evaluations) takes well under a second.
 */
export function evaluateForces(
  cfg: DynamicsConfig,
  t: number,
  r: Vec3,
  v: Vec3,
): ForceBreakdown {
  const env = evaluateEnvironment(cfg.environment, t);
  const isEarthCentre = env.centre === 'earth';

  // --- Gravity ---------------------------------------------------------
  const central = cfg.toggles.centralGravity ? centralGravity(r, env.muCentral) : ZERO;

  // J2 and J3 are Earth-shape terms and are only meaningful about the Earth.
  const j2 =
    cfg.toggles.earthJ2 && isEarthCentre ? j2Earth(r, env.muCentral) : ZERO;
  const j3 =
    cfg.toggles.earthJ3 && isEarthCentre ? j3Earth(r, env.muCentral) : ZERO;

  // Third bodies from the Earth/Moon pair: whichever of the two is not the
  // integration centre. Heliocentrically that is both of them.
  const moon = cfg.toggles.moonGravity ? earthMoonThirdBody(env, r) : ZERO;

  const sun =
    cfg.toggles.sunGravity && !env.sun.isCentral
      ? thirdBodyGravity(r, env.sun.position, env.sun.mu)
      : ZERO;

  const planets = cfg.toggles.planetGravity ? planetThirdBody(env, r) : ZERO;

  // --- Eclipse ---------------------------------------------------------
  const shadow = cfg.toggles.eclipse
    ? computeShadow(r, env.sun.position, env.earth.position, env.moon.position)
    : { fraction: 1, occulter: 'none' as const, eclipsed: false };

  // --- Attitude --------------------------------------------------------
  const sunVec = sunToCraftVec(env, r);
  const elements = rvToElements(r, v, env.muCentral);
  const attitude = evaluateAttitude(cfg.attitude, {
    t,
    r,
    v,
    sunToCraft: sunVec,
    elements,
    mu: env.muCentral,
  });

  // --- Radiation on the sail -------------------------------------------
  const srpDetail = cfg.toggles.solarRadiationPressure
    ? solarRadiationPressure(cfg.sail, cfg.mass, sunVec, attitude.normal, shadow.fraction)
    : solarRadiationPressure(cfg.sail, cfg.mass, sunVec, attitude.normal, 0);

  const srp = srpDetail.acceleration;

  // Earth albedo and infrared. Note this is NOT gated on the eclipse
  // fraction: the infrared term is exactly what still acts in shadow, and
  // the albedo term switches itself off geometrically because a spacecraft
  // in the Earth's shadow is over the night side, where the phase factor is
  // zero anyway.
  const earthRadiationDetail = earthRadiationPressure(
    {
      sail: cfg.sail,
      mass: cfg.mass,
      albedo: cfg.toggles.earthAlbedo,
      infrared: cfg.toggles.earthInfrared,
    },
    r,
    env.earth.position,
    env.sun.position,
    attitude.normal,
  );
  const earthRadiation = earthRadiationDetail.acceleration;

  // --- Atmospheric drag ------------------------------------------------
  //
  // Gated as a whole rather than by zeroing the areas: when the term is off
  // the recorded density and drag area must be zero too, or the samples
  // report an atmosphere the trajectory was never flown through. The panels
  // promise that anything not listed as enabled is not being computed, and
  // that has to include the diagnostics.
  const dragOn = cfg.toggles.atmosphericDrag && isEarthCentre;
  const dragDetail = dragOn
    ? atmosphericDrag(
        {
          sailArea: cfg.sail.area,
          sailNormal: attitude.normal,
          busArea: cfg.spacecraft.busArea,
          dragCoefficient: cfg.spacecraft.dragCoefficient,
          mass: cfg.mass,
          activity: cfg.atmosphereActivity,
        },
        r,
        v,
      )
    : NO_DRAG_DETAIL;
  const drag = dragDetail.acceleration;

  const total = add(
    add(add(add(central, j2), add(j3, moon)), add(add(sun, planets), srp)),
    add(drag, earthRadiation),
  );

  return {
    total,
    central,
    j2,
    j3,
    moon,
    sun,
    planets,
    srp,
    drag,
    earthRadiation,
    srpDetail,
    dragDetail,
    earthRadiationDetail,
    attitude,
    illumination: shadow.fraction,
    occulter: shadow.occulter,
    env,
  };
}

/**
 * Hot-path acceleration only.
 *
 * Structurally identical to `evaluateForces` but skips building the
 * diagnostic object. Kept as a separate function rather than a flag so the
 * integrator inner loop stays free of branches and the JIT can specialise it.
 */
export function acceleration(cfg: DynamicsConfig, t: number, r: Vec3, v: Vec3): Vec3 {
  const env = evaluateEnvironment(cfg.environment, t);
  const isEarthCentre = env.centre === 'earth';
  const tog = cfg.toggles;

  let ax = 0;
  let ay = 0;
  let az = 0;

  if (tog.centralGravity) {
    const a = centralGravity(r, env.muCentral);
    ax += a[0];
    ay += a[1];
    az += a[2];
  }
  if (tog.earthJ2 && isEarthCentre) {
    const a = j2Earth(r, env.muCentral);
    ax += a[0];
    ay += a[1];
    az += a[2];
  }
  if (tog.earthJ3 && isEarthCentre) {
    const a = j3Earth(r, env.muCentral);
    ax += a[0];
    ay += a[1];
    az += a[2];
  }
  if (tog.moonGravity) {
    const a = earthMoonThirdBody(env, r);
    ax += a[0];
    ay += a[1];
    az += a[2];
  }
  if (tog.sunGravity && !env.sun.isCentral) {
    const a = thirdBodyGravity(r, env.sun.position, env.sun.mu);
    ax += a[0];
    ay += a[1];
    az += a[2];
  }
  if (tog.planetGravity) {
    for (const p of env.planets) {
      const a = thirdBodyGravity(r, p.position, p.mu);
      ax += a[0];
      ay += a[1];
      az += a[2];
    }
  }

  // Everything below needs the sail attitude. It is the single most
  // expensive thing in this function (an expression rule can compile and
  // evaluate a formula), so it is resolved at most once and only when some
  // enabled term actually consumes it.
  const illumination =
    tog.solarRadiationPressure && tog.eclipse
      ? computeShadow(r, env.sun.position, env.earth.position, env.moon.position).fraction
      : 1;

  const wantsDrag = tog.atmosphericDrag && isEarthCentre;
  const wantsEarthRadiation = tog.earthAlbedo || tog.earthInfrared;
  const wantsSrp = tog.solarRadiationPressure && illumination > 0;
  if (!wantsDrag && !wantsEarthRadiation && !wantsSrp) return [ax, ay, az];

  const sunVec = sunToCraftVec(env, r);
  const elements = rvToElements(r, v, env.muCentral);
  const normal = evaluateAttitude(cfg.attitude, {
    t,
    r,
    v,
    sunToCraft: sunVec,
    elements,
    mu: env.muCentral,
  }).normal;

  if (wantsSrp) {
    const a = solarRadiationPressure(
      cfg.sail,
      cfg.mass,
      sunVec,
      normal,
      illumination,
    ).acceleration;
    ax += a[0];
    ay += a[1];
    az += a[2];
  }
  if (wantsEarthRadiation) {
    const a = earthRadiationPressure(
      {
        sail: cfg.sail,
        mass: cfg.mass,
        albedo: tog.earthAlbedo,
        infrared: tog.earthInfrared,
      },
      r,
      env.earth.position,
      env.sun.position,
      normal,
    ).acceleration;
    ax += a[0];
    ay += a[1];
    az += a[2];
  }
  if (wantsDrag) {
    const a = atmosphericDrag(
      {
        sailArea: cfg.sail.area,
        sailNormal: normal,
        busArea: cfg.spacecraft.busArea,
        dragCoefficient: cfg.spacecraft.dragCoefficient,
        mass: cfg.mass,
        activity: cfg.atmosphereActivity,
      },
      r,
      v,
    ).acceleration;
    ax += a[0];
    ay += a[1];
    az += a[2];
  }

  return [ax, ay, az];
}

/**
 * Just the accumulator quantities: sail and drag acceleration magnitudes,
 * and the illumination fraction.
 *
 * The propagator accumulates the impulse budget and the eclipse time on every
 * step. Calling `evaluateForces` for that would allocate a full diagnostic
 * object per step and roughly double the cost of a run, so this trimmed path
 * exists instead: it does the SRP and drag work and nothing else.
 */
export function impulseSample(
  cfg: DynamicsConfig,
  t: number,
  r: Vec3,
  v: Vec3,
): { sailAccel: number; dragAccel: number; illumination: number } {
  const wantsDrag = cfg.toggles.atmosphericDrag && cfg.environment.centre === 'earth';
  if (!cfg.toggles.solarRadiationPressure && !wantsDrag) {
    return { sailAccel: 0, dragAccel: 0, illumination: 1 };
  }

  const env = evaluateEnvironment(cfg.environment, t);
  const illumination =
    cfg.toggles.solarRadiationPressure && cfg.toggles.eclipse
      ? computeShadow(r, env.sun.position, env.earth.position, env.moon.position).fraction
      : 1;

  const wantsSrp = cfg.toggles.solarRadiationPressure && illumination > 0;
  if (!wantsSrp && !wantsDrag) return { sailAccel: 0, dragAccel: 0, illumination };

  const sunVec = sunToCraftVec(env, r);
  const elements = rvToElements(r, v, env.muCentral);
  const normal = evaluateAttitude(cfg.attitude, {
    t,
    r,
    v,
    sunToCraft: sunVec,
    elements,
    mu: env.muCentral,
  }).normal;

  const sailAccel = wantsSrp
    ? norm(
        solarRadiationPressure(cfg.sail, cfg.mass, sunVec, normal, illumination).acceleration,
      )
    : 0;

  const dragAccel = wantsDrag
    ? norm(
        atmosphericDrag(
          {
            sailArea: cfg.sail.area,
            sailNormal: normal,
            busArea: cfg.spacecraft.busArea,
            dragCoefficient: cfg.spacecraft.dragCoefficient,
            mass: cfg.mass,
            activity: cfg.atmosphereActivity,
          },
          r,
          v,
        ).acceleration,
      )
    : 0;

  return { sailAccel, dragAccel, illumination };
}

/**
 * Ratio of each perturbation to the central acceleration, for the diagnostics
 * table. Makes it obvious when a switched-off term actually mattered.
 */
export function perturbationRatios(b: ForceBreakdown): Record<string, number> {
  const c = norm(b.central) || 1;
  return {
    j2: norm(b.j2) / c,
    j3: norm(b.j3) / c,
    moon: norm(b.moon) / c,
    sun: norm(b.sun) / c,
    planets: norm(b.planets) / c,
    srp: norm(b.srp) / c,
    drag: norm(b.drag) / c,
    earthRadiation: norm(b.earthRadiation) / c,
  };
}
