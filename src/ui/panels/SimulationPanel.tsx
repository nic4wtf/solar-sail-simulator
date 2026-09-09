/**
 * Simulation panel: force-model toggles, integrator settings, timestep
 * guidance, and the enabled/disabled effects summary.
 */

import { MU_EARTH, MU_MOON, R_EARTH, R_MOON, SEC_PER_DAY } from '../../core/constants.ts';
import { periodFromSma } from '../../core/orbital/elements.ts';
import {
  INTEGRATOR_HELP,
  INTEGRATOR_LABELS,
  recommendedTimestep,
  stepsPerRevolution,
  type IntegratorKind,
} from '../../core/integrator/integrators.ts';
import { MOON_MODEL_ACCURACY, MOON_MODEL_LABELS, type MoonModel } from '../../core/environment/moon.ts';
import { formatDuration, formatTimestep, sig } from '../../core/units.ts';
import { MAX_SAMPLES, initialStateVector } from '../../sim/propagator.ts';
import { useStore } from '../../state/store.ts';
import {
  CheckField,
  Collapsible,
  Notice,
  NumberField,
  Readout,
  ReadoutGrid,
  Section,
  SelectField,
} from '../widgets/Controls.tsx';

const TIMESTEP_CHOICES = [0.1, 1, 10, 60];

export function SimulationPanel() {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);

  const isEarth = config.centralBody === 'earth';
  const mu = isEarth ? MU_EARTH : MU_MOON;
  const bodyRadius = isEarth ? R_EARTH : R_MOON;
  const { integration: integ, forces } = config;

  // Initial orbital period, used for all the timestep guidance.
  let period = Infinity;
  let ecc = 0;
  try {
    const { r, v } = initialStateVector(config);
    const rMag = Math.hypot(r[0], r[1], r[2]);
    const vMag = Math.hypot(v[0], v[1], v[2]);
    const energy = (vMag * vMag) / 2 - mu / rMag;
    if (energy < 0) {
      const sma = -mu / (2 * energy);
      period = periodFromSma(sma, mu);
      const hx = r[1] * v[2] - r[2] * v[1];
      const hy = r[2] * v[0] - r[0] * v[2];
      const hz = r[0] * v[1] - r[1] * v[0];
      const h = Math.hypot(hx, hy, hz);
      ecc = Math.sqrt(Math.max(0, 1 - (h * h) / mu / sma));
    }
  } catch {
    /* leave period as Infinity */
  }

  const recommended = recommendedTimestep(period, ecc);
  const spr = stepsPerRevolution(period, integ.timestep);
  const estimatedSteps = integ.duration / integ.timestep;
  const estimatedSamples = Math.floor(integ.duration / integ.outputInterval) + 1;

  // Timestep guidance. RK4 accuracy is governed by steps per revolution, not
  // by the step in seconds, so that is what the warning is written against.
  let timestepMessage: string | undefined;
  let timestepKind: 'warning' | 'error' | 'info' = 'info';
  if (integ.integrator === 'rk4' && Number.isFinite(period)) {
    if (spr < 30) {
      timestepMessage = `Only ${spr.toFixed(0)} steps per revolution. This is far too coarse - expect large spurious drift. Use ${formatTimestep(recommended)} or less.`;
      timestepKind = 'error';
    } else if (spr < 100) {
      timestepMessage = `${spr.toFixed(0)} steps per revolution gives a relative energy error of order 1e-4 per week. Acceptable for a quick look; use ${formatTimestep(recommended)} for quantitative work.`;
      timestepKind = 'warning';
    } else if (spr > 20000) {
      timestepMessage = `${spr.toFixed(0)} steps per revolution is far finer than necessary and only makes the run slow. ${formatTimestep(recommended)} is plenty.`;
      timestepKind = 'info';
    }
  }
  if (integ.integrator === 'rk4' && ecc > 0.3) {
    // Angular rate at periapsis relative to the mean motion:
    //   (dtheta/dt)_p / n = sqrt(1 + e) / (1 - e)^(3/2)
    // This, not the speed ratio, is what sets the required step size.
    const rateRatio = Math.sqrt(1 + ecc) / (1 - ecc) ** 1.5;
    timestepMessage = `At eccentricity ${ecc.toFixed(2)} the spacecraft sweeps angle ${rateRatio.toFixed(0)}x faster at periapsis than its mean rate. One fixed step cannot serve both ends of the orbit - switch to the adaptive integrator, or size the step for periapsis and accept the cost.`;
    timestepKind = 'warning';
  }

  return (
    <div className="panel-body">
      <Section
        title="Enabled effects"
        subtitle="Everything the model is and is not accounting for. Anything not listed here is not modelled."
      >
        <CheckField
          label="Central-body point-mass gravity"
          checked={forces.centralGravity}
          onChange={(v) =>
            setConfig((c) => {
              c.forces.centralGravity = v;
            })
          }
          help="The dominant term. Switching it off is only useful as a diagnostic."
          message={!forces.centralGravity ? 'Gravity is off - this is not an orbit.' : undefined}
        />
        <CheckField
          label="Earth J2 oblateness"
          checked={forces.earthJ2}
          disabled={!isEarth}
          onChange={(v) =>
            setConfig((c) => {
              c.forces.earthJ2 = v;
            })
          }
          help="The dominant non-spherical gravity term, about 1e-3 of the central acceleration in LEO. It drives nodal regression and apsidal rotation, and makes the OSCULATING semi-major axis oscillate by ~12 km in LEO - far more than the sail effect, which is why mean elements are used for all feasibility figures."
          message={!isEarth ? 'Not applicable when integrating about the Moon.' : undefined}
        />
        <CheckField
          label={isEarth ? 'Moon third-body gravity' : 'Earth third-body gravity'}
          checked={forces.moonGravity}
          onChange={(v) =>
            setConfig((c) => {
              c.forces.moonGravity = v;
            })
          }
          help="Required for any lunar work. In LEO it is roughly 1e-7 of the central term and can be neglected; at GEO it is ~1e-5 and matters over a month."
        />
        <CheckField
          label="Sun third-body gravity"
          checked={forces.sunGravity}
          onChange={(v) =>
            setConfig((c) => {
              c.forces.sunGravity = v;
            })
          }
          help="Comparable in magnitude to lunar third-body gravity, about half as large at Earth distances."
        />
        <CheckField
          label="Solar radiation pressure (the sail)"
          checked={forces.solarRadiationPressure}
          onChange={(v) =>
            setConfig((c) => {
              c.forces.solarRadiationPressure = v;
            })
          }
          help="Switch this off to get a clean baseline trajectory, then compare - that difference is unambiguously the sail's effect."
        />
        <CheckField
          label="Eclipse (Earth and Moon shadow)"
          checked={forces.eclipse}
          onChange={(v) =>
            setConfig((c) => {
              c.forces.eclipse = v;
            })
          }
          help="Dual-cone umbra and penumbra geometry with a linear penumbra ramp. In a 500 km LEO the spacecraft is shadowed for roughly 35% of every revolution, so switching this off overstates the available impulse by about a third."
        />

        <Notice kind="warning" title="Not modelled in this version">
          Atmospheric drag, Earth albedo and infrared radiation pressure, gravity harmonics
          beyond J2, lunar gravity harmonics, solid-body tides, relativistic corrections,
          sail billow and wrinkling, attitude dynamics and control authority limits, sail
          degradation, and thermal deformation.
          <div style={{ marginTop: 4 }}>
            Results are suitable for concept-level analysis and comparison between
            configurations, <strong>not</strong> for flight-dynamics certification.
          </div>
        </Notice>
      </Section>

      <Section title="Integrator">
        <SelectField
          label="Scheme"
          value={integ.integrator}
          options={(Object.keys(INTEGRATOR_LABELS) as IntegratorKind[]).map((k) => ({
            value: k,
            label: INTEGRATOR_LABELS[k],
          }))}
          onChange={(v) =>
            setConfig((c) => {
              c.integration.integrator = v;
            })
          }
          help={INTEGRATOR_HELP[integ.integrator]}
        />
        <div className="scenario-note">{INTEGRATOR_HELP[integ.integrator]}</div>

        <NumberField
          label={integ.integrator === 'rk4' ? 'Timestep' : 'Maximum timestep'}
          unit="s"
          value={integ.timestep}
          min={0.001}
          max={86400}
          onChange={(v) =>
            setConfig((c) => {
              c.integration.timestep = v;
            })
          }
          message={timestepMessage}
          messageKind={timestepKind}
          help={
            integ.integrator === 'rk4'
              ? 'Fixed step size. Accuracy is governed by steps per revolution rather than by the value in seconds.'
              : 'The adaptive controller will never exceed this step, which keeps sampling reasonable through the quiet parts of a trajectory.'
          }
        />
        <div className="row">
          {TIMESTEP_CHOICES.map((dt) => (
            <button
              key={dt}
              className="btn btn-sm"
              onClick={() =>
                setConfig((c) => {
                  c.integration.timestep = dt;
                })
              }
            >
              {dt} s
            </button>
          ))}
          {Number.isFinite(recommended) && (
            <button
              className="btn btn-sm btn-primary"
              onClick={() =>
                setConfig((c) => {
                  c.integration.timestep = Number(recommended.toPrecision(2));
                })
              }
              title="Approximately 500 steps per revolution, scaled for eccentricity"
            >
              Recommended ({formatTimestep(recommended)})
            </button>
          )}
        </div>

        {integ.integrator === 'rkf45' && (
          <Collapsible title="Adaptive tolerances">
            <NumberField
              label="Relative tolerance"
              unit="-"
              value={integ.relTol}
              min={1e-14}
              max={1e-4}
              onChange={(v) =>
                setConfig((c) => {
                  c.integration.relTol = v;
                })
              }
              help="Per-step local error target relative to the state magnitude. 1e-10 is a good default for lunar work; below about 1e-13 the controller is fighting double-precision round-off."
            />
            <div className="field-row">
              <NumberField
                label="Absolute position tolerance"
                unit="m"
                value={integ.absTolPosition}
                min={1e-9}
                max={1000}
                onChange={(v) =>
                  setConfig((c) => {
                    c.integration.absTolPosition = v;
                  })
                }
              />
              <NumberField
                label="Absolute velocity tolerance"
                unit="m/s"
                value={integ.absTolVelocity}
                min={1e-12}
                max={1}
                onChange={(v) =>
                  setConfig((c) => {
                    c.integration.absTolVelocity = v;
                  })
                }
              />
            </div>
          </Collapsible>
        )}
      </Section>

      <Section title="Duration and sampling">
        <NumberField
          label="Simulation duration"
          unit="days"
          value={integ.duration / SEC_PER_DAY}
          min={0.001}
          max={3650}
          onChange={(v) =>
            setConfig((c) => {
              c.integration.duration = v * SEC_PER_DAY;
            })
          }
        />
        <NumberField
          label="Output interval"
          unit="s"
          value={integ.outputInterval}
          min={0.01}
          max={86400}
          onChange={(v) =>
            setConfig((c) => {
              c.integration.outputInterval = v;
            })
          }
          help="How often a sample is recorded for the plots and the 3D view. Completely independent of the integration timestep: the physics is integrated at the timestep, and only the recording is thinned. Making this coarser speeds up plotting without affecting accuracy."
          message={
            integ.outputInterval < integ.timestep
              ? 'The output interval is finer than the timestep, so consecutive samples will be duplicates. There is no accuracy benefit.'
              : estimatedSamples > MAX_SAMPLES
                ? `Requesting ${estimatedSamples.toLocaleString()} samples. The propagator will widen the interval automatically to stay within ${MAX_SAMPLES.toLocaleString()}; accuracy is unaffected.`
                : undefined
          }
        />
        <NumberField
          label="Minimum altitude floor"
          unit="km"
          value={integ.minAltitude / 1000}
          min={0}
          max={10000}
          onChange={(v) =>
            setConfig((c) => {
              c.integration.minAltitude = v * 1000;
            })
          }
          help="Propagation stops when the altitude falls below this, and reports an impact or re-entry rather than continuing through the body."
        />
      </Section>

      <Section title="Run estimate">
        <ReadoutGrid>
          <Readout
            label="Initial orbital period"
            value={Number.isFinite(period) ? formatDuration(period) : 'unbound'}
          />
          <Readout
            label="Revolutions covered"
            value={
              Number.isFinite(period) ? sig(integ.duration / period, 4) : 'n/a'
            }
          />
          <Readout
            label="Steps per revolution"
            value={Number.isFinite(spr) ? sig(spr, 4) : 'n/a'}
            kind={spr < 30 ? 'bad' : spr < 100 ? 'neutral' : 'good'}
          />
          <Readout
            label="Integration steps"
            value={
              integ.integrator === 'rk4'
                ? Math.round(estimatedSteps).toLocaleString()
                : `~${Math.round(estimatedSteps).toLocaleString()} (adaptive)`
            }
          />
          <Readout
            label="Acceleration evaluations"
            value={`~${Math.round(estimatedSteps * (integ.integrator === 'rk4' ? 4 : 6)).toLocaleString()}`}
          />
          <Readout
            label="Recorded samples"
            value={Math.min(estimatedSamples, MAX_SAMPLES).toLocaleString()}
          />
        </ReadoutGrid>

        {estimatedSteps > 5e6 && (
          <Notice kind="warning" title="Long run">
            This configuration needs about {(estimatedSteps / 1e6).toFixed(1)} million
            integration steps and may take tens of seconds. The interface stays responsive
            and the run can be cancelled, but consider a coarser timestep or a shorter
            duration for exploration.
          </Notice>
        )}
      </Section>

      <Section title="Ephemerides">
        <SelectField
          label="Lunar ephemeris"
          value={config.moonModel}
          options={(Object.keys(MOON_MODEL_LABELS) as MoonModel[]).map((k) => ({
            value: k,
            label: MOON_MODEL_LABELS[k],
          }))}
          onChange={(v) =>
            setConfig((c) => {
              c.moonModel = v;
            })
          }
          help={MOON_MODEL_ACCURACY[config.moonModel]}
        />
        <div className="scenario-note">{MOON_MODEL_ACCURACY[config.moonModel]}</div>
        <ReadoutGrid>
          <Readout
            label="Solar ephemeris"
            value="Analytic, ~0.01 deg"
            help="Low-precision analytic series from the Astronomical Almanac. A 0.01 degree direction error changes the sail incidence angle by the same amount, altering the force by under 1e-4 relative."
          />
          <Readout
            label="Central body radius"
            value={`${(bodyRadius / 1000).toFixed(1)} km`}
          />
        </ReadoutGrid>

        {config.moonModel === 'circular' && (
          <Notice kind="warning">
            The circular lunar model ignores the lunar eccentricity of 0.0549 and can be
            wrong by up to 21,000 km in position. Use it to understand the sensitivity of a
            result to the ephemeris, not for a quantitative lunar encounter.
          </Notice>
        )}
        {(config.centralBody === 'moon' || forces.moonGravity) && (
          <Notice kind="warning" title="Simplified lunar ephemeris">
            Lunar trajectories in this tool use a truncated analytic series, not a JPL
            ephemeris. Closest-approach distances should be treated as indicative to within
            a few hundred kilometres at best.
          </Notice>
        )}
      </Section>
    </div>
  );
}
