/**
 * Solar Sail panel: geometry, optical model, and derived performance.
 */

import { AU } from '../../core/constants.ts';
import {
  SAIL_FORCE_MODEL_LABELS,
  SOLAR_CONSTANT_OPTIONS,
  type SailForceModel,
  type SolarConstantChoice,
  absorptivity,
  pressure1Au,
  sailPerformance,
  totalMass,
} from '../../core/sail/sail.ts';
import { REFERENCE_SAILS } from '../../sim/analysis.ts';
import { formatAccel, formatPressure, sig } from '../../core/units.ts';
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

export function SailPanel() {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);

  const { sail, spacecraft } = config;
  const mass = totalMass(spacecraft);
  const perf = sailPerformance(sail, spacecraft);
  const abs = absorptivity(sail);
  const coefficientSum = sail.reflectivity + sail.transmissivity;

  return (
    <div className="panel-body">
      <Section title="Sail geometry">
        <NumberField
          label="Sail area"
          unit="m^2"
          value={sail.area}
          min={0.01}
          max={1e6}
          onChange={(v) =>
            setConfig((c) => {
              c.sail.area = v;
            })
          }
          help="Total reflective area presented to the Sun at normal incidence. The model treats the sail as a perfectly flat, rigid plate; billow and wrinkling are not modelled."
        />

        <NumberField
          label="Area-to-mass ratio"
          unit="m^2/kg"
          value={perf.areaToMass}
          min={0.001}
          max={1000}
          onChange={(v) =>
            // Editing the ratio adjusts the AREA and holds the mass, which is
            // the useful direction: mass is usually the fixed constraint.
            setConfig((c) => {
              c.sail.area = Math.max(1e-6, v * mass);
            })
          }
          help="The single most important sail parameter. Editing it here adjusts the sail area and holds the spacecraft mass fixed."
        />

        <ReadoutGrid>
          <Readout
            label="Sail loading"
            value={`${sig(perf.sailLoading, 4)} kg/m^2`}
            help="Mass per unit sail area, the inverse of the area-to-mass ratio. Sail engineers usually quote this."
          />
        </ReadoutGrid>

        <Collapsible title="How this compares with real sails">
          <table className="table">
            <thead>
              <tr>
                <th>Mission</th>
                <th className="num">m^2/kg</th>
              </tr>
            </thead>
            <tbody>
              {REFERENCE_SAILS.map((r) => (
                <tr key={r.name}>
                  <td style={{ fontFamily: 'var(--sans)' }}>
                    {r.name}
                    <div className="small muted" style={{ fontFamily: 'var(--sans)' }}>
                      {r.note}
                    </div>
                  </td>
                  <td className="num">{r.areaToMass.toFixed(3)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontFamily: 'var(--sans)', color: 'var(--accent)' }}>
                  <strong>This configuration</strong>
                </td>
                <td className="num" style={{ color: 'var(--accent)' }}>
                  {perf.areaToMass.toFixed(3)}
                </td>
              </tr>
            </tbody>
          </table>
        </Collapsible>
      </Section>

      <Section title="Radiation pressure force model">
        <SelectField
          label="Force law"
          value={sail.forceModel}
          options={(Object.keys(SAIL_FORCE_MODEL_LABELS) as SailForceModel[]).map((k) => ({
            value: k,
            label: SAIL_FORCE_MODEL_LABELS[k],
          }))}
          onChange={(v) =>
            setConfig((c) => {
              c.sail.forceModel = v;
            })
          }
          help="The ideal law is the familiar 2 P A cos^2(alpha) with an efficiency factor. The optical law resolves each fate of an incident photon separately and produces a transverse force component that the ideal law cannot."
        />

        {sail.forceModel === 'ideal' ? (
          <>
            <NumberField
              label="Optical efficiency"
              unit="-"
              value={sail.efficiency}
              min={0}
              max={1}
              step={0.01}
              slider
              decimals={3}
              onChange={(v) =>
                setConfig((c) => {
                  c.sail.efficiency = v;
                })
              }
              help="Scales the ideal force. Real aluminised sails behave like an efficiency of roughly 0.85 to 0.92 near normal incidence."
            />
            <Equation>{`F = 2 * eta * P * A * cos^2(alpha) * n`}</Equation>
            <Notice kind="info">
              The ideal law produces force along the sail normal only. It cannot represent
              the small in-plane (transverse) force that a real, partly diffuse sail
              generates, so switch to the optical law if that matters to your analysis.
            </Notice>
          </>
        ) : (
          <>
            <NumberField
              label="Reflectivity"
              unit="rho, -"
              value={sail.reflectivity}
              min={0}
              max={1}
              step={0.005}
              slider
              decimals={3}
              onChange={(v) =>
                setConfig((c) => {
                  c.sail.reflectivity = v;
                })
              }
              help="Fraction of incident photons reflected. Aluminium on Kapton achieves about 0.88 across the solar spectrum."
            />
            <NumberField
              label="Specular fraction"
              unit="s, -"
              value={sail.specularFraction}
              min={0}
              max={1}
              step={0.005}
              slider
              decimals={3}
              onChange={(v) =>
                setConfig((c) => {
                  c.sail.specularFraction = v;
                })
              }
              help="Of the reflected light, the fraction reflected specularly (mirror-like) rather than diffusely. A smooth metallised film is about 0.94."
            />
            <NumberField
              label="Transmissivity"
              unit="tau, -"
              value={sail.transmissivity}
              min={0}
              max={1}
              step={0.005}
              slider
              decimals={3}
              onChange={(v) =>
                setConfig((c) => {
                  c.sail.transmissivity = v;
                })
              }
              help="Fraction of photons passing straight through the film. Transmitted photons carry their momentum with them and exert no force, so this is pure loss. Opaque sails are 0."
            />

            <ReadoutGrid>
              <Readout
                label="Absorptivity (derived)"
                value={sig(abs, 4)}
                help="Computed as 1 - reflectivity - transmissivity. Absorbed energy is re-radiated thermally from both faces, which produces the emission term in the force law."
              />
            </ReadoutGrid>

            {coefficientSum > 1 + 1e-9 && (
              <Notice kind="error" title="Optical coefficients are over-specified">
                Reflectivity plus transmissivity is {sig(coefficientSum, 4)}, which exceeds
                1. Absorptivity has been clamped to zero, so the force law no longer
                conserves photon accounting. Reduce one of the two.
              </Notice>
            )}

            <Collapsible title="Thermal emission coefficients">
              <div className="field-row">
                <NumberField
                  label="Front emissivity"
                  unit="eps_f, -"
                  value={sail.emissivityFront}
                  min={0}
                  max={1}
                  step={0.01}
                  decimals={3}
                  onChange={(v) =>
                    setConfig((c) => {
                      c.sail.emissivityFront = v;
                    })
                  }
                  help="Thermal emissivity of the reflective (Sun-facing) surface. A polished metal front is low, around 0.05."
                />
                <NumberField
                  label="Back emissivity"
                  unit="eps_b, -"
                  value={sail.emissivityBack}
                  min={0}
                  max={1}
                  step={0.01}
                  decimals={3}
                  onChange={(v) =>
                    setConfig((c) => {
                      c.sail.emissivityBack = v;
                    })
                  }
                  help="Thermal emissivity of the back surface. A bare polymer or chromium-coated back is high, around 0.55, which is deliberate: emitting preferentially from the back produces a small net forward thrust."
                />
              </div>
              <div className="field-row">
                <NumberField
                  label="Front non-Lambertian coefficient"
                  unit="B_f, -"
                  value={sail.lambertianFront}
                  min={0}
                  max={1}
                  step={0.01}
                  decimals={3}
                  onChange={(v) =>
                    setConfig((c) => {
                      c.sail.lambertianFront = v;
                    })
                  }
                  help="Describes how far the diffuse emission departs from a perfect Lambertian distribution. 2/3 is exactly Lambertian."
                />
                <NumberField
                  label="Back non-Lambertian coefficient"
                  unit="B_b, -"
                  value={sail.lambertianBack}
                  min={0}
                  max={1}
                  step={0.01}
                  decimals={3}
                  onChange={(v) =>
                    setConfig((c) => {
                      c.sail.lambertianBack = v;
                    })
                  }
                />
              </div>
              <Notice kind="info">
                The defaults are the standard aluminium-on-Kapton reference values used
                throughout the solar-sail literature (rho = 0.88, s = 0.94, eps_f = 0.05,
                eps_b = 0.55, B_f = 0.79, B_b = 0.55), which give a normal-incidence force
                coefficient of about 1.83 rather than the ideal 2.0.
              </Notice>
            </Collapsible>

            <Collapsible title="Force law equations">
              <Equation>{`Let  u = Sun -> spacecraft unit vector
     n = sail normal, cos(alpha) = u . n >= 0
     t = in-plane unit vector along the component of u
         perpendicular to n
     a = 1 - rho - tau      (absorptivity)

Normal component:
  F_n = P A cos(alpha) [ (1 + rho s - tau) cos(alpha)
                         + B_f rho (1 - s)
                         + a (eps_f B_f - eps_b B_b)
                             / (eps_f + eps_b) ]

Transverse component:
  F_t = P A cos(alpha) sin(alpha) (1 - rho s - tau)

Total:
  F = F_n n + F_t t

Ideal check (rho = 1, s = 1, tau = 0):
  F_n = 2 P A cos^2(alpha),  F_t = 0`}</Equation>
              <div className="doc-prose">
                <p>
                  Reference: McInnes, <em>Solar Sailing: Technology, Dynamics and Mission
                  Applications</em> (1999), eq. 2.51, extended with a transmission term.
                </p>
              </div>
            </Collapsible>
          </>
        )}
      </Section>

      <Section title="Solar radiation">
        <SelectField
          label="Solar irradiance at 1 AU"
          value={sail.solarConstant}
          options={(Object.keys(SOLAR_CONSTANT_OPTIONS) as SolarConstantChoice[]).map((k) => ({
            value: k,
            label: SOLAR_CONSTANT_OPTIONS[k].label,
          }))}
          onChange={(v) =>
            setConfig((c) => {
              c.sail.solarConstant = v;
            })
          }
          help="1368 W/m^2 is the classical value used throughout the solar-sailing literature and reproduces the canonical P0 = 4.56 uN/m^2. 1361 W/m^2 is the modern measured total solar irradiance. The difference is 0.5%."
        />

        <Equation>{`P(r) = P0 (1 AU / r)^2 ,   P0 = W0 / c`}</Equation>

        <ReadoutGrid>
          <Readout
            label="Pressure at 1 AU"
            value={formatPressure(pressure1Au(sail))}
            emphasis
          />
          <Readout
            label="Solar constant used"
            value={`${SOLAR_CONSTANT_OPTIONS[sail.solarConstant].irradiance} W/m^2`}
          />
          <Readout label="1 AU reference" value={`${(AU / 1e9).toFixed(3)}e9 m`} />
        </ReadoutGrid>
      </Section>

      <Section
        title="Derived performance"
        subtitle="These are THEORETICAL figures for a Sun-facing sail at 1 AU. What the sail actually achieves in orbit is in the Results tab, and is normally much smaller."
      >
        <ReadoutGrid>
          <Readout
            label="Normal-incidence force coefficient"
            value={sig(perf.forceCoefficient, 4)}
            help="The dimensionless k in F = k P A when the sail faces the Sun squarely. Exactly 2 for a perfect reflector; less for any real sail."
          />
          <Readout
            label="Force at 1 AU, Sun-facing"
            value={`${sig(perf.force1Au * 1e3, 4)} mN`}
          />
          <Readout
            label="Characteristic acceleration"
            value={formatAccel(perf.characteristicAcceleration)}
            emphasis
            help="The standard solar-sail figure of merit: acceleration of a Sun-facing sail at 1 AU. It is an upper bound on what the sail can deliver, achieved only at normal incidence in full sunlight."
          />
          <Readout
            label="Lightness number (beta)"
            value={sig(perf.lightnessNumber, 4)}
            help="Ratio of the characteristic sail acceleration to solar gravity at 1 AU. beta = 1 exactly cancels solar gravity. Chiefly relevant to interplanetary sailing, shown here for context."
          />
        </ReadoutGrid>

        {perf.characteristicAcceleration < 1e-6 && (
          <Notice kind="warning" title="Very low area-to-mass ratio">
            The characteristic acceleration is{' '}
            {formatAccel(perf.characteristicAcceleration)}. Solar-sail effects will be
            negligible compared with orbital perturbations such as J2, and probably
            indistinguishable from numerical noise over short runs.
          </Notice>
        )}
        {perf.areaToMass > 50 && (
          <Notice kind="warning" title="Beyond demonstrated technology">
            An area-to-mass ratio of {perf.areaToMass.toFixed(1)} m^2/kg is far beyond any
            sail yet built. Results remain physically consistent but should be read as a
            physics extrapolation, not an engineering projection.
          </Notice>
        )}
      </Section>
    </div>
  );
}
