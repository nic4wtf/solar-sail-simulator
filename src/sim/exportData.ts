/**
 * Data export (spec S26): CSV for trajectory samples, JSON for configurations.
 *
 * Everything happens client-side with Blob + object URLs, which is what makes
 * the whole application deployable as static files with no backend.
 */

import { RAD } from '../core/constants.ts';
import { jdToIso } from '../core/environment/time.ts';
import type { SimulationConfig, SimulationResult } from './types.ts';
import type { SweepResult } from './sensitivity.ts';
import { meanElementSeries } from './analysis.ts';

/** One CSV column: header (with unit) and the value extractor. */
interface Column {
  header: string;
  value: (row: Record<string, number>) => number | string;
}

/**
 * Trajectory CSV.
 *
 * Angles are exported in DEGREES and lengths in KILOMETRES, because that is
 * what a spreadsheet user expects; the header names the unit for every column
 * so there is no ambiguity. Positions and velocities keep full precision.
 */
export function trajectoryToCsv(result: SimulationResult): string {
  const { samples, config } = result;
  const mean = meanElementSeries(samples);

  // Index the mean series by sample time for a cheap lookup.
  const meanByT = new Map<number, number>();
  if (mean.valid) mean.t.forEach((t, i) => meanByT.set(t, i));

  const columns: Column[] = [
    { header: 'time_s', value: (r) => r.t },
    { header: 'time_days', value: (r) => r.t / 86400 },
    { header: 'utc', value: (r) => jdToIso(r.jd) },
    { header: 'julian_date', value: (r) => r.jd },

    { header: 'x_km', value: (r) => r.x / 1000 },
    { header: 'y_km', value: (r) => r.y / 1000 },
    { header: 'z_km', value: (r) => r.z / 1000 },
    { header: 'vx_km_s', value: (r) => r.vx / 1000 },
    { header: 'vy_km_s', value: (r) => r.vy / 1000 },
    { header: 'vz_km_s', value: (r) => r.vz / 1000 },
    { header: 'speed_km_s', value: (r) => r.speed / 1000 },
    { header: 'radius_km', value: (r) => r.radius / 1000 },
    { header: 'altitude_km', value: (r) => r.altitude / 1000 },

    { header: 'sma_km', value: (r) => r.sma / 1000 },
    { header: 'eccentricity', value: (r) => r.ecc },
    { header: 'inclination_deg', value: (r) => r.inc * RAD },
    { header: 'raan_deg', value: (r) => r.raan * RAD },
    { header: 'arg_periapsis_deg', value: (r) => r.argp * RAD },
    { header: 'true_anomaly_deg', value: (r) => r.trueAnomaly * RAD },
    { header: 'arg_latitude_deg', value: (r) => r.argLat * RAD },
    { header: 'periapsis_km', value: (r) => r.periapsis / 1000 },
    { header: 'apoapsis_km', value: (r) => r.apoapsis / 1000 },
    { header: 'period_s', value: (r) => r.period },
    { header: 'specific_energy_J_per_kg', value: (r) => r.energy },
    { header: 'ang_momentum_m2_s', value: (r) => r.angularMomentum },

    { header: 'sail_normal_x', value: (r) => r.nx },
    { header: 'sail_normal_y', value: (r) => r.ny },
    { header: 'sail_normal_z', value: (r) => r.nz },
    { header: 'sail_accel_x_m_s2', value: (r) => r.ax },
    { header: 'sail_accel_y_m_s2', value: (r) => r.ay },
    { header: 'sail_accel_z_m_s2', value: (r) => r.az },
    { header: 'sail_accel_um_s2', value: (r) => r.sailAccel * 1e6 },
    { header: 'sail_accel_radial_um_s2', value: (r) => r.sailAccelR * 1e6 },
    { header: 'sail_accel_alongtrack_um_s2', value: (r) => r.sailAccelS * 1e6 },
    { header: 'sail_accel_crosstrack_um_s2', value: (r) => r.sailAccelW * 1e6 },
    { header: 'srp_pressure_uN_m2', value: (r) => r.pressure * 1e6 },
    { header: 'sun_incidence_deg', value: (r) => r.incidence * RAD },
    { header: 'steer_angle_1_deg', value: (r) => r.steer1 * RAD },
    { header: 'steer_angle_2_deg', value: (r) => r.steer2 * RAD },
    { header: 'illumination_fraction', value: (r) => r.illumination },

    { header: 'earth_distance_km', value: (r) => r.earthDistance / 1000 },
    { header: 'moon_distance_km', value: (r) => r.moonDistance / 1000 },
    { header: 'sun_distance_au', value: (r) => r.sunDistance / 1.495978707e11 },
    { header: 'beta_angle_deg', value: (r) => r.betaAngle * RAD },
    { header: 'delta_v_equivalent_m_s', value: (r) => r.deltaVEquivalent },
  ];

  const lines: string[] = [];

  // A short provenance header, commented so most tools skip it. Anyone reading
  // an exported file months later needs to know which model produced it.
  lines.push(`# Solar Sail Simulator trajectory export`);
  lines.push(`# configuration: ${config.name}`);
  lines.push(`# scenario: ${config.scenarioId}`);
  lines.push(`# epoch (UTC): ${config.epoch}`);
  lines.push(`# frame: ${config.centralBody === 'earth' ? 'Earth-centred inertial (J2000 equatorial axes)' : 'Moon-centred inertial (J2000 equatorial axes)'}`);
  lines.push(`# integrator: ${config.integration.integrator}, timestep ${config.integration.timestep} s`);
  lines.push(`# forces: ${Object.entries(config.forces).filter(([, on]) => on).map(([k]) => k).join(', ') || 'none'}`);
  lines.push(`# sail: ${config.sail.area} m^2, model ${config.sail.forceModel}`);
  lines.push(`# mass: ${config.spacecraft.dryMass + config.spacecraft.propellantMass} kg`);
  lines.push(`# elements are OSCULATING; mean_* columns are revolution-averaged where available`);

  const header = [...columns.map((c) => c.header)];
  if (mean.valid) header.push('mean_sma_km', 'mean_eccentricity', 'mean_inclination_deg');
  lines.push(header.join(','));

  for (const s of samples) {
    const row = s as unknown as Record<string, number>;
    const cells = columns.map((c) => {
      const v = c.value(row);
      if (typeof v === 'string') return v;
      return Number.isFinite(v) ? formatNumber(v) : '';
    });
    if (mean.valid) {
      const idx = meanByT.get(s.t);
      if (idx === undefined) {
        cells.push('', '', '');
      } else {
        cells.push(
          formatNumber(mean.sma[idx] / 1000),
          formatNumber(mean.ecc[idx]),
          formatNumber(mean.inc[idx] * RAD),
        );
      }
    }
    lines.push(cells.join(','));
  }

  return lines.join('\n');
}

/**
 * Format a number for CSV: enough significant digits to round-trip a double
 * without producing 17-digit noise for well-conditioned values.
 */
function formatNumber(x: number): string {
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a < 1e-10 || a >= 1e12) return x.toExponential(10);
  return String(Number(x.toPrecision(12)));
}

/** Sensitivity sweep CSV. */
export function sweepToCsv(sweep: SweepResult): string {
  const lines: string[] = [];
  lines.push(`# Solar Sail Simulator sensitivity sweep`);
  lines.push(`# parameter: ${sweep.parameterLabel} [${sweep.parameterUnit}]`);
  lines.push(`# metric: ${sweep.metricLabel} [${sweep.metricUnit}]`);
  for (const note of sweep.notes) lines.push(`# note: ${note}`);
  lines.push(
    [
      `parameter_${sweep.parameterUnit.replace(/[^\w]/g, '_')}`,
      `metric_${sweep.metricUnit.replace(/[^\w]/g, '_')}`,
      'termination',
    ].join(','),
  );
  for (const p of sweep.points) {
    lines.push(
      [
        formatNumber(p.value),
        p.metric === null ? '' : formatNumber(p.metric),
        p.termination,
      ].join(','),
    );
  }
  return lines.join('\n');
}

/** Configuration JSON, pretty-printed for hand editing and diffing. */
export function configToJson(config: SimulationConfig): string {
  return JSON.stringify(config, null, 2);
}

/**
 * Parse and validate a configuration JSON string.
 *
 * Validation is deliberately structural rather than exhaustive: the point is
 * to reject a file that would crash the propagator or silently produce
 * nonsense, and to give a useful message when it does.
 */
export function configFromJson(text: string): SimulationConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  // `typeof [] === 'object'`, so arrays need an explicit rejection or they
  // fall through and produce a confusing "unsupported version undefined".
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Configuration must be a JSON object.');
  }
  const cfg = parsed as Partial<SimulationConfig>;

  if (cfg.version !== 1) {
    throw new Error(
      `Unsupported configuration version ${String(cfg.version)}. This build reads version 1.`,
    );
  }
  const required: Array<keyof SimulationConfig> = [
    'epoch',
    'centralBody',
    'initial',
    'spacecraft',
    'sail',
    'attitude',
    'forces',
    'integration',
  ];
  for (const key of required) {
    if (cfg[key] === undefined) throw new Error(`Configuration is missing "${key}".`);
  }
  if (cfg.centralBody !== 'earth' && cfg.centralBody !== 'moon') {
    throw new Error(`Unknown central body "${String(cfg.centralBody)}".`);
  }
  if (!Number.isFinite(Date.parse(String(cfg.epoch)))) {
    throw new Error(`Epoch "${String(cfg.epoch)}" is not a parseable date.`);
  }
  const integ = cfg.integration!;
  if (!(integ.timestep > 0)) throw new Error('Integration timestep must be positive.');
  if (!(integ.duration > 0)) throw new Error('Integration duration must be positive.');
  if (!(integ.outputInterval > 0)) throw new Error('Output interval must be positive.');
  if (!(cfg.sail!.area > 0)) throw new Error('Sail area must be positive.');
  if (!(cfg.spacecraft!.dryMass > 0)) throw new Error('Dry mass must be positive.');

  // Fill in fields added after v1 shipped, so older files still load.
  return {
    ...cfg,
    name: cfg.name ?? 'Loaded configuration',
    scenarioId: cfg.scenarioId ?? 'earth-custom',
    moonModel: cfg.moonModel ?? 'series',
  } as SimulationConfig;
}

// ---------------------------------------------------------------------------
// Browser download helpers
// ---------------------------------------------------------------------------

/** Trigger a client-side file download. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Filename-safe slug from a configuration name. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'simulation'
  );
}
