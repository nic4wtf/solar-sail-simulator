/**
 * Simulation panel: force-model toggles, integrator settings, timestep
 * guidance, and the enabled/disabled effects summary.
 */

import { AU, SEC_PER_DAY } from '../../core/constants.ts';
import {
  CENTRAL_BODY_LABELS,
  CENTRAL_MU,
  CENTRAL_RADIUS,
} from '../../core/environment/environment.ts';
import {
  type PlanetId,
  PLANET_EPHEMERIS_VALID_FROM,
  PLANET_EPHEMERIS_VALID_TO,
  PLANET_FACTS,
  PLANET_IDS,
} from '../../core/environment/planets.ts';
import { periodFromSma } from '../../core/orbital/elements.ts';
import {
  INTEGRATOR_HELP,
  INTEGRATOR_LABELS,
  recommendedTimestep,
  stepsPerRevolution,
  type IntegratorKind,
} from '../../core/integrator/integrators.ts';
import { MOON_MODEL_ACCURACY, MOON_MODEL_LABELS, type MoonModel } from '../../core/environment/moon.ts';
import {
  ATMOSPHERE_ACTIVITY_LABELS,
  ATMOSPHERE_ACTIVITY_NOTES,
  ATMOSPHERE_CUTOFF_ALTITUDE,
  type AtmosphereActivity,
} from '../../core/environment/atmosphere.ts';
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
  const isHeliocentric = config.centralBody === 'sun';
  const mu = CENTRAL_MU[config.centralBody];
  const bodyRadius = CENTRAL_RADIUS[config.centralBody];
  const { integration: integ, forces } = config;
  const epochYear = Number(config.epoch.slice(0, 4));

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

  // Does this orbit reach into the atmosphere? Measured at PERIAPSIS, since
  // that is where drag acts - a Molniya orbit spends most of its time far
  // above the atmosphere and still decays through it twice a revolution.
  let lowOrbit = false;
  try {
    const { r } = initialStateVector(config);
    const rMag = Math.hypot(r[0], r[1], r[2]);
    const sma = Number.isFinite(period)
      ? (mu * (period / (2 * Math.PI)) ** 2) ** (1 / 3)
      : rMag;
    lowOrbit = isEarth && sma * (1 - ecc) - bodyRadius < 600e3;
  } catch {
    /* leave as false */
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
          label="Earth J3 pear-shape term"
          checked={forces.earthJ3}
          disabled={!isEarth}
          onChange={(v) =>
            setConfig((c) => {
              c.forces.earthJ3 = v;
            })
          }
          help="The third zonal harmonic, about 400x smaller than J2 - which still leaves it near 4e-5 m/s^2 in LEO, several times larger than the acceleration of a 1 m^2/kg sail. Being north-south asymmetric it produces a long-period oscillation in eccentricity and argument of periapsis rather than a clean secular drift, and those are exactly the elements a sail is trying to move. It causes no secular change in semi-major axis, so altitude-raising figures are unaffected either way."
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
          checked={forces.sunGravity && !isHeliocentric}
          disabled={isHeliocentric}
          onChange={(v) =>
            setConfig((c) => {
              c.forces.sunGravity = v;
            })
          }
          help="Comparable in magnitude to lunar third-body gravity, about half as large at Earth distances."
          message={
            isHeliocentric
              ? 'The Sun is the integration centre here, so it is the central term rather than a third body.'
              : undefined
          }
        />
        <CheckField
          label="Planetary third-body gravity"
          checked={forces.planetGravity}
          onChange={(v) =>
            setConfig((c) => {
              c.forces.planetGravity = v;
            })
          }
          help="Third-body gravity from the planets selected below. Only meaningful heliocentrically: from Earth orbit, Jupiter's tidal acceleration is about 1e-13 of the central term. Each enabled planet costs a Kepler solve at every acceleration evaluation, which is why the list is explicit rather than all of them."
          message={
            !isHeliocentric && forces.planetGravity
              ? 'Negligible in a planet-centred frame - it costs time and changes nothing.'
              : undefined
          }
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
        <CheckField
          label="Atmospheric drag"
          checked={forces.atmosphericDrag}
          disabled={!isEarth}
          onChange={(v) =>
            setConfig((c) => {
              c.forces.atmosphericDrag = v;
            })
          }
          help="Piecewise-exponential density (US Standard Atmosphere 1976 / CIRA-72) against a rigidly co-rotating atmosphere. The SAIL supplies most of the drag area, projected on the relative wind, so the same attitude command that sets the sail force also sets the drag - which is what makes deorbit sails work, and what makes a Sun-optimal steering law potentially wrong in LEO. Zero above 2000 km."
          message={
            !isEarth
              ? 'The Moon has no atmosphere.'
              : !forces.atmosphericDrag && lowOrbit
                ? 'This orbit passes below 600 km, where drag exceeds the sail force by an order of magnitude. Leaving it off can give the wrong SIGN for the altitude change, not just the wrong size.'
                : undefined
          }
          messageKind={!isEarth ? 'warning' : 'error'}
        />
        <CheckField
          label="Earth albedo radiation pressure"
          checked={forces.earthAlbedo}
          onChange={(v) =>
            setConfig((c) => {
              c.forces.earthAlbedo = v;
            })
          }
          help="Sunlight reflected off the Earth, about 30% of what falls on it. At 500 km over the day side that is roughly 25% of the direct solar flux - but it arrives along the local vertical, where it does very little work on the orbit. Vanishes over the night side, so it is already zero whenever the spacecraft is eclipsed."
        />
        <CheckField
          label="Earth infrared radiation pressure"
          checked={forces.earthInfrared}
          onChange={(v) =>
            setConfig((c) => {
              c.forces.earthInfrared = v;
            })
          }
          help="Thermal emission from the Earth, 240 W/m^2 at the surface and 206 W/m^2 at 500 km. Unlike every other radiation term in the model this one does NOT switch off in eclipse: it is the only force still pushing on the sail in shadow."
        />

        <Notice kind="warning" title="Not modelled">
          Gravity harmonics beyond J3 (including the J22 term that drives geostationary
          longitude drift), lunar gravity harmonics, thermospheric winds and geomagnetic
          storms, solid-body tides, relativistic corrections, sail billow and wrinkling,
          attitude dynamics and control authority limits, sail degradation, and thermal
          deformation.
          <div style={{ marginTop: 4 }}>
            Results are suitable for concept-level analysis and comparison between
            configurations, <strong>not</strong> for flight-dynamics certification.
          </div>
        </Notice>
      </Section>

      <Section title="Atmosphere" subtitle="Only used when atmospheric drag is enabled.">
        <SelectField
          label="Solar activity"
          value={config.atmosphereActivity}
          options={(Object.keys(ATMOSPHERE_ACTIVITY_LABELS) as AtmosphereActivity[]).map(
            (k) => ({ value: k, label: ATMOSPHERE_ACTIVITY_LABELS[k] }),
          )}
          disabled={!forces.atmosphericDrag || !isEarth}
          onChange={(v) =>
            setConfig((c) => {
              c.atmosphereActivity = v;
            })
          }
          help="A blunt multiplier on the thermosphere, ramped in between 100 and 200 km. It stands in for the order-of-magnitude solar-cycle spread that a real density model (NRLMSISE-00, JB2008) would compute from the actual solar and geomagnetic indices. Use it to see how much a drag conclusion depends on the atmosphere assumption, not as a claim about the density."
        />
        <div className="scenario-note">
          {ATMOSPHERE_ACTIVITY_NOTES[config.atmosphereActivity]}
        </div>
        <ReadoutGrid>
          <Readout
            label="Density model"
            value="Piecewise exponential"
            help="28-band fit to the US Standard Atmosphere 1976 / CIRA-72, as tabulated by Vallado Table 8-4. Static: no diurnal bulge, no winds, no geomagnetic response."
          />
          <Readout
            label="Cutoff altitude"
            value={`${(ATMOSPHERE_CUTOFF_ALTITUDE / 1000).toFixed(0)} km`}
            help="Above this the term is skipped entirely. The extrapolated density there is below 1e-16 kg/m^3, six orders of magnitude too small to matter for any spacecraft."
          />
        </ReadoutGrid>
        {forces.atmosphericDrag && isEarth && (
          <Notice kind="info" title="The atmosphere is the least certain thing in this model">
            Thermospheric density varies by an order of magnitude over the solar cycle, by
            a factor of two between day and night, and abruptly during geomagnetic storms.
            A decay estimate from a static model is a scale, not a date. Run it at both
            activity extremes and treat the spread as the answer.
          </Notice>
        )}
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
        {isHeliocentric ? (
          <NumberField
            label="Minimum solar distance floor"
            unit="solar radii"
            value={(integ.minAltitude + bodyRadius) / bodyRadius}
            min={1}
            max={300}
            step={0.5}
            decimals={2}
            onChange={(v) =>
              setConfig((c) => {
                c.integration.minAltitude = Math.max(0, (v - 1) * bodyRadius);
              })
            }
            help="Propagation stops inside this radius. It is the same field as the altitude floor used about a planet, expressed in the unit that means something here. Below about 5 solar radii the corona is dense and the thermal environment destroys any sail material yet made - neither of which is modelled, so a trajectory that goes there is producing numbers the model cannot support."
            message={
              (integ.minAltitude + bodyRadius) / bodyRadius < 5
                ? 'Below 5 solar radii the model has nothing to say: no corona, no thermal limit, no sail degradation.'
                : undefined
            }
          />
        ) : (
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
        )}
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
            label="Integration centre"
            value={CENTRAL_BODY_LABELS[config.centralBody]}
          />
          <Readout
            label="Central body radius"
            value={
              isHeliocentric
                ? `${(bodyRadius / 1000).toExponential(3)} km (${(bodyRadius / AU).toExponential(2)} AU)`
                : `${(bodyRadius / 1000).toFixed(1)} km`
            }
          />
        </ReadoutGrid>

        {(isHeliocentric || forces.planetGravity) && (
          <>
            <div className="field" style={{ marginTop: 6 }}>
              <span className="field-label">
                <span className="field-label-text">Perturbing planets</span>
              </span>
            </div>
            {PLANET_IDS.filter((id) => id !== 'earth').map((id) => (
              <CheckField
                key={id}
                label={`${PLANET_FACTS[id].name} - mu ${PLANET_FACTS[id].mu.toExponential(2)} m^3/s^2`}
                checked={config.perturbingPlanets.includes(id)}
                disabled={!forces.planetGravity}
                onChange={(v) =>
                  setConfig((c) => {
                    const set = new Set<PlanetId>(c.perturbingPlanets);
                    if (v) set.add(id);
                    else set.delete(id);
                    c.perturbingPlanets = PLANET_IDS.filter(
                      (p) => p !== 'earth' && set.has(p),
                    );
                  })
                }
              />
            ))}
            <div className="scenario-note">
              The Earth is never in this list. It is always present as a body in its own
              right, taken from the same solar series every geocentric calculation uses,
              so that the Earth does not move when the integration centre is switched.
              Its gravity follows the Earth-Moon toggle above.
            </div>
            <ReadoutGrid>
              <Readout
                label="Planetary ephemeris"
                value="Standish approximate elements"
                help="Six Keplerian elements per planet plus a linear rate per century, from JPL Solar System Dynamics. A few arcseconds for the inner planets and under an arcminute for the outer ones over the published span - orders of magnitude better than the sail optical coefficients."
              />
              <Readout
                label="Valid span"
                value={`${PLANET_EPHEMERIS_VALID_FROM}-${PLANET_EPHEMERIS_VALID_TO}`}
                kind={
                  epochYear < PLANET_EPHEMERIS_VALID_FROM ||
                  epochYear > PLANET_EPHEMERIS_VALID_TO
                    ? 'bad'
                    : 'good'
                }
              />
            </ReadoutGrid>
            {(epochYear < PLANET_EPHEMERIS_VALID_FROM ||
              epochYear > PLANET_EPHEMERIS_VALID_TO) && (
              <Notice kind="warning" title="Epoch outside the ephemeris span">
                The planetary coefficient set is published for
                {` ${PLANET_EPHEMERIS_VALID_FROM}-${PLANET_EPHEMERIS_VALID_TO}`}. Outside
                it the linear element rates are being extrapolated and the error grows
                quadratically - a long run starting near the edge will drift out of the
                span as it goes.
              </Notice>
            )}
          </>
        )}

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
