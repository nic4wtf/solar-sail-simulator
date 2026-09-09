/**
 * Attitude / control panel.
 *
 * One editor per rule kind. Switching rules builds a fresh default config for
 * the new kind rather than trying to map angles between incompatible
 * parameterisations, which would silently change the meaning of the numbers.
 */

import { DEG, RAD } from '../../core/constants.ts';
import { FRAME_LABELS, type FrameKind } from '../../core/orbital/frames.ts';
import {
  ATTITUDE_RULE_LABELS,
  ATTITUDE_RULE_SUMMARY,
  PHASE_VARIABLE_HELP,
  PHASE_VARIABLE_LABELS,
  THRUST_DIRECTION_LABELS,
  TIME_PROFILE_LABELS,
  type AttitudeConfig,
  type AttitudeRuleKind,
  type OrbitFractionKnot,
  type PhaseVariable,
  type ThrustDirection,
  type TimeProfile,
} from '../../core/attitude/types.ts';
import {
  EXPRESSION_VARIABLES,
  EXPRESSION_VARIABLE_NAMES,
} from '../../core/attitude/rules.ts';
import {
  EXPRESSION_CONSTANTS,
  EXPRESSION_FUNCTIONS,
  validateExpression,
} from '../../core/attitude/expression.ts';
import { optimalIncidenceAngle } from '../../core/attitude/optimal.ts';
import { useStore } from '../../state/store.ts';
import {
  Collapsible,
  Equation,
  Notice,
  NumberField,
  Readout,
  ReadoutGrid,
  Section,
  SelectField,
} from '../widgets/Controls.tsx';

const FRAME_OPTIONS = (Object.keys(FRAME_LABELS) as FrameKind[]).map((k) => ({
  value: k,
  label: FRAME_LABELS[k],
}));

/** Fresh default configuration for each rule kind. */
function defaultForKind(kind: AttitudeRuleKind): AttitudeConfig {
  switch (kind) {
    case 'fixed':
      return { kind: 'fixed', frame: 'rsw', angle1: 35 * DEG, angle2: 0 };
    case 'timeBased':
      return {
        kind: 'timeBased',
        frame: 'rsw',
        profile: 'triangle',
        initialAngle: -35 * DEG,
        // One full sweep of the 70 deg band per day.
        rate: (70 * DEG) / 86400,
        minAngle: -35 * DEG,
        maxAngle: 35 * DEG,
        angle2: 0,
      };
    case 'orbitFraction':
      return {
        kind: 'orbitFraction',
        frame: 'sun',
        phaseVariable: 'sunPhase',
        knots: [
          { fraction: 0.0, angle1: 90 * DEG, angle2: 0 },
          { fraction: 0.45, angle1: 90 * DEG, angle2: 0 },
          { fraction: 0.55, angle1: 35 * DEG, angle2: 0 },
          { fraction: 0.95, angle1: 35 * DEG, angle2: 0 },
        ],
      };
    case 'sunRelative':
      return { kind: 'sunRelative', cone: 35 * DEG, clock: 0 };
    case 'optimalDirection':
      return { kind: 'optimalDirection', direction: 'prograde' };
    case 'expression':
      return {
        kind: 'expression',
        frame: 'sun',
        // Reproduces the feathering schedule as a formula, so the example is
        // both valid and physically meaningful out of the box.
        angle1Expr: 'if(sunPhase - 180, 35, 90)',
        angle2Expr: '0',
      };
  }
}

export function AttitudePanel() {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);
  const attitude = config.attitude;

  const usesFrame = attitude.kind !== 'sunRelative' && attitude.kind !== 'optimalDirection';
  const frame = usesFrame ? attitude.frame : 'sun';
  const isSunFrame = frame === 'sun' || attitude.kind === 'sunRelative';

  // Angle labels depend on the frame, so the UI never shows "pitch" for a
  // cone/clock pair or vice versa.
  const angle1Label = isSunFrame ? 'Cone angle' : 'Primary angle (pitch)';
  const angle2Label = isSunFrame ? 'Clock angle' : 'Secondary angle (yaw)';

  return (
    <div className="panel-body">
      <Section title="Steering law">
        <SelectField
          label="Attitude rule"
          value={attitude.kind}
          options={(Object.keys(ATTITUDE_RULE_LABELS) as AttitudeRuleKind[]).map((k) => ({
            value: k,
            label: ATTITUDE_RULE_LABELS[k],
          }))}
          onChange={(k) =>
            setConfig((c) => {
              c.attitude = defaultForKind(k);
            })
          }
        />
        <div className="scenario-note">{ATTITUDE_RULE_SUMMARY[attitude.kind]}</div>

        <ReadoutGrid>
          <Readout
            label="Reference frame in use"
            value={
              attitude.kind === 'optimalDirection'
                ? 'Sun-relative (solved)'
                : isSunFrame
                  ? 'Sun-relative'
                  : frame.toUpperCase()
            }
            help={
              attitude.kind === 'optimalDirection'
                ? 'The locally optimal law works directly in the plane containing the Sun line and the desired thrust direction.'
                : FRAME_LABELS[frame]
            }
          />
        </ReadoutGrid>
      </Section>

      {/* ---------------- Frame selection ---------------- */}
      {usesFrame && (
        <Section title="Reference frame">
          <SelectField
            label="Angles are measured in"
            value={attitude.frame}
            options={FRAME_OPTIONS}
            onChange={(f) =>
              setConfig((c) => {
                if (
                  c.attitude.kind === 'fixed' ||
                  c.attitude.kind === 'timeBased' ||
                  c.attitude.kind === 'orbitFraction' ||
                  c.attitude.kind === 'expression'
                ) {
                  c.attitude.frame = f;
                }
              })
            }
            help="Both steering angles are zero when the sail normal points along the frame's primary axis: radially outward for RSW, along the velocity for VNB, directly away from the Sun for the Sun frame."
          />
          <Collapsible title="What the angles mean in this frame">
            <div className="doc-prose">
              {frame === 'rsw' && (
                <>
                  <p>
                    <strong>RSW</strong>: R is radially outward, W is the orbit normal, S
                    completes the set in the direction of motion.
                  </p>
                  <p>
                    Zero angles point the sail normal <strong>radially outward</strong>. A
                    positive pitch tilts it toward the direction of motion; yaw tilts it
                    out of the orbit plane.
                  </p>
                </>
              )}
              {frame === 'vnb' && (
                <p>
                  <strong>VNB</strong>: zero angles point the normal along the velocity
                  vector. Because a sail can only push away from the Sun this is often
                  unachievable - watch the reported Sun incidence angle, which will show
                  the sail being flipped.
                </p>
              )}
              {frame === 'sun' && (
                <>
                  <p>
                    <strong>Sun-relative</strong>: the cone angle is measured away from the
                    Sun line, so cone = 0 gives the maximum force (Sun-facing) and cone =
                    90 degrees feathers the sail edge-on for zero force.
                  </p>
                  <p>
                    The clock angle selects the azimuth about the Sun line. Clock = 0 tilts
                    the normal toward the orbit normal; clock = 90 degrees tilts it within
                    the orbit plane.
                  </p>
                </>
              )}
              {frame === 'inertial' && (
                <p>
                  <strong>Inertial</strong>: the angles are a right ascension and
                  declination in the J2000 equatorial frame. The commanded direction is
                  fixed in inertial space and takes no account of where the Sun is, so the
                  sail will feather and flip as the orbit carries it around.
                </p>
              )}
            </div>
          </Collapsible>
        </Section>
      )}

      {/* ---------------- Rule 1: fixed ---------------- */}
      {attitude.kind === 'fixed' && (
        <Section title="Fixed angles">
          <NumberField
            label={angle1Label}
            unit="deg"
            value={attitude.angle1 * RAD}
            min={-180}
            max={180}
            step={1}
            slider
            decimals={2}
            onChange={(v) =>
              setConfig((c) => {
                if (c.attitude.kind === 'fixed') c.attitude.angle1 = v * DEG;
              })
            }
          />
          <NumberField
            label={angle2Label}
            unit="deg"
            value={attitude.angle2 * RAD}
            min={-180}
            max={180}
            step={1}
            slider
            decimals={2}
            onChange={(v) =>
              setConfig((c) => {
                if (c.attitude.kind === 'fixed') c.attitude.angle2 = v * DEG;
              })
            }
          />
          <Notice kind="info">
            A constant attitude rarely produces a large secular orbit change in a
            planet-centred orbit: the along-track component of the sail force is prograde
            for half of each revolution and retrograde for the other half, and the two
            largely cancel. Try the orbit-fraction or locally optimal rules to see the
            difference.
          </Notice>
        </Section>
      )}

      {/* ---------------- Rule 2: time-based ---------------- */}
      {attitude.kind === 'timeBased' && (
        <Section title="Time-based schedule">
          <SelectField
            label="Profile"
            value={attitude.profile}
            options={(Object.keys(TIME_PROFILE_LABELS) as TimeProfile[]).map((k) => ({
              value: k,
              label: TIME_PROFILE_LABELS[k],
            }))}
            onChange={(p) =>
              setConfig((c) => {
                if (c.attitude.kind === 'timeBased') c.attitude.profile = p;
              })
            }
          />
          <Equation>{`angle(t) = initial + rate * t   (clamped to [min, max])`}</Equation>
          <NumberField
            label="Initial angle"
            unit="deg"
            value={attitude.initialAngle * RAD}
            min={-180}
            max={180}
            decimals={2}
            onChange={(v) =>
              setConfig((c) => {
                if (c.attitude.kind === 'timeBased') c.attitude.initialAngle = v * DEG;
              })
            }
          />
          <NumberField
            label="Rate"
            unit="deg/day"
            value={attitude.rate * RAD * 86400}
            min={-3600}
            max={3600}
            decimals={3}
            onChange={(v) =>
              setConfig((c) => {
                if (c.attitude.kind === 'timeBased') c.attitude.rate = (v * DEG) / 86400;
              })
            }
            help="Entered per day for convenience; stored internally in radians per second."
          />
          <div className="field-row">
            <NumberField
              label="Minimum angle"
              unit="deg"
              value={attitude.minAngle * RAD}
              min={-180}
              max={180}
              decimals={2}
              onChange={(v) =>
                setConfig((c) => {
                  if (c.attitude.kind === 'timeBased') c.attitude.minAngle = v * DEG;
                })
              }
            />
            <NumberField
              label="Maximum angle"
              unit="deg"
              value={attitude.maxAngle * RAD}
              min={-180}
              max={180}
              decimals={2}
              onChange={(v) =>
                setConfig((c) => {
                  if (c.attitude.kind === 'timeBased') c.attitude.maxAngle = v * DEG;
                })
              }
            />
          </div>
          <NumberField
            label={`${angle2Label} (held constant)`}
            unit="deg"
            value={attitude.angle2 * RAD}
            min={-180}
            max={180}
            decimals={2}
            onChange={(v) =>
              setConfig((c) => {
                if (c.attitude.kind === 'timeBased') c.attitude.angle2 = v * DEG;
              })
            }
          />
        </Section>
      )}

      {/* ---------------- Rule 3: orbit fraction ---------------- */}
      {attitude.kind === 'orbitFraction' && (
        <Section
          title="Orbit-fraction schedule"
          subtitle="Angles are interpolated linearly between knots and wrap around from the last knot back to the first, so the command is continuous and periodic."
        >
          <SelectField
            label="Orbital phase variable"
            value={attitude.phaseVariable}
            options={(Object.keys(PHASE_VARIABLE_LABELS) as PhaseVariable[]).map((k) => ({
              value: k,
              label: PHASE_VARIABLE_LABELS[k],
            }))}
            onChange={(p) =>
              setConfig((c) => {
                if (c.attitude.kind === 'orbitFraction') c.attitude.phaseVariable = p;
              })
            }
            help={PHASE_VARIABLE_HELP[attitude.phaseVariable]}
          />
          <div className="scenario-note">{PHASE_VARIABLE_HELP[attitude.phaseVariable]}</div>

          <ScheduleEditor
            knots={attitude.knots}
            angle1Label={angle1Label}
            angle2Label={angle2Label}
            onChange={(knots) =>
              setConfig((c) => {
                if (c.attitude.kind === 'orbitFraction') c.attitude.knots = knots;
              })
            }
          />

          {isSunFrame && (
            <Notice kind="info" title="Feathering">
              In the Sun frame a cone angle of 90 degrees turns the sail edge-on to the
              Sun, giving zero projected area and therefore zero force. Alternating
              between a working cone angle and 90 degrees is how a sail produces a
              one-sided, secular orbit change - see the Documentation tab.
            </Notice>
          )}
        </Section>
      )}

      {/* ---------------- Rule 4: Sun-relative ---------------- */}
      {attitude.kind === 'sunRelative' && (
        <Section title="Sun-relative angles">
          <NumberField
            label="Cone angle"
            unit="deg"
            value={attitude.cone * RAD}
            min={0}
            max={90}
            step={1}
            slider
            decimals={2}
            onChange={(v) =>
              setConfig((c) => {
                if (c.attitude.kind === 'sunRelative') c.attitude.cone = v * DEG;
              })
            }
            help="Angle between the sail normal and the Sun line. 0 gives maximum force directly anti-sunward; 90 degrees feathers the sail for zero force."
          />
          <NumberField
            label="Clock angle"
            unit="deg"
            value={attitude.clock * RAD}
            min={-180}
            max={180}
            step={1}
            slider
            decimals={2}
            onChange={(v) =>
              setConfig((c) => {
                if (c.attitude.kind === 'sunRelative') c.attitude.clock = v * DEG;
              })
            }
            help="Azimuth of the tilt about the Sun line. 0 tilts the normal toward the orbit normal; 90 degrees tilts it within the orbit plane."
          />
          <ReadoutGrid>
            <Readout
              label="Force fraction at this cone angle"
              value={`${(Math.cos(attitude.cone) ** 2 * 100).toFixed(1)} %`}
              help="For an ideal sail the force scales as cos^2 of the cone angle. This is the fraction of the maximum available force, before eclipse."
            />
          </ReadoutGrid>
          <Notice kind="info">
            The classic result for solar sailing is that the maximum <em>transverse</em>{' '}
            force occurs at a cone angle of {(optimalIncidenceAngle(Math.PI / 2) * RAD).toFixed(2)}{' '}
            degrees, not at 45 degrees, because the force magnitude falls as
            cos^2(alpha) while its transverse projection grows as sin(alpha).
          </Notice>
        </Section>
      )}

      {/* ---------------- Rule 5: locally optimal ---------------- */}
      {attitude.kind === 'optimalDirection' && (
        <Section title="Locally optimal thrust direction">
          <SelectField
            label="Maximise force along"
            value={attitude.direction}
            options={(Object.keys(THRUST_DIRECTION_LABELS) as ThrustDirection[]).map((k) => ({
              value: k,
              label: THRUST_DIRECTION_LABELS[k],
            }))}
            onChange={(d) =>
              setConfig((c) => {
                if (c.attitude.kind === 'optimalDirection') c.attitude.direction = d;
              })
            }
          />
          <Equation>{`Maximise  cos^2(alpha) cos(theta - alpha)

  theta = angle between the Sun line and the target direction
  alpha = angle between the Sun line and the sail normal

Stationarity condition, solved numerically each step:

  tan(theta - alpha) = 2 tan(alpha)

  theta = 0   ->  alpha = 0
  theta = 90  ->  alpha = 35.26 deg`}</Equation>
          <div className="doc-prose">
            <p>
              This is the standard instantaneous (locally optimal) steering law. It is{' '}
              <strong>not</strong> a globally optimal trajectory: it greedily maximises
              the force along the chosen direction at every instant, with no regard for
              where that leaves the orbit later. It is nonetheless the right reference
              case for "how fast could this sail change this orbit", and in the default
              LEO it outperforms every hand-built schedule in this tool.
            </p>
            <p className="muted">
              Reference: Macdonald &amp; McInnes, "Analytical Control Laws for
              Planet-Centred Solar Sailing", Journal of Guidance, Control, and Dynamics,
              2005.
            </p>
          </div>
        </Section>
      )}

      {/* ---------------- Rule 6: expression ---------------- */}
      {attitude.kind === 'expression' && (
        <ExpressionEditor
          angle1Expr={attitude.angle1Expr}
          angle2Expr={attitude.angle2Expr}
          angle1Label={angle1Label}
          angle2Label={angle2Label}
          onChange={(a1, a2) =>
            setConfig((c) => {
              if (c.attitude.kind === 'expression') {
                c.attitude.angle1Expr = a1;
                c.attitude.angle2Expr = a2;
              }
            })
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule editor
// ---------------------------------------------------------------------------

function ScheduleEditor({
  knots,
  angle1Label,
  angle2Label,
  onChange,
}: {
  knots: OrbitFractionKnot[];
  angle1Label: string;
  angle2Label: string;
  onChange: (knots: OrbitFractionKnot[]) => void;
}) {
  const update = (i: number, patch: Partial<OrbitFractionKnot>) => {
    const next = knots.map((k, j) => (j === i ? { ...k, ...patch } : k));
    onChange(next);
  };

  const sorted = [...knots].sort((a, b) => a.fraction - b.fraction);
  const duplicates = sorted.some(
    (k, i) => i > 0 && Math.abs(k.fraction - sorted[i - 1].fraction) < 1e-9,
  );

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: '26%' }}>Phase</th>
            <th style={{ width: '30%' }}>{angle1Label.split(' ')[0]} (deg)</th>
            <th style={{ width: '30%' }}>{angle2Label.split(' ')[0]} (deg)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {knots.map((k, i) => (
            <tr key={i}>
              <td>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={Number(k.fraction.toFixed(4))}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) update(i, { fraction: Math.min(1, Math.max(0, v)) });
                  }}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="5"
                  value={Number((k.angle1 * RAD).toFixed(2))}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) update(i, { angle1: v * DEG });
                  }}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="5"
                  value={Number((k.angle2 * RAD).toFixed(2))}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) update(i, { angle2: v * DEG });
                  }}
                />
              </td>
              <td>
                <button
                  className="icon-btn"
                  title="Remove this knot"
                  disabled={knots.length <= 1}
                  onClick={() => onChange(knots.filter((_, j) => j !== i))}
                >
                  x
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="table-actions">
        <button
          className="btn btn-sm"
          onClick={() => {
            // Insert at the largest gap, which is where a knot is most useful.
            const s = [...knots].sort((a, b) => a.fraction - b.fraction);
            let bestGap = -1;
            let bestAt = 0.5;
            for (let i = 0; i < s.length; i++) {
              const a = s[i].fraction;
              const b = i + 1 < s.length ? s[i + 1].fraction : s[0].fraction + 1;
              const gap = b - a;
              if (gap > bestGap) {
                bestGap = gap;
                bestAt = (a + b) / 2;
              }
            }
            const at = bestAt % 1;
            onChange([...knots, { fraction: at, angle1: 0, angle2: 0 }]);
          }}
        >
          Add knot
        </button>
        <button
          className="btn btn-sm"
          onClick={() =>
            onChange([
              { fraction: 0.0, angle1: 90 * DEG, angle2: 0 },
              { fraction: 0.45, angle1: 90 * DEG, angle2: 0 },
              { fraction: 0.55, angle1: 35 * DEG, angle2: 0 },
              { fraction: 0.95, angle1: 35 * DEG, angle2: 0 },
            ])
          }
          title="Edge-on through the unfavourable half of the orbit, 35 degrees through the favourable half"
        >
          Feathering preset
        </button>
        <button
          className="btn btn-sm"
          onClick={() =>
            onChange([
              { fraction: 0.0, angle1: 30 * DEG, angle2: 0 },
              { fraction: 0.25, angle1: 10 * DEG, angle2: 0 },
              { fraction: 0.5, angle1: -10 * DEG, angle2: 0 },
              { fraction: 0.75, angle1: -30 * DEG, angle2: 0 },
            ])
          }
          title="The example table from the specification"
        >
          Ramp preset
        </button>
      </div>

      {duplicates && (
        <Notice kind="warning">
          Two knots share the same phase value. The interpolation will jump discontinuously
          there.
        </Notice>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Expression editor
// ---------------------------------------------------------------------------

function ExpressionEditor({
  angle1Expr,
  angle2Expr,
  angle1Label,
  angle2Label,
  onChange,
}: {
  angle1Expr: string;
  angle2Expr: string;
  angle1Label: string;
  angle2Label: string;
  onChange: (a1: string, a2: string) => void;
}) {
  const err1 = validateExpression(angle1Expr, EXPRESSION_VARIABLE_NAMES);
  const err2 = validateExpression(angle2Expr, EXPRESSION_VARIABLE_NAMES);

  return (
    <Section
      title="Custom equation"
      subtitle="Both expressions are evaluated at every integration step and must return an angle in DEGREES."
    >
      <div className="field">
        <label className="field-label">
          <span className="field-label-text">{angle1Label} expression</span>
          <span className="field-unit">deg</span>
        </label>
        <textarea
          className="text-input"
          rows={2}
          value={angle1Expr}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value, angle2Expr)}
        />
        {err1 ? (
          <div className="field-msg field-msg-error">{err1}</div>
        ) : (
          <div className="field-msg field-msg-info">Valid.</div>
        )}
      </div>

      <div className="field">
        <label className="field-label">
          <span className="field-label-text">{angle2Label} expression</span>
          <span className="field-unit">deg</span>
        </label>
        <textarea
          className="text-input"
          rows={2}
          value={angle2Expr}
          spellCheck={false}
          onChange={(e) => onChange(angle1Expr, e.target.value)}
        />
        {err2 ? (
          <div className="field-msg field-msg-error">{err2}</div>
        ) : (
          <div className="field-msg field-msg-info">Valid.</div>
        )}
      </div>

      {(err1 || err2) && (
        <Notice kind="warning" title="Invalid formula falls back to Sun-facing">
          While an expression is invalid the steering law commands a Sun-facing normal and
          the run is flagged as degenerate, rather than failing silently.
        </Notice>
      )}

      <Collapsible title="Available variables" defaultOpen>
        <table className="table">
          <tbody>
            {EXPRESSION_VARIABLES.map((v) => (
              <tr key={v.name}>
                <td style={{ width: '32%', color: 'var(--accent)' }}>{v.name}</td>
                <td style={{ fontFamily: 'var(--sans)' }}>{v.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Collapsible>

      <Collapsible title="Available functions and constants">
        <div className="doc-prose">
          <p>
            <strong>Functions:</strong>{' '}
            <code>{EXPRESSION_FUNCTIONS.join(', ')}</code>
          </p>
          <p>
            <strong>Constants:</strong> <code>{EXPRESSION_CONSTANTS.join(', ')}</code>
          </p>
          <p>
            <strong>Operators:</strong> <code>+ - * / % ^</code> and parentheses.{' '}
            <code>^</code> is exponentiation and is right-associative.
          </p>
          <p>
            <code>if(condition, a, b)</code> returns <code>a</code> when the condition is
            greater than zero, otherwise <code>b</code>. There are no comparison
            operators, so write <code>if(x - 5, ...)</code> to mean "if x &gt; 5".
          </p>
          <p className="muted">
            Expressions are parsed by a small purpose-built parser with a fixed grammar and
            a whitelist of names. They are never passed to <code>eval</code>, so loading a
            configuration file from someone else cannot execute code.
          </p>
        </div>
      </Collapsible>

      <Collapsible title="Examples">
        <div className="doc-prose">
          <p>Feathering schedule (Sun frame, cone angle):</p>
          <Equation>{`if(sunPhase - 180, 35, 90)`}</Equation>
          <p>Smooth sinusoidal cone sweep once per day:</p>
          <Equation>{`35 + 20 * sin(2 * pi * tDays)`}</Equation>
          <p>Pitch proportional to true anomaly (RSW frame):</p>
          <Equation>{`35 * sin(rad(nu))`}</Equation>
          <p>Feather whenever the beta angle is unfavourable:</p>
          <Equation>{`if(abs(betaAngle) - 20, 0, 90)`}</Equation>
        </div>
      </Collapsible>
    </Section>
  );
}
