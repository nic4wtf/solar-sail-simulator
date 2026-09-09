/**
 * Preset missions (spec S21).
 *
 * Each preset is a complete configuration paired with the QUESTION it is meant
 * to help answer and a note on what to look at. They are worked examples, not
 * claims of optimality - every note says so where it matters.
 */

import { DEG, SEC_PER_DAY } from '../core/constants.ts';
import { DEFAULT_SAIL } from '../core/sail/sail.ts';
import type { AttitudeConfig } from '../core/attitude/types.ts';
import type { SimulationConfig } from './types.ts';
import { DEFAULT_EPOCH, buildScenario } from './scenarios.ts';

export interface Preset {
  id: string;
  name: string;
  /** The engineering question this preset is set up to answer. */
  question: string;
  /** What to look at once it has run. */
  guidance: string;
  build: (epoch?: string) => SimulationConfig;
}

/** Feathering schedule in the Sun frame - see DEFAULT_ATTITUDE. */
function featherSchedule(activeCone: number): AttitudeConfig {
  return {
    kind: 'orbitFraction',
    frame: 'sun',
    phaseVariable: 'sunPhase',
    knots: [
      { fraction: 0.0, angle1: 90 * DEG, angle2: 0 },
      { fraction: 0.45, angle1: 90 * DEG, angle2: 0 },
      { fraction: 0.55, angle1: activeCone, angle2: 0 },
      { fraction: 0.95, angle1: activeCone, angle2: 0 },
    ],
  };
}

export const PRESETS: Preset[] = [
  {
    id: 'leo-raise',
    name: 'LEO altitude raising',
    question: 'Can a solar sail raise a 500 km circular orbit, and how fast?',
    guidance:
      'Watch the MEAN semi-major axis trace, not the osculating one - J2 makes the osculating value swing about 12 km peak-to-peak, which is hundreds of times larger than the sail effect. Compare the achieved acceleration against the characteristic acceleration in the Feasibility panel to see how much eclipse and geometry cost.',
    build: (epoch = DEFAULT_EPOCH) => {
      const cfg = buildScenario('leo-circular', epoch);
      cfg.name = 'LEO altitude raising';
      cfg.attitude = { kind: 'optimalDirection', direction: 'prograde' };
      cfg.integration.duration = 14 * SEC_PER_DAY;
      return cfg;
    },
  },
  {
    id: 'leo-ecc',
    name: 'LEO eccentricity change',
    question: 'Can an orbit-phase-dependent sail attitude pump eccentricity?',
    guidance:
      'The schedule pushes prograde near periapsis and retrograde near apoapsis, which raises apoapsis while leaving periapsis roughly alone. Look at the mean eccentricity trace and at the periapsis/apoapsis pair in the Mission plots.',
    build: (epoch = DEFAULT_EPOCH) => {
      const cfg = buildScenario('earth-elliptical', epoch);
      cfg.name = 'LEO eccentricity change';
      cfg.attitude = {
        kind: 'orbitFraction',
        frame: 'rsw',
        // Phased on TRUE anomaly, because eccentricity change is what is
        // being targeted and true anomaly is measured from periapsis.
        phaseVariable: 'trueAnomaly',
        knots: [
          { fraction: 0.0, angle1: 35 * DEG, angle2: 0 },
          { fraction: 0.25, angle1: 0, angle2: 0 },
          { fraction: 0.5, angle1: -35 * DEG, angle2: 0 },
          { fraction: 0.75, angle1: 0, angle2: 0 },
        ],
      };
      cfg.integration.duration = 30 * SEC_PER_DAY;
      return cfg;
    },
  },
  {
    id: 'geo-influence',
    name: 'GEO influence',
    question: 'How much can a sail perturb a geostationary orbit in a month?',
    guidance:
      'At GEO the local gravity is 44 times weaker than in LEO, so the same sail is a much larger relative perturbation, and eclipses are brief and infrequent. Solar and lunar third-body gravity are enabled here - switch them off in the Simulation panel to see how large they are compared with the sail.',
    build: (epoch = DEFAULT_EPOCH) => {
      const cfg = buildScenario('geo', epoch);
      cfg.name = 'GEO influence';
      cfg.attitude = featherSchedule(35 * DEG);
      cfg.integration.duration = 30 * SEC_PER_DAY;
      return cfg;
    },
  },
  {
    id: 'earth-escape',
    name: 'Earth escape experiment',
    question: 'Can sustained solar sailing raise orbital energy enough to escape?',
    guidance:
      'A large sail on a small spacecraft (1000 m^2, 50 kg) starting from a high orbit, steered continuously along the locally optimal prograde direction for 180 days. Watch the specific orbital energy trace approach zero. If it crosses zero the simulator reports an escape trajectory; if it does not, it says so.',
    build: (epoch = DEFAULT_EPOCH) => {
      const cfg = buildScenario('earth-escape', epoch);
      cfg.name = 'Earth escape experiment';
      return cfg;
    },
  },
  {
    id: 'lunar-transfer',
    name: 'Lunar transfer',
    question: 'Does sail steering measurably shift a lunar encounter?',
    guidance:
      'The departure ellipse is aimed at the Moon by a geometric heuristic, NOT an optimiser, so the baseline miss distance is already non-zero. Run it once, note the closest-approach distance in the Results summary, then change the sail attitude or area and run again. The change in miss distance is the sail effect. Lunar orbit insertion is not expected and will not be claimed.',
    build: (epoch = DEFAULT_EPOCH) => {
      const cfg = buildScenario('lunar-transfer', epoch);
      cfg.name = 'Lunar transfer';
      cfg.sail = { ...DEFAULT_SAIL, area: 400 };
      cfg.spacecraft = { dryMass: 50, propellantMass: 0 };
      return cfg;
    },
  },
  {
    id: 'lunar-flyby',
    name: 'Lunar flyby',
    question: 'Can the sail modify a lunar flyby, and what does it do downstream?',
    guidance:
      'Same departure as the transfer preset but propagated well past the encounter, so the post-flyby trajectory is visible. Switch the camera to Moon-centred in the 3D view to see the hyperbolic passage. Compare the post-encounter orbital energy with and without solar radiation pressure enabled.',
    build: (epoch = DEFAULT_EPOCH) => {
      const cfg = buildScenario('lunar-transfer', epoch);
      cfg.name = 'Lunar flyby';
      cfg.scenarioId = 'lunar-transfer';
      cfg.sail = { ...DEFAULT_SAIL, area: 400 };
      cfg.spacecraft = { dryMass: 50, propellantMass: 0 };
      cfg.attitude = { kind: 'optimalDirection', direction: 'prograde' };
      cfg.integration.duration = 20 * SEC_PER_DAY;
      cfg.integration.outputInterval = Math.round((20 * SEC_PER_DAY) / 4000);
      return cfg;
    },
  },
  {
    id: 'eclipse-cost',
    name: 'Eclipse cost comparison',
    question: 'How much does eclipse actually cost a LEO solar sail?',
    guidance:
      'A dawn-dusk sun-synchronous orbit keeps the Sun near the orbit plane normal, so the spacecraft is almost never shadowed. Run this, note the eclipse fraction and the achieved acceleration, then load the LEO altitude raising preset and compare. The difference is nearly a factor of two in useful impulse.',
    build: (epoch = DEFAULT_EPOCH) => {
      const cfg = buildScenario('leo-sso-dawn-dusk', epoch);
      cfg.name = 'Eclipse cost comparison';
      cfg.attitude = { kind: 'optimalDirection', direction: 'prograde' };
      cfg.integration.duration = 14 * SEC_PER_DAY;
      return cfg;
    },
  },
];

export const PRESETS_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));
