/**
 * Results panel: run summary, feasibility report, events, and export.
 *
 * The organising principle of this panel is spec S14/S31: the THEORETICAL
 * sail figures and the SIMULATED orbital outcome are shown in separate,
 * explicitly labelled blocks, with the ratio between them called out. The
 * tool exists to make that gap visible, so it is never collapsed into a single
 * headline number.
 */

import { useMemo } from 'react';
import { AU, MOON_SOI_RADIUS, RAD, SEC_PER_DAY } from '../../core/constants.ts';
import { PLANET_FACTS } from '../../core/environment/planets.ts';
import { transferReference } from '../../sim/scenarios.ts';
import {
  formatAccel,
  formatDuration,
  formatLength,
  formatPressure,
  formatVelocity,
  sig,
} from '../../core/units.ts';
import { feasibilityReport } from '../../sim/analysis.ts';
import {
  downloadText,
  slugify,
  trajectoryToCsv,
} from '../../sim/exportData.ts';
import { useStore } from '../../state/store.ts';
import {
  Collapsible,
  EmptyState,
  Notice,
  Readout,
  ReadoutGrid,
  Section,
} from '../widgets/Controls.tsx';

const TERMINATION_TEXT: Record<string, { label: string; kind: 'info' | 'warning' | 'error' | 'success' }> = {
  completed: { label: 'Completed the full duration', kind: 'success' },
  impact: { label: 'Stopped: impact or re-entry', kind: 'error' },
  escape: { label: 'Stopped: escape trajectory', kind: 'warning' },
  numericalFailure: { label: 'Stopped: numerical failure', kind: 'error' },
  maxSamples: { label: 'Stopped: sample limit reached', kind: 'warning' },
  cancelled: { label: 'Cancelled by the user', kind: 'warning' },
};

export function ResultsPanel() {
  const result = useStore((s) => s.result);
  const comparisons = useStore((s) => s.comparisons);
  const storeComparison = useStore((s) => s.storeComparison);
  const removeComparison = useStore((s) => s.removeComparison);
  const clearComparisons = useStore((s) => s.clearComparisons);

  const report = useMemo(
    () => (result ? feasibilityReport(result, result.config.sail, result.config.spacecraft) : null),
    [result],
  );

  if (!result || !report) {
    return (
      <div className="panel-body">
        <EmptyState title="No results yet">
          Press <strong>Run</strong> to propagate the current configuration. The trajectory
          is integrated to completion first, then played back, so all plots and figures
          appear as soon as the run finishes.
        </EmptyState>
      </div>
    );
  }

  const { summary } = result;
  const term = TERMINATION_TEXT[summary.termination] ?? {
    label: summary.termination,
    kind: 'info' as const,
  };
  const isEarth = result.config.centralBody === 'earth';
  const isHeliocentric = result.config.centralBody === 'sun';
  const target = result.config.targetBody;
  const targetFacts = target ? PLANET_FACTS[target] : null;
  const reachedTargetOrbit =
    targetFacts && target
      ? summary.maxSolarDistance >= transferReference(target).targetSma * 0.98 &&
        summary.minSolarDistance <= transferReference(target).targetSma * 1.02
      : false;

  return (
    <div className="panel-body">
      <Section title="Run summary">
        <Notice kind={term.kind}>{term.label}</Notice>
        <ReadoutGrid>
          <Readout label="Mission elapsed" value={formatDuration(summary.finalTime)} />
          <Readout
            label="Integration steps"
            value={summary.steps.toLocaleString()}
          />
          <Readout
            label="Acceleration evaluations"
            value={summary.evaluations.toLocaleString()}
          />
          <Readout
            label="Wall-clock time"
            value={`${summary.wallClockMs.toFixed(0)} ms`}
          />
          {result.config.integration.integrator === 'rkf45' && (
            <>
              <Readout
                label="Rejected steps"
                value={summary.rejectedSteps.toLocaleString()}
                help="Steps whose error estimate exceeded the tolerance and were retried with a smaller step. A few percent is healthy; a large fraction means the tolerance is too tight for the dynamics."
              />
              <Readout
                label="Step range used"
                value={`${sig(summary.minStep, 3)} to ${sig(summary.maxStep, 3)} s`}
              />
            </>
          )}
          <Readout label="Samples recorded" value={result.samples.length.toLocaleString()} />
        </ReadoutGrid>
      </Section>

      {/* ------------------ Theory vs achieved ------------------ */}
      <Section
        title="Sail performance: theory"
        subtitle="Upper bounds for a Sun-facing sail at 1 AU. These do not depend on the orbit at all."
      >
        <ReadoutGrid>
          <Readout label="Area-to-mass ratio" value={`${sig(report.areaToMass, 4)} m^2/kg`} />
          <Readout
            label="Characteristic acceleration"
            value={formatAccel(report.characteristicAcceleration)}
            emphasis
          />
          <Readout label="Force coefficient at normal incidence" value={sig(report.forceCoefficient, 4)} />
          <Readout label="Pressure at mission distance" value={formatPressure(report.pressureAtMission)} />
          <Readout label="Lightness number" value={sig(report.lightnessNumber, 4)} />
        </ReadoutGrid>
      </Section>

      <Section
        title="Sail performance: achieved"
        subtitle="What the sail actually delivered along this trajectory, after incidence angle, Sun geometry and eclipse."
      >
        <ReadoutGrid>
          <Readout
            label="Mean sail acceleration"
            value={formatAccel(report.meanAchievedAccel)}
            emphasis
          />
          <Readout
            label="Fraction of characteristic"
            value={`${(report.dutyFactor * 100).toFixed(1)} %`}
            kind={report.dutyFactor > 0.5 ? 'good' : report.dutyFactor > 0.25 ? 'neutral' : 'bad'}
            help="Mean achieved acceleration divided by the characteristic acceleration. This single number is everything that orbit geometry, steering and eclipse take away from the brochure figure."
            emphasis
          />
          <Readout
            label="Time in eclipse"
            value={`${(report.eclipseFraction * 100).toFixed(1)} %`}
            kind={report.eclipseFraction > 0.3 ? 'bad' : 'neutral'}
          />
          <Readout
            label="Impulse budget"
            value={formatVelocity(report.deltaVEquivalent)}
            help="The integral of the sail acceleration MAGNITUDE over the run. It counts force in every direction regardless of whether it was useful, so it is an upper bound on achievable delta-v, NOT a manoeuvre delta-v. The realised orbital change is below."
          />
          {report.dragDeltaV !== null && (
            <>
              <Readout
                label="Drag impulse removed"
                value={formatVelocity(report.dragDeltaV)}
                kind={report.dragToSailRatio !== null && report.dragToSailRatio > 1 ? 'bad' : 'neutral'}
                help="The integral of the drag deceleration over the run, on the same footing as the sail impulse above. Unlike the sail impulse it is not an upper bound on anything - every metre per second of it came straight out of the orbit."
              />
              <Readout
                label="Drag against sail"
                value={
                  report.dragToSailRatio !== null
                    ? `${sig(report.dragToSailRatio, 3)} : 1`
                    : 'n/a'
                }
                emphasis
                kind={
                  report.dragToSailRatio === null
                    ? 'neutral'
                    : report.dragToSailRatio > 1
                      ? 'bad'
                      : report.dragToSailRatio > 0.2
                        ? 'neutral'
                        : 'good'
                }
                help="Drag impulse divided by sail impulse. Above 1 the atmosphere is taking more momentum than the sail supplies, and no steering law changes that - only a higher orbit or a smaller sail-to-mass ratio will."
              />
            </>
          )}
        </ReadoutGrid>

        {report.dragToSailRatio !== null && report.dragToSailRatio > 1 && (
          <Notice kind="warning" title="The atmosphere is winning">
            Drag removed {sig(report.dragToSailRatio, 3)} times the impulse the sail
            supplied. This is the honest answer for a large sail at this altitude, and it
            is why a sail is a far better deorbit device than an orbit-raising one in low
            Earth orbit. Compare steering laws higher up, or switch drag off in the
            Simulation panel to isolate the sail's own behaviour.
          </Notice>
        )}

        <Notice kind="info" title="Why these two blocks differ">
          The characteristic acceleration assumes the sail faces the Sun squarely in full
          sunlight. In a planet-centred orbit the incidence angle varies continuously, the
          steering law deliberately gives up force to point it usefully, and the spacecraft
          spends part of every revolution in shadow. Reporting only the first number would
          overstate this configuration by a factor of{' '}
          {report.dutyFactor > 0 ? (1 / report.dutyFactor).toFixed(1) : '-'}.
        </Notice>
      </Section>

      {isHeliocentric && (
        <Section
          title="Interplanetary outcome"
          subtitle="Where the trajectory actually went. Nothing here was aimed: there is no departure hyperbola, no launch-window search and no arrival manoeuvre in this model."
        >
          <ReadoutGrid>
            <Readout
              label="Solar distance range"
              value={`${sig(summary.minSolarDistance / AU, 3)} - ${sig(summary.maxSolarDistance / AU, 3)} AU`}
              emphasis
            />
            <Readout
              label="Final specific energy"
              value={`${sig(summary.finalEnergy / 1e6, 4)} MJ/kg`}
              kind={summary.escaped ? 'good' : 'neutral'}
              help="Negative is bound to the Sun, positive is on an escape trajectory. This is the number the escape scenario exists to move across zero."
            />
            {targetFacts && (
              <>
                <Readout
                  label={`Closest approach to ${targetFacts.name}`}
                  value={
                    Number.isFinite(summary.minTargetDistance)
                      ? `${sig(summary.minTargetDistance / AU, 3)} AU`
                      : 'not tracked'
                  }
                  emphasis
                  kind={summary.enteredTargetSoi ? 'good' : 'neutral'}
                />
                <Readout
                  label={`Reached ${targetFacts.name} orbital radius`}
                  value={reachedTargetOrbit ? 'yes' : 'no'}
                  kind={reachedTargetOrbit ? 'good' : 'bad'}
                  help="Whether the trajectory ever crossed the target's heliocentric distance. This is a completely different question from whether it came near the planet, and a sail can do the first without doing the second."
                />
                <Readout
                  label={`Entered ${targetFacts.name} sphere of influence`}
                  value={summary.enteredTargetSoi ? 'yes' : 'no'}
                  kind={summary.enteredTargetSoi ? 'good' : 'neutral'}
                  help={`The SOI radius is ${(targetFacts.soiRadius / 1e9).toFixed(2)} million km. Inside it the heliocentric two-body picture this run integrates is no longer the right one, and the result should be treated as "arrived in the neighbourhood" rather than as an arrival trajectory.`}
                />
              </>
            )}
          </ReadoutGrid>

          {targetFacts && reachedTargetOrbit && !summary.enteredTargetSoi && (
            <Notice kind="info" title={`Reached ${targetFacts.name}'s orbit, not ${targetFacts.name}`}>
              The sail got the spacecraft to the right heliocentric distance and the planet
              was somewhere else at the time. That gap is exactly what a launch window
              closes, and nothing in this model phases the departure - the epoch and the
              spiral rate decide where the planet happens to be on arrival. The Mission
              panel reports the synodic period, which is how often the opportunity comes
              round.
            </Notice>
          )}

          {summary.enteredTargetSoi && (
            <Notice kind="warning" title="Inside the sphere of influence">
              The trajectory entered {targetFacts?.name}&apos;s sphere of influence, where a
              heliocentric two-body integration with the planet as a perturbation stops
              being the right formulation. The approach geometry here is indicative of an
              encounter, not a capture solution - there is no patched-conic switch and no
              arrival manoeuvre in this model.
            </Notice>
          )}

          {summary.escaped && (
            <Notice kind="success" title="Solar escape">
              The final state has positive specific orbital energy with respect to the Sun.
              With no propellant expended, that is the whole solar-sail argument in one
              number.
            </Notice>
          )}
        </Section>
      )}

      {/* ------------------ Realised orbital change ------------------ */}
      <Section
        title="Realised orbital change"
        subtitle="Computed from REVOLUTION-AVERAGED (mean) elements. Osculating elements swing by far more than the sail effect under J2, so differencing them would be meaningless."
      >
        {report.mean.valid ? (
          <>
            <ReadoutGrid>
              <Readout
                label="Change in mean semi-major axis"
                value={report.deltaSma !== null ? formatLength(report.deltaSma) : 'unavailable'}
                emphasis
                kind={
                  report.deltaSma === null
                    ? undefined
                    : report.deltaSma > 0
                      ? 'good'
                      : report.deltaSma < 0
                        ? 'bad'
                        : 'neutral'
                }
              />
              <Readout
                label="Rate"
                value={
                  report.smaRatePerDay !== null
                    ? `${sig(report.smaRatePerDay, 4)} m/day`
                    : 'unavailable'
                }
              />
              <Readout
                label="Change in mean eccentricity"
                value={report.deltaEcc !== null ? report.deltaEcc.toExponential(3) : 'unavailable'}
              />
              <Readout
                label="Change in mean inclination"
                value={
                  report.deltaInc !== null
                    ? `${(report.deltaInc * RAD * 3600).toFixed(2)} arcsec`
                    : 'unavailable'
                }
              />
              <Readout
                label="Averaging window"
                value={formatDuration(report.mean.window)}
                help="One orbital period. This removes the J2 short-period terms and leaves the secular drift."
              />
              <Readout
                label="Resolution floor"
                value={`+/- ${formatLength(report.smaResolution)}`}
                help="Revolution averaging suppresses the J2 oscillation by about three orders of magnitude but not perfectly, because the averaging window is the median osculating period while the true oscillation period drifts slightly. A reported change smaller than a few times this figure is indistinguishable from averaging residue. Estimated as 0.1% of the osculating peak-to-peak."
                kind={
                  report.deltaSma !== null &&
                  Math.abs(report.deltaSma) < 3 * report.smaResolution
                    ? 'bad'
                    : 'neutral'
                }
              />
            </ReadoutGrid>

            {report.equivalentHohmannDeltaV !== null && (
              <>
                <ReadoutGrid>
                  <Readout
                    label="Equivalent impulsive delta-v"
                    value={formatVelocity(report.equivalentHohmannDeltaV)}
                    help="The two-burn Hohmann delta-v that would produce the same change in semi-major axis. A yardstick for interpreting the result, NOT something the sail performed."
                  />
                  {report.impulseEfficiency === null && report.dragToSailRatio !== null && (
                    <Readout
                      label="Useful fraction of impulse budget"
                      value="not attributable"
                      help="This ratio only means something when the sail is the only non-gravitational force acting. Drag is contributing a significant share of the change in semi-major axis here, so dividing that change by the SAIL's impulse would describe the atmosphere, not the steering law. Switch drag off in the Simulation panel to measure the steering law on its own."
                    />
                  )}
                  {report.impulseEfficiency !== null && (
                    <Readout
                      label="Useful fraction of impulse budget"
                      value={`${(report.impulseEfficiency * 100).toFixed(1)} %`}
                      help="Equivalent Hohmann delta-v divided by the total impulse budget. A high value means the steering law pointed the force where it did useful work; a low value means most of the force went into directions that cancelled out."
                      kind={report.impulseEfficiency > 0.5 ? 'good' : 'neutral'}
                    />
                  )}
                </ReadoutGrid>
              </>
            )}
          </>
        ) : (
          <Notice kind="info" title="Mean elements unavailable">
            {report.mean.note ??
              'This trajectory is not a bound, multi-revolution orbit, so revolution averaging does not apply.'}{' '}
            Read the osculating element plots directly instead.
          </Notice>
        )}

        <Collapsible title="Osculating elements, first and last sample">
          <table className="table">
            <thead>
              <tr>
                <th>Element</th>
                <th className="num">Initial</th>
                <th className="num">Final</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Semi-major axis (km)</td>
                <td className="num">{(summary.initialSma / 1000).toFixed(3)}</td>
                <td className="num">{(summary.finalSma / 1000).toFixed(3)}</td>
              </tr>
              <tr>
                <td>Eccentricity</td>
                <td className="num">{summary.initialEcc.toFixed(6)}</td>
                <td className="num">{summary.finalEcc.toFixed(6)}</td>
              </tr>
              <tr>
                <td>Inclination (deg)</td>
                <td className="num">{(summary.initialInc * RAD).toFixed(4)}</td>
                <td className="num">{(summary.finalInc * RAD).toFixed(4)}</td>
              </tr>
              <tr>
                <td>Periapsis (km)</td>
                <td className="num">{(summary.initialPeriapsis / 1000).toFixed(2)}</td>
                <td className="num">{(summary.finalPeriapsis / 1000).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Apoapsis (km)</td>
                <td className="num">
                  {Number.isFinite(summary.initialApoapsis)
                    ? (summary.initialApoapsis / 1000).toFixed(2)
                    : 'inf'}
                </td>
                <td className="num">
                  {Number.isFinite(summary.finalApoapsis)
                    ? (summary.finalApoapsis / 1000).toFixed(2)
                    : 'inf'}
                </td>
              </tr>
              <tr>
                <td>Specific energy (J/kg)</td>
                <td className="num">{summary.initialEnergy.toFixed(1)}</td>
                <td className="num">{summary.finalEnergy.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
          <div className="small muted">
            These are instantaneous two-body elements of the state vector. Under J2 they
            oscillate strongly within every revolution, so a difference between two single
            samples is dominated by where in that cycle each sample happened to fall.
          </div>
        </Collapsible>
      </Section>

      {/* ------------------ Milestones ------------------ */}
      <Section
        title="Orbital change over time"
        subtitle="Mean semi-major axis change measured from the start of the run."
      >
        <table className="table">
          <thead>
            <tr>
              <th>After</th>
              <th className="num">Mean sma change</th>
              <th className="num">Mean ecc change</th>
            </tr>
          </thead>
          <tbody>
            {report.milestones.map((m) => (
              <tr key={m.label}>
                <td>{m.label}</td>
                <td className="num">
                  {!m.covered ? (
                    <span className="muted">not simulated</span>
                  ) : m.deltaSma === null ? (
                    <span className="muted">n/a</span>
                  ) : (
                    formatLength(m.deltaSma)
                  )}
                </td>
                <td className="num">
                  {!m.covered ? (
                    <span className="muted">-</span>
                  ) : m.deltaEcc === null ? (
                    <span className="muted">n/a</span>
                  ) : (
                    m.deltaEcc.toExponential(2)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="small muted">
          Milestones beyond the simulated duration are shown as "not simulated" rather than
          extrapolated. Solar-sail orbit evolution is not linear in time - the Sun geometry
          changes through the year - so extrapolating these would be misleading.
        </div>
      </Section>

      {/* ------------------ Extremes / lunar ------------------ */}
      <Section title="Trajectory extremes">
        <ReadoutGrid>
          <Readout label="Minimum altitude" value={formatLength(summary.minAltitude)} />
          <Readout label="Maximum altitude" value={formatLength(summary.maxAltitude)} />
          <Readout
            label="Escape trajectory at end"
            value={summary.escaped ? 'Yes' : 'No'}
            kind={summary.escaped ? 'good' : 'neutral'}
            help="Whether the final specific orbital energy with respect to the central body is positive."
          />
        </ReadoutGrid>
      </Section>

      {/* Lunar encounter figures are meaningless heliocentrically: the Moon is
          simply never near, and reporting a "closest lunar approach" of 0.1 AU
          invites reading it as a result. */}
      {!isHeliocentric && (result.config.forces.moonGravity || !isEarth) && (
        <Section title="Lunar encounter">
          <ReadoutGrid>
            <Readout
              label="Closest lunar approach"
              value={
                Number.isFinite(summary.minMoonDistance)
                  ? formatLength(summary.minMoonDistance)
                  : 'not computed'
              }
              emphasis
            />
            <Readout
              label="Time of closest approach"
              value={`day ${(summary.minMoonDistanceTime / SEC_PER_DAY).toFixed(3)}`}
            />
            <Readout
              label="Lunar-relative speed at closest"
              value={formatVelocity(summary.moonRelativeSpeedAtClosest)}
            />
            <Readout
              label="Entered lunar sphere of influence"
              value={summary.enteredLunarSoi ? 'Yes' : 'No'}
              help={`The lunar sphere of influence has a radius of about ${(MOON_SOI_RADIUS / 1000).toFixed(0)} km.`}
              kind={summary.enteredLunarSoi ? 'good' : 'neutral'}
            />
          </ReadoutGrid>

          {summary.boundToMoonAtEnd ? (
            <Notice kind="success" title="Negative lunar-relative energy at the final state">
              The spacecraft ends inside the lunar sphere of influence with negative
              two-body energy relative to the Moon, so its osculating lunar orbit closes at
              that instant.
              <div style={{ marginTop: 4 }}>
                This is an <strong>energy test only</strong>. It is not a demonstration of
                a stable or long-lived lunar orbit: no insertion manoeuvre was modelled, the
                Earth tide is a large perturbation at that distance, and the lunar ephemeris
                is a truncated analytic series. Propagate considerably longer before drawing
                any conclusion.
              </div>
            </Notice>
          ) : (
            <Notice kind="warning" title="Lunar orbit insertion not achieved">
              The spacecraft does not end in a bound orbit about the Moon. This is the
              expected outcome: a solar sail of this class cannot supply the roughly
              0.8 km/s of impulsive braking that lunar capture requires, and no such
              manoeuvre is modelled. Use this scenario to study how the sail shifts the
              encounter geometry, not to attempt a capture.
            </Notice>
          )}
        </Section>
      )}

      {/* ------------------ Warnings ------------------ */}
      {report.warnings.length > 0 && (
        <Section title="Warnings and caveats">
          {report.warnings.map((w, i) => (
            <Notice key={i} kind="warning">
              {w}
            </Notice>
          ))}
        </Section>
      )}

      {result.events.length > 0 && (
        <Section title="Events">
          {result.events.map((e, i) => (
            <Notice key={i} kind={e.severity === 'error' ? 'error' : e.severity === 'warning' ? 'warning' : 'info'}>
              {e.message}
            </Notice>
          ))}
        </Section>
      )}

      {/* ------------------ Comparison ------------------ */}
      <Section
        title="Compare runs"
        subtitle="Store the current result, change the attitude law or the sail, run again, and compare side by side."
      >
        <div className="row">
          <button className="btn btn-sm" onClick={() => storeComparison()}>
            Store this run
          </button>
          {comparisons.length > 0 && (
            <button className="btn btn-sm" onClick={clearComparisons}>
              Clear all
            </button>
          )}
        </div>

        {comparisons.length === 0 ? (
          <div className="small muted" style={{ marginTop: 6 }}>
            Nothing stored yet. Stored runs also appear as extra traces on the charts.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Run</th>
                <th className="num">Mean accel</th>
                <th className="num">Impulse</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {comparisons.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontFamily: 'var(--sans)' }}>{c.label}</td>
                  <td className="num">{(c.result.summary.meanSailAccel * 1e6).toFixed(2)}</td>
                  <td className="num">{c.result.summary.deltaVEquivalent.toFixed(2)}</td>
                  <td>
                    <button
                      className="icon-btn"
                      title="Remove"
                      onClick={() => removeComparison(c.id)}
                    >
                      x
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ------------------ Export ------------------ */}
      <Section title="Export">
        <div className="row">
          <button
            className="btn btn-sm"
            onClick={() =>
              downloadText(
                `${slugify(result.config.name)}-trajectory.csv`,
                trajectoryToCsv(result),
                'text/csv',
              )
            }
          >
            Download trajectory (CSV)
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {result.samples.length.toLocaleString()} rows, 46 columns: time, state vector,
          osculating and mean elements, sail attitude and acceleration, radiation pressure,
          illumination and body distances. A commented header records the exact model
          configuration that produced the file.
        </div>
      </Section>
    </div>
  );
}
