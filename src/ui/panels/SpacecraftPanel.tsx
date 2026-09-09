/**
 * Spacecraft panel: mass budget and the initial orbit.
 */

import { DEG, MU_EARTH, MU_MOON, R_EARTH, R_MOON } from '../../core/constants.ts';
import {
  circularSpeed,
  escapeSpeed,
  periodFromSma,
} from '../../core/orbital/elements.ts';
import { totalMass } from '../../core/sail/sail.ts';
import { formatDuration, formatLength, formatVelocity, radToDeg, sig } from '../../core/units.ts';
import { initialStateVector } from '../../sim/propagator.ts';
import { useStore } from '../../state/store.ts';
import {
  Collapsible,
  Notice,
  NumberField,
  Readout,
  ReadoutGrid,
  Section,
} from '../widgets/Controls.tsx';

export function SpacecraftPanel() {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);

  const mass = totalMass(config.spacecraft);
  const isEarth = config.centralBody === 'earth';
  const bodyRadius = isEarth ? R_EARTH : R_MOON;
  const mu = isEarth ? MU_EARTH : MU_MOON;
  const bodyName = isEarth ? 'Earth' : 'Moon';

  // Derived orbit figures, computed from the actual initial state so that a
  // Cartesian initial condition is described just as accurately as an
  // element-based one.
  let derived: {
    radius: number;
    speed: number;
    sma: number;
    period: number;
    vCirc: number;
    vEsc: number;
    apoapsis: number;
    periapsis: number;
  } | null = null;
  try {
    const { r, v } = initialStateVector(config);
    const rMag = Math.hypot(r[0], r[1], r[2]);
    const vMag = Math.hypot(v[0], v[1], v[2]);
    const energy = (vMag * vMag) / 2 - mu / rMag;
    const sma = energy < 0 ? -mu / (2 * energy) : Infinity;
    const hx = r[1] * v[2] - r[2] * v[1];
    const hy = r[2] * v[0] - r[0] * v[2];
    const hz = r[0] * v[1] - r[1] * v[0];
    const h = Math.hypot(hx, hy, hz);
    const p = (h * h) / mu;
    const ecc = Number.isFinite(sma) ? Math.sqrt(Math.max(0, 1 - p / sma)) : 1;
    derived = {
      radius: rMag,
      speed: vMag,
      sma,
      period: Number.isFinite(sma) ? periodFromSma(sma, mu) : Infinity,
      vCirc: circularSpeed(rMag, mu),
      vEsc: escapeSpeed(rMag, mu),
      apoapsis: Number.isFinite(sma) ? sma * (1 + ecc) : Infinity,
      periapsis: Number.isFinite(sma) ? sma * (1 - ecc) : rMag,
    };
  } catch {
    derived = null;
  }

  const isElements = config.initial.mode === 'elements';

  return (
    <div className="panel-body">
      <Section
        title="Mass budget"
        subtitle="Propellant mass is carried for completeness of the budget only. Version 1 has no thruster model, so propellant is never expended and simply adds inert mass."
      >
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
          label="Propellant mass"
          unit="kg"
          value={config.spacecraft.propellantMass}
          min={0}
          max={100000}
          onChange={(v) =>
            setConfig((c) => {
              c.spacecraft.propellantMass = v;
            })
          }
          help="Inert in this version. Included so that a realistic total mass can be entered without distorting the dry-mass figure."
        />
        <ReadoutGrid>
          <Readout label="Total mass" value={`${sig(mass, 6)} kg`} emphasis />
        </ReadoutGrid>
      </Section>

      <Section title="Initial orbit" subtitle={`About the ${bodyName}, in the inertial integration frame.`}>
        {!isElements && (
          <Notice kind="info" title="Cartesian initial state">
            This scenario specifies the initial state as a position and velocity vector
            rather than as orbital elements, because it is a transfer trajectory rather
            than a closed orbit. Switch to element entry below to edit it as an orbit
            instead - doing so will discard the aimed transfer geometry.
            <div style={{ marginTop: 6 }}>
              <button
                className="btn btn-sm"
                onClick={() =>
                  setConfig((c) => {
                    const rMag = derived?.radius ?? bodyRadius + 500e3;
                    c.initial = {
                      mode: 'elements',
                      altitude: Math.max(1000, rMag - bodyRadius),
                      eccentricity: 0,
                      inclination: 28.5 * DEG,
                      raan: 0,
                      argumentOfPeriapsis: 0,
                      trueAnomaly: 0,
                    };
                  })
                }
              >
                Convert to orbital elements
              </button>
            </div>
          </Notice>
        )}

        {isElements && config.initial.mode === 'elements' && (
          <>
            <NumberField
              label="Periapsis altitude"
              unit="km"
              value={config.initial.altitude / 1000}
              min={50}
              max={500000}
              onChange={(v) =>
                setConfig((c) => {
                  if (c.initial.mode === 'elements') c.initial.altitude = v * 1000;
                })
              }
              help={`Height of the lowest point of the orbit above the ${bodyName} reference radius (${(bodyRadius / 1000).toFixed(0)} km). For a circular orbit this is simply the orbit altitude.`}
              message={
                isEarth && config.initial.altitude < 400e3
                  ? 'Below about 400 km atmospheric drag exceeds the sail force by orders of magnitude, and drag is not modelled.'
                  : undefined
              }
            />
            <NumberField
              label="Eccentricity"
              unit="-"
              value={config.initial.eccentricity}
              min={0}
              max={0.99}
              step={0.005}
              slider
              decimals={4}
              onChange={(v) =>
                setConfig((c) => {
                  if (c.initial.mode === 'elements') c.initial.eccentricity = v;
                })
              }
              help="0 is circular. Above about 0.3 a fixed timestep struggles to cover both periapsis and apoapsis - use the adaptive integrator."
              message={
                config.initial.eccentricity > 0.3 && config.integration.integrator === 'rk4'
                  ? 'Consider the adaptive integrator at this eccentricity, or reduce the timestep.'
                  : undefined
              }
            />
            <div className="field-row">
              <NumberField
                label="Inclination"
                unit="deg"
                value={radToDeg(config.initial.inclination)}
                min={0}
                max={180}
                step={0.5}
                decimals={2}
                onChange={(v) =>
                  setConfig((c) => {
                    if (c.initial.mode === 'elements') c.initial.inclination = v * DEG;
                  })
                }
                help="Angle between the orbit plane and the equator. Above 90 degrees the orbit is retrograde."
              />
              <NumberField
                label="RAAN"
                unit="deg"
                value={radToDeg(config.initial.raan)}
                min={0}
                max={360}
                step={1}
                decimals={2}
                onChange={(v) =>
                  setConfig((c) => {
                    if (c.initial.mode === 'elements') c.initial.raan = v * DEG;
                  })
                }
                help="Right ascension of the ascending node. Together with the epoch this fixes the orbit plane relative to the Sun, which is what determines the beta angle and therefore how much of the orbit is eclipsed."
              />
            </div>
            <div className="field-row">
              <NumberField
                label="Argument of periapsis"
                unit="deg"
                value={radToDeg(config.initial.argumentOfPeriapsis)}
                min={0}
                max={360}
                step={1}
                decimals={2}
                onChange={(v) =>
                  setConfig((c) => {
                    if (c.initial.mode === 'elements')
                      c.initial.argumentOfPeriapsis = v * DEG;
                  })
                }
                help="Angle from the ascending node to periapsis, measured in the orbit plane."
              />
              <NumberField
                label="True anomaly"
                unit="deg"
                value={radToDeg(config.initial.trueAnomaly)}
                min={0}
                max={360}
                step={1}
                decimals={2}
                onChange={(v) =>
                  setConfig((c) => {
                    if (c.initial.mode === 'elements') c.initial.trueAnomaly = v * DEG;
                  })
                }
                help="Starting position along the orbit, measured from periapsis."
              />
            </div>
          </>
        )}
      </Section>

      {derived && (
        <Section title="Derived initial conditions">
          <ReadoutGrid>
            <Readout label="Radius" value={formatLength(derived.radius)} />
            <Readout
              label="Altitude"
              value={formatLength(derived.radius - bodyRadius)}
            />
            <Readout label="Initial speed" value={formatVelocity(derived.speed)} emphasis />
            <Readout
              label="Circular speed here"
              value={formatVelocity(derived.vCirc)}
              help="Speed required for a circular orbit at this radius. Comparing the two tells you immediately whether the orbit is circular, elliptical or hyperbolic."
            />
            <Readout label="Escape speed here" value={formatVelocity(derived.vEsc)} />
            <Readout label="Semi-major axis" value={formatLength(derived.sma)} />
            <Readout label="Periapsis radius" value={formatLength(derived.periapsis)} />
            <Readout label="Apoapsis radius" value={formatLength(derived.apoapsis)} />
            <Readout
              label="Orbital period"
              value={
                Number.isFinite(derived.period)
                  ? formatDuration(derived.period)
                  : 'unbound trajectory'
              }
            />
          </ReadoutGrid>

          {derived.speed > derived.vEsc && (
            <Notice kind="warning" title="Escape trajectory">
              The initial speed exceeds the local escape speed, so this is an unbound
              trajectory. Mean orbital elements will not be available.
            </Notice>
          )}
        </Section>
      )}

      <Collapsible title="Reference frame details">
        <div className="doc-prose">
          <p>
            The initial elements are interpreted in the{' '}
            <strong>
              {isEarth
                ? 'Earth-centred inertial frame (ECI)'
                : 'Moon-centred inertial frame (MCI)'}
            </strong>
            , with axes aligned to J2000 equatorial: X toward the J2000 vernal equinox, Z
            along the Earth mean rotation axis, Y completing the right-handed set.
          </p>
          <p>
            The MCI frame uses the <em>same axis directions</em> as ECI and differs only
            in origin. Lunar orbital elements expressed here are therefore relative to the
            Earth equator, not to the lunar equator or the ecliptic. This is stated
            explicitly because it is a common source of confusion when comparing against
            published lunar orbit parameters.
          </p>
        </div>
      </Collapsible>
    </div>
  );
}
