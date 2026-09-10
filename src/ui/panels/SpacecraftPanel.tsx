/**
 * Spacecraft panel: mass budget, drag properties, and the initial orbit in
 * full.
 *
 * The Mission panel now carries the common case (dry mass, sail area, the
 * orbital elements). What stays here is everything you would change to make
 * the SAME question more precise: the propellant line of the mass budget, the
 * aerodynamic properties, and the frame documentation.
 */

import { DEFAULT_SPACECRAFT, totalMass } from '../../core/sail/sail.ts';
import { ballisticCoefficient } from '../../core/forces/drag.ts';
import { atmosphericDensity } from '../../core/environment/atmosphere.ts';
import { formatDuration, formatLength, formatVelocity, sig } from '../../core/units.ts';
import { useStore } from '../../state/store.ts';
import {
  Collapsible,
  Notice,
  NumberField,
  Readout,
  ReadoutGrid,
  Section,
} from '../widgets/Controls.tsx';
import { InitialOrbitFields } from './blocks/InitialOrbitFields.tsx';
import { centralBodyFacts, deriveInitialOrbit } from './blocks/orbitDerived.ts';

export function SpacecraftPanel() {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);

  const mass = totalMass(config.spacecraft);
  const { isEarth, name: bodyName } = centralBodyFacts(config);
  const derived = deriveInitialOrbit(config);
  const dragOn = config.forces.atmosphericDrag && isEarth;

  // Ballistic coefficient at both attitude extremes. The pair is the point:
  // for a sail these two numbers are two orders of magnitude apart, and the
  // attitude law chooses between them every second of the mission.
  const { busArea, dragCoefficient } = config.spacecraft;
  const bBroadside = ballisticCoefficient(mass, dragCoefficient, busArea + config.sail.area);
  const bEdgeOn = ballisticCoefficient(mass, dragCoefficient, busArea);

  return (
    <div className="panel-body">
      <Section
        title="Mass budget"
        subtitle="Propellant mass is carried for completeness of the budget only. There is no thruster model, so propellant is never expended and simply adds inert mass."
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

      <Section
        title="Aerodynamics"
        subtitle="Used by the atmospheric drag model. The sail supplies its own drag area, projected on the relative wind, on top of the bus cross-section below."
      >
        <div className="field-row">
          <NumberField
            label="Bus cross-section"
            unit="m^2"
            value={busArea}
            min={0}
            max={10000}
            onChange={(v) =>
              setConfig((c) => {
                c.spacecraft.busArea = v;
              })
            }
            help="Constant, orientation-independent area of the spacecraft body. Taken as tumble-averaged; it is swamped by the sail whenever the sail is not edge-on."
          />
          <NumberField
            label="Drag coefficient"
            unit="-"
            value={dragCoefficient}
            min={0}
            max={5}
            step={0.05}
            decimals={2}
            onChange={(v) =>
              setConfig((c) => {
                c.spacecraft.dragCoefficient = v;
              })
            }
            help="Free-molecular value referred to the projected area. 2.2 is conventional for a satellite in the upper atmosphere; 2.0 to 2.4 are all defensible, and that spread is smaller than the uncertainty in the density model it multiplies."
          />
        </div>

        <ReadoutGrid>
          <Readout
            label="Ballistic coefficient, sail broadside"
            value={`${sig(bBroadside, 3)} kg/m^2`}
            help="m / (Cd A) with the full sail facing the wind. A cubesat is around 50 kg/m^2 and a spent rocket body around 100; a sail is one to two orders of magnitude below both, which is why it cannot ignore the atmosphere in LEO."
            kind={bBroadside < 5 ? 'bad' : 'neutral'}
          />
          <Readout
            label="Ballistic coefficient, sail edge-on"
            value={`${sig(bEdgeOn, 3)} kg/m^2`}
            help="With the sail feathered, only the bus is exposed. The ratio between these two numbers is the attitude authority the spacecraft has over its own decay rate."
          />
          <Readout
            label="Attitude authority over decay"
            value={`${sig(bEdgeOn / bBroadside, 3)}x`}
            emphasis
            help="How much slower the orbit decays feathered than broadside. This coupling is what makes deorbit sails work, and it is also why a steering law designed purely against the Sun line can be badly wrong in LEO."
          />
          {derived && isEarth && (
            <Readout
              label="Density at the initial altitude"
              value={`${atmosphericDensity(derived.altitude, config.atmosphereActivity).toExponential(2)} kg/m^3`}
            />
          )}
        </ReadoutGrid>

        {!dragOn && (
          <Notice kind="info">
            Atmospheric drag is currently switched off for this run, so these figures are
            informational only. Enable it in the Simulation panel.
          </Notice>
        )}
        {config.spacecraft.busArea === 0 && (
          <Notice kind="warning">
            With a zero bus area a feathered sail has exactly no drag, which no real
            spacecraft achieves. {DEFAULT_SPACECRAFT.busArea} m^2 is the default.
          </Notice>
        )}
      </Section>

      <Section title="Initial orbit" subtitle={`About the ${bodyName}, in the inertial integration frame.`}>
        <InitialOrbitFields derived={derived} />
      </Section>

      {derived && (
        <Section title="Derived initial conditions">
          <ReadoutGrid>
            <Readout label="Radius" value={formatLength(derived.radius)} />
            <Readout label="Altitude" value={formatLength(derived.altitude)} />
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
              value={derived.unbound ? 'unbound trajectory' : formatDuration(derived.period)}
            />
          </ReadoutGrid>

          {derived.unbound && (
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
          <p>
            The atmosphere is assumed to <em>co-rotate rigidly with the Earth</em>, so the
            drag model works against <code>v - omega_E x r</code> rather than the inertial
            velocity. At 400 km that is a 494 m/s correction, about 6% of the orbital
            speed and 12% of the drag.
          </p>
        </div>
      </Collapsible>
    </div>
  );
}
