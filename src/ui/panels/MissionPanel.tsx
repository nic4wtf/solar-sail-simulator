/**
 * Mission panel - the one-screen mission builder.
 *
 * WHY THIS PANEL LOOKS LIKE THIS. Building a custom configuration used to
 * mean visiting four tabs in turn: Mission for the scenario and epoch,
 * Spacecraft for the orbit and the mass, Solar Sail for the area, Attitude
 * for the steering law and Simulation for the duration. Every one of those
 * five is needed for even the simplest question ("this sail, this orbit, this
 * steering law, how long?"), so the common case paid the full cost of the
 * rare one.
 *
 * This panel now carries the whole of that common case: the eight or so
 * parameters that define a run, in the order someone actually decides them,
 * with the derived numbers that tell you whether the choice was sensible
 * sitting next to the inputs that produced them. The specialist tabs are
 * unchanged and remain the place for optical coefficients, schedule knots,
 * integrator tolerances and the rest - each section here links straight to
 * its own tab, so nothing is hidden, only deferred.
 *
 * The rule applied throughout: a control belongs here if you would change it
 * to answer a different question, and belongs in a specialist tab if you
 * would change it to answer the same question more precisely.
 */

import { useRef, useState, type ReactNode } from 'react';
import {
  SCENARIOS,
  SCENARIO_GROUP_LABELS,
  SCENARIOS_BY_ID,
  DEFAULT_ATTITUDE,
  type ScenarioGroup,
} from '../../sim/scenarios.ts';
import { PRESETS } from '../../sim/presets.ts';
import { configFromJson, configToJson, downloadText, slugify } from '../../sim/exportData.ts';
import { CENTRAL_BODY_LABELS } from '../../core/environment/environment.ts';
import { AU, DEG, SEC_PER_DAY } from '../../core/constants.ts';
import {
  type PlanetId,
  PLANET_FACTS,
  PLANET_IDS,
} from '../../core/environment/planets.ts';
import { transferReference } from '../../sim/scenarios.ts';
import {
  INTEGRATOR_LABELS,
  recommendedTimestep,
  stepsPerRevolution,
  type IntegratorKind,
} from '../../core/integrator/integrators.ts';
import {
  ATTITUDE_RULE_LABELS,
  THRUST_DIRECTION_LABELS,
  type AttitudeConfig,
  type AttitudeRuleKind,
  type ThrustDirection,
} from '../../core/attitude/types.ts';
import { sailPerformance, totalMass } from '../../core/sail/sail.ts';
import {
  formatAccel,
  formatDistanceFor,
  formatDuration,
  formatTimestep,
  formatVelocity,
  radToDeg,
  sig,
} from '../../core/units.ts';
import { useStore, type PanelTab } from '../../state/store.ts';
import {
  Collapsible,
  Notice,
  NumberField,
  Readout,
  ReadoutGrid,
  Section,
  SelectField,
} from '../widgets/Controls.tsx';
import { InitialOrbitFields } from './blocks/InitialOrbitFields.tsx';
import { centralBodyFacts, deriveInitialOrbit } from './blocks/orbitDerived.ts';

const GROUP_ORDER: ScenarioGroup[] = ['earth', 'lunar', 'interplanetary'];

/**
 * Link to the tab that owns the full version of a setting.
 *
 * Deliberately a button rather than a note telling the user where to go: the
 * point of consolidating was to remove navigation, so where navigation is
 * genuinely needed it should be one click.
 */
function MoreIn({ tab, children }: { tab: PanelTab; children: ReactNode }) {
  const setActiveTab = useStore((s) => s.setActiveTab);
  return (
    <button type="button" className="tab-link" onClick={() => setActiveTab(tab)}>
      {children} &rarr;
    </button>
  );
}

export function MissionPanel() {
  const config = useStore((s) => s.config);
  const loadScenario = useStore((s) => s.loadScenario);
  const loadPreset = useStore((s) => s.loadPreset);
  const setConfig = useStore((s) => s.setConfig);
  const replaceConfig = useStore((s) => s.replaceConfig);
  const reset = useStore((s) => s.reset);
  const run = useStore((s) => s.run);
  const dirty = useStore((s) => s.dirty);
  const runState = useStore((s) => s.runState);

  const fileRef = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scenario = SCENARIOS_BY_ID.get(config.scenarioId);
  const { isEarth, isHeliocentric, name: bodyName, frame } = centralBodyFacts(config);
  const len = (m: number) => formatDistanceFor(m, isHeliocentric);
  const derived = deriveInitialOrbit(config);
  const perf = sailPerformance(config.sail, config.spacecraft);
  const integ = config.integration;

  const period = derived?.period ?? Infinity;
  const spr = stepsPerRevolution(period, integ.timestep);
  const recommended = recommendedTimestep(period, derived?.ecc ?? 0);

  // The epoch input is a datetime-local control, so it needs the trailing Z
  // and the seconds trimmed off.
  const epochLocal = config.epoch.replace('Z', '').slice(0, 16);

  const handleFile = async (file: File) => {
    setLoadError(null);
    try {
      const text = await file.text();
      replaceConfig(configFromJson(text));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="panel-body">
      {/* ---------------- 1. Where ---------------- */}
      <Section
        title="Scenario"
        subtitle="Replaces the whole configuration with sensible defaults for that regime, including the force model and the integrator. Everything below can then be changed freely."
      >
        <select
          className="select-input"
          value={config.scenarioId}
          onChange={(e) => loadScenario(e.target.value)}
        >
          {GROUP_ORDER.map((group) => (
            <optgroup key={group} label={SCENARIO_GROUP_LABELS[group]}>
              {SCENARIOS.filter((s) => s.group === group).map((s) => (
                <option key={s.id} value={s.id} disabled={s.future}>
                  {s.name}
                  {s.future ? ' - future version' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {scenario && <div className="scenario-note">{scenario.description}</div>}
        {scenario?.note && (
          <Notice kind={scenario.future ? 'warning' : 'info'}>{scenario.note}</Notice>
        )}
      </Section>

      {/* ---------------- 2. When ---------------- */}
      <Section
        title="Epoch"
        subtitle="Sets the Sun and Moon geometry. For a solar sail this changes the answer substantially - the beta angle of a LEO orbit swings through its full range over a year."
      >
        <input
          className="text-input"
          type="datetime-local"
          value={epochLocal}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            setConfig((c) => {
              c.epoch = `${v.length === 16 ? `${v}:00` : v}Z`;
            });
          }}
        />
        <div className="field-msg field-msg-info">
          Interpreted as UTC. Integration frame: {frame} - {CENTRAL_BODY_LABELS[config.centralBody]}.
        </div>
      </Section>

      {/* ---------------- 3. What orbit ---------------- */}
      <Section title="Initial orbit" subtitle={`About the ${bodyName}, in the inertial ${frame} frame.`}>
        <InitialOrbitFields derived={derived} />

        {derived && (
          <ReadoutGrid>
            <Readout label="Periapsis / apoapsis" value={
              derived.unbound
                ? `${len(derived.periapsis)} / unbound`
                : `${len(derived.periapsis)} / ${len(derived.apoapsis)}`
            } />
            <Readout
              label="Orbital period"
              value={derived.unbound ? 'unbound trajectory' : formatDuration(derived.period)}
              emphasis
            />
            <Readout label="Initial speed" value={formatVelocity(derived.speed)} />
            <Readout
              label="Circular speed here"
              value={formatVelocity(derived.vCirc)}
              help="Comparing the two tells you immediately whether the orbit is circular, elliptical or hyperbolic."
            />
          </ReadoutGrid>
        )}

        {derived?.unbound && (
          <Notice kind="warning" title="Escape trajectory">
            The initial speed exceeds the local escape speed, so this is an unbound
            trajectory. Mean orbital elements will not be available.
          </Notice>
        )}

        {isHeliocentric && <TargetBody />}

        <MoreIn tab="spacecraft">Mass budget, drag properties and frame details</MoreIn>
      </Section>

      {/* ---------------- 4. What spacecraft ---------------- */}
      <Section
        title="Spacecraft and sail"
        subtitle="The two numbers that decide everything else: how heavy it is and how much sail it carries."
      >
        <div className="field-row">
          <NumberField
            label="Dry mass"
            unit="kg"
            value={config.spacecraft.dryMass}
            min={0.01}
            max={100000}
            onChange={(v) =>
              setConfig((c) => {
                c.spacecraft.dryMass = v;
              })
            }
            help="Structure, payload, avionics and the sail assembly itself."
          />
          <NumberField
            label="Sail area"
            unit="m^2"
            value={config.sail.area}
            min={0.01}
            max={1e6}
            onChange={(v) =>
              setConfig((c) => {
                c.sail.area = v;
              })
            }
            help="Reflective area. Only the projected area cos(alpha) contributes to the force at any instant."
          />
        </div>

        <ReadoutGrid>
          <Readout label="Total mass" value={`${sig(totalMass(config.spacecraft), 6)} kg`} />
          <Readout
            label="Area-to-mass ratio"
            value={`${sig(perf.areaToMass, 4)} m^2/kg`}
            emphasis
            help="The governing parameter. IKAROS flew 0.64, LightSail 2 flew 6.4, and interplanetary studies assume 50-100."
          />
          <Readout
            label="Characteristic acceleration"
            value={formatAccel(perf.characteristicAcceleration)}
            help="Acceleration of a Sun-facing sail at 1 AU - an upper bound the real trajectory never reaches, because of incidence angle, eclipse and geometry."
          />
          <Readout label="Lightness number" value={sig(perf.lightnessNumber, 4)} />
        </ReadoutGrid>

        {perf.areaToMass > 50 && (
          <Notice kind="warning">
            {sig(perf.areaToMass, 3)} m^2/kg is far beyond anything flown. Results are a
            physics extrapolation, not an engineering projection.
          </Notice>
        )}

        {isHeliocentric && (
          <Notice
            kind={perf.lightnessNumber >= 0.5 ? 'success' : 'info'}
            title={`Lightness number ${sig(perf.lightnessNumber, 3)}`}
          >
            Out here beta is the governing parameter, not the area-to-mass ratio: it is
            the sail acceleration divided by solar gravity, and both fall off as 1/r^2, so
            their ratio is the same everywhere.{' '}
            {perf.lightnessNumber >= 0.5
              ? 'Above 0.5 a Sun-facing sail on a circular orbit is already at escape speed in the reduced effective gravity mu(1 - beta) - this configuration can leave the solar system without help.'
              : 'Below 0.5 the sail cannot escape from a circular orbit by pointing straight out; it has to spiral, which takes years. Falling inward first raises the pressure by 1/r^2 and is the sail equivalent of an Oberth manoeuvre.'}
          </Notice>
        )}

        <MoreIn tab="sail">Optical coefficients and the force law</MoreIn>
      </Section>

      {/* ---------------- 5. How steered ---------------- */}
      <Section
        title="Steering law"
        subtitle="What the sail is told to do. This matters more than the sail area: an unsteered sail changes a closed orbit by almost nothing, however large it is."
      >
        <QuickAttitude />
        <MoreIn tab="attitude">Full steering editor, schedules and custom equations</MoreIn>
      </Section>

      {/* ---------------- 6. How long ---------------- */}
      <Section title="Run setup">
        <div className="field-row">
          <NumberField
            label="Duration"
            unit="days"
            value={integ.duration / SEC_PER_DAY}
            min={0.001}
            max={3650}
            onChange={(v) =>
              setConfig((c) => {
                c.integration.duration = v * SEC_PER_DAY;
                // Keep roughly 4000 samples, which is what the plots want.
                // Without this a duration change silently produces either a
                // jagged chart or a 20,000-sample cap warning.
                c.integration.outputInterval = Math.max(
                  c.integration.timestep,
                  Math.round((v * SEC_PER_DAY) / 4000),
                );
              })
            }
            help="Sail effects are secular and small: a week is the shortest run in which a LEO trend is visible above the J2 oscillation."
          />
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
            message={
              integ.integrator === 'rk4' && Number.isFinite(spr) && spr < 100
                ? `Only ${spr.toFixed(0)} steps per revolution - too coarse for a quantitative result.`
                : undefined
            }
            messageKind={spr < 30 ? 'error' : 'warning'}
          />
        </div>

        <div className="row">
          <SelectField
            label="Integrator"
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
          />
        </div>

        {Number.isFinite(recommended) && (
          <div className="row">
            <button
              className="btn btn-sm"
              onClick={() =>
                setConfig((c) => {
                  c.integration.timestep = Number(recommended.toPrecision(2));
                })
              }
              title="Approximately 500 steps per revolution, scaled for eccentricity"
            >
              Use recommended timestep ({formatTimestep(recommended)})
            </button>
          </div>
        )}

        <ReadoutGrid>
          <Readout
            label="Revolutions covered"
            value={Number.isFinite(period) ? sig(integ.duration / period, 4) : 'n/a'}
          />
          <Readout
            label="Steps per revolution"
            value={Number.isFinite(spr) ? sig(spr, 4) : 'n/a'}
            kind={spr < 30 ? 'bad' : spr < 100 ? 'neutral' : 'good'}
          />
          <Readout
            label="Integration steps"
            value={Math.round(integ.duration / integ.timestep).toLocaleString()}
          />
        </ReadoutGrid>

        <MoreIn tab="simulation">Tolerances, sampling and the altitude floor</MoreIn>
      </Section>

      {/* ---------------- 7. What physics ---------------- */}
      <Section
        title="Effects included"
        subtitle="Everything the model is accounting for. Anything not listed is not modelled."
      >
        <EffectChips />
        <MoreIn tab="simulation">Full force model and ephemeris options</MoreIn>
      </Section>

      <Section title="Run">
        <button
          className="btn btn-primary"
          onClick={() => void run()}
          disabled={runState === 'propagating'}
        >
          {runState === 'propagating' ? 'Propagating...' : 'Run simulation'}
        </button>
        {dirty && (
          <div className="field-msg field-msg-info">
            The configuration has changed since the last run.
          </div>
        )}
      </Section>

      {/* ---------------- Reference material, folded away ---------------- */}
      <Collapsible title="Preset missions" badge={`${PRESETS.length}`}>
        <p className="section-subtitle">
          Worked examples, each set up to answer one question. They are illustrations, not
          optimal trajectories.
        </p>
        {PRESETS.map((p) => (
          <div className="preset-card" key={p.id}>
            <div className="preset-name">{p.name}</div>
            <div className="preset-question">{p.question}</div>
            <div className="preset-guidance">{p.guidance}</div>
            <button className="btn btn-sm" onClick={() => loadPreset(p.id)}>
              Load preset
            </button>
          </div>
        ))}
      </Collapsible>

      <Collapsible title="Save, load and reset">
        <div className="row">
          <button
            className="btn btn-sm"
            onClick={() =>
              downloadText(
                `${slugify(config.name)}-config.json`,
                configToJson(config),
                'application/json',
              )
            }
          >
            Save configuration (JSON)
          </button>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            Load configuration
          </button>
          <button className="btn btn-sm" onClick={reset}>
            Reset to default
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        {loadError && (
          <Notice kind="error" title="Could not load that configuration">
            {loadError}
          </Notice>
        )}
        <div style={{ marginTop: 8 }}>
          <label className="field-label" htmlFor="config-name">
            <span className="field-label-text">Configuration name</span>
          </label>
          <input
            id="config-name"
            className="text-input"
            type="text"
            value={config.name}
            onChange={(e) =>
              setConfig((c) => {
                c.name = e.target.value;
              })
            }
          />
        </div>
      </Collapsible>

      {!isEarth && (
        <Notice kind="info" title="Moon-centred integration">
          Orbital elements here are relative to the Earth equator, not the lunar equator or
          the ecliptic - the MCI frame shares the ECI axes and differs only in origin.
        </Notice>
      )}
    </div>
  );
}

/**
 * Target-planet picker, with the two numbers that decide whether reaching it
 * is even the right question.
 *
 * The Hohmann time of flight is what a CHEMICAL mission would take, quoted as
 * the yardstick a sail result should be read against - a sail spirals and
 * takes longer, and carries no propellant. The synodic period is the spacing
 * of launch opportunities, and it is the honest answer to "why did my
 * trajectory reach Mars's orbit and miss Mars by 2 AU": nothing here phases
 * the departure.
 */
function TargetBody() {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);
  const target = config.targetBody;

  const options = [
    { value: 'none', label: 'None - track nothing' },
    ...PLANET_IDS.filter((id) => id !== 'earth').map((id) => ({
      value: id,
      label: PLANET_FACTS[id].name,
    })),
  ];

  const ref = target ? transferReference(target) : null;

  return (
    <>
      <SelectField
        label="Track closest approach to"
        value={target ?? 'none'}
        options={options}
        onChange={(v) =>
          setConfig((c) => {
            c.targetBody = v === 'none' ? undefined : (v as PlanetId);
          })
        }
        help="Records the closest the trajectory comes to this planet, and whether it enters the planet's sphere of influence. It does not aim at it: there is no targeting in this tool."
      />
      {ref && target && (
        <ReadoutGrid>
          <Readout
            label={`${PLANET_FACTS[target].name} orbit radius`}
            value={`${sig(ref.targetSma / AU, 4)} AU`}
          />
          <Readout
            label="Hohmann time of flight"
            value={`${ref.hohmannDays.toFixed(0)} days`}
            help="What an impulsive chemical transfer would take. A sail spirals instead and takes considerably longer - but arrives with no propellant spent, which is the trade this tool exists to show."
          />
          <Readout
            label="Launch opportunity spacing"
            value={`${(ref.synodicDays / 365.25).toFixed(2)} years`}
            help="The synodic period: how often the Earth and the target return to the same relative geometry. Since nothing here phases the departure, whether the trajectory arrives NEAR the planet or merely at its orbital radius is set by where the planet happens to be - and this is the interval over which that repeats."
          />
        </ReadoutGrid>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Steering law quick picker
// ---------------------------------------------------------------------------

/**
 * The four steering laws worth choosing between before you know what you are
 * looking for, plus an escape hatch to the full editor.
 *
 * Choosing a law here REPLACES the attitude configuration with a sensible
 * default of that kind. That is the right behaviour for a builder - the
 * alternative, preserving parameters across incompatible rule types, produces
 * configurations nobody chose. The full editor is one click away for anyone
 * who wants to keep tuning.
 */
function QuickAttitude() {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);
  const attitude = config.attitude;

  const defaults: Record<AttitudeRuleKind, AttitudeConfig> = {
    orbitFraction: structuredClone(DEFAULT_ATTITUDE),
    optimalDirection: { kind: 'optimalDirection', direction: 'prograde' },
    sunRelative: { kind: 'sunRelative', cone: 35 * DEG, clock: 0 },
    fixed: { kind: 'fixed', frame: 'rsw', angle1: 0, angle2: 0 },
    timeBased: {
      kind: 'timeBased',
      frame: 'rsw',
      profile: 'triangle',
      initialAngle: 0,
      rate: 1e-4,
      minAngle: -60 * DEG,
      maxAngle: 60 * DEG,
      angle2: 0,
    },
    expression: {
      kind: 'expression',
      frame: 'rsw',
      angle1Expr: '35 * sin(2 * pi * f)',
      angle2Expr: '0',
    },
  };

  return (
    <>
      <SelectField
        label="Law"
        value={attitude.kind}
        options={(Object.keys(ATTITUDE_RULE_LABELS) as AttitudeRuleKind[]).map((k) => ({
          value: k,
          label: ATTITUDE_RULE_LABELS[k],
        }))}
        onChange={(k) =>
          setConfig((c) => {
            if (c.attitude.kind !== k) c.attitude = structuredClone(defaults[k]);
          })
        }
      />

      {attitude.kind === 'optimalDirection' && (
        <SelectField
          label="Maximise thrust along"
          value={attitude.direction}
          options={(Object.keys(THRUST_DIRECTION_LABELS) as ThrustDirection[]).map((d) => ({
            value: d,
            label: THRUST_DIRECTION_LABELS[d],
          }))}
          onChange={(d) =>
            setConfig((c) => {
              if (c.attitude.kind === 'optimalDirection') c.attitude.direction = d;
            })
          }
          help="The rule turns the sail to the orientation that puts the most force along this direction at every instant, which is not the orientation that catches the most sunlight."
        />
      )}

      {attitude.kind === 'sunRelative' && (
        <div className="field-row">
          <NumberField
            label="Cone angle"
            unit="deg"
            value={radToDeg(attitude.cone)}
            min={0}
            max={90}
            step={1}
            decimals={1}
            slider
            onChange={(v) =>
              setConfig((c) => {
                if (c.attitude.kind === 'sunRelative') c.attitude.cone = v * DEG;
              })
            }
            help="0 is Sun-facing (maximum force, no transverse component). 35.26 degrees maximises the transverse component, which is what moves an orbit. 90 is edge-on: no force at all."
          />
          <NumberField
            label="Clock angle"
            unit="deg"
            value={radToDeg(attitude.clock)}
            min={0}
            max={360}
            step={5}
            decimals={1}
            onChange={(v) =>
              setConfig((c) => {
                if (c.attitude.kind === 'sunRelative') c.attitude.clock = v * DEG;
              })
            }
          />
        </div>
      )}

      {attitude.kind === 'orbitFraction' && (
        <div className="scenario-note">
          {attitude.knots.length} schedule knots, phased on{' '}
          {attitude.phaseVariable === 'sunPhase' ? 'the Sun direction' : attitude.phaseVariable}.
          The default is a feathering schedule: edge-on through the half-revolution where the
          sail would push retrograde, near-optimal through the other half.
        </div>
      )}

      {(attitude.kind === 'fixed' ||
        attitude.kind === 'timeBased' ||
        attitude.kind === 'expression') && (
        <div className="scenario-note">
          Configured in the Attitude tab. A constant attitude nets out to almost nothing
          over a closed orbit - it is worth running once to see why.
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Force-model summary
// ---------------------------------------------------------------------------

/**
 * Compact on/off summary of the force model.
 *
 * Read-only by design. Deciding WHICH perturbations to model is a
 * different kind of decision from sizing a sail - it is made once per study,
 * not once per question - so it lives in the Simulation tab and appears here
 * only so that a surprising result has an obvious first thing to check.
 */
function EffectChips() {
  const config = useStore((s) => s.config);
  const { isEarth, isHeliocentric } = centralBodyFacts(config);
  const f = config.forces;

  const chips: Array<{ label: string; on: boolean }> = isHeliocentric
    ? [
        { label: 'Solar gravity', on: f.centralGravity },
        {
          label: `Planets (${config.perturbingPlanets.length})`,
          on: f.planetGravity && config.perturbingPlanets.length > 0,
        },
        { label: 'Earth-Moon gravity', on: f.moonGravity },
        { label: 'Solar sail (SRP)', on: f.solarRadiationPressure },
        { label: 'Eclipse', on: f.eclipse },
      ]
    : [
        { label: 'Central gravity', on: f.centralGravity },
        { label: 'J2', on: f.earthJ2 && isEarth },
        { label: 'J3', on: f.earthJ3 && isEarth },
        { label: isEarth ? 'Moon gravity' : 'Earth gravity', on: f.moonGravity },
        { label: 'Sun gravity', on: f.sunGravity },
        { label: 'Solar sail (SRP)', on: f.solarRadiationPressure },
        { label: 'Eclipse', on: f.eclipse },
        { label: 'Atmospheric drag', on: f.atmosphericDrag && isEarth },
        { label: 'Earth albedo', on: f.earthAlbedo },
        { label: 'Earth infrared', on: f.earthInfrared },
      ];

  return (
    <div className="chip-row">
      {chips.map((c) => (
        <span key={c.label} className={`chip ${c.on ? 'chip-on' : 'chip-off'}`}>
          <span aria-hidden="true">{c.on ? '✓' : '–'}</span> {c.label}
        </span>
      ))}
    </div>
  );
}
