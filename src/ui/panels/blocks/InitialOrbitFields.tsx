/**
 * The initial-orbit editor.
 *
 * Shared between the Mission builder (where it is the centrepiece of the
 * one-screen setup) and the Spacecraft panel (where it sits beside the mass
 * budget). Having one component means the two can never drift apart in
 * validation, units or wording.
 */

import { AU, DEG } from '../../../core/constants.ts';
import { radToDeg } from '../../../core/units.ts';
import { useStore } from '../../../state/store.ts';
import { Notice, NumberField } from '../../widgets/Controls.tsx';
import { centralBodyFacts, type DerivedOrbit } from './orbitDerived.ts';

export function InitialOrbitFields({ derived }: { derived: DerivedOrbit | null }) {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);

  const {
    isEarth,
    isHeliocentric,
    name: bodyName,
    radius: bodyRadius,
  } = centralBodyFacts(config);
  const dragOn = config.forces.atmosphericDrag && isEarth;

  if (config.initial.mode !== 'elements') {
    return (
      <Notice kind="info" title="Cartesian initial state">
        This scenario specifies the initial state as a position and velocity vector rather
        than as orbital elements, because it is a transfer trajectory rather than a closed
        orbit. Convert it to elements to edit it as an orbit - doing so will discard the
        aimed transfer geometry.
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
    );
  }

  const initial = config.initial;

  /**
   * Periapsis entry.
   *
   * Stored identically in both cases - as an ALTITUDE above the central
   * body's reference radius - but presented in the unit of the regime.
   * Heliocentrically that means periapsis RADIUS in AU, because "altitude
   * above the solar photosphere" is a quantity nobody has ever wanted: Earth
   * would be at 148.9 million km of it.
   */
  const periapsisField = isHeliocentric ? (
    <NumberField
      label="Periapsis radius"
      unit="AU"
      value={(initial.altitude + bodyRadius) / AU}
      min={0.02}
      max={100}
      step={0.01}
      decimals={4}
      onChange={(v) =>
        setConfig((c) => {
          if (c.initial.mode === 'elements') c.initial.altitude = v * AU - bodyRadius;
        })
      }
      help="Heliocentric distance at the closest point of the orbit. Earth is at 1 AU, Venus 0.72, Mars 1.52. Stored internally as an altitude above the solar photosphere, which is why the number looks odd in a saved JSON file."
      message={
        (initial.altitude + bodyRadius) / AU < 0.1
          ? 'Inside 0.1 AU the thermal environment destroys any sail material yet made, and none of that is modelled here.'
          : undefined
      }
    />
  ) : (
    <NumberField
      label="Periapsis altitude"
      unit="km"
      value={initial.altitude / 1000}
      min={50}
      max={500000}
      onChange={(v) =>
        setConfig((c) => {
          if (c.initial.mode === 'elements') c.initial.altitude = v * 1000;
        })
      }
      help={`Height of the lowest point of the orbit above the ${bodyName} reference radius (${(bodyRadius / 1000).toFixed(0)} km). For a circular orbit this is simply the orbit altitude.`}
      message={
        isEarth && initial.altitude < 400e3
          ? dragOn
            ? 'Below about 400 km drag exceeds the sail force by orders of magnitude. It IS modelled here, so expect the orbit to decay whatever the steering law does.'
            : 'Below about 400 km atmospheric drag exceeds the sail force by orders of magnitude, and drag is switched off in this run.'
          : undefined
      }
      messageKind={isEarth && initial.altitude < 400e3 && !dragOn ? 'error' : 'warning'}
    />
  );

  return (
    <>
      <div className="field-row">
        {periapsisField}
        <NumberField
          label="Eccentricity"
          unit="-"
          value={initial.eccentricity}
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
            initial.eccentricity > 0.3 && config.integration.integrator === 'rk4'
              ? 'Consider the adaptive integrator at this eccentricity, or reduce the timestep.'
              : undefined
          }
        />
      </div>
      <div className="field-row">
        <NumberField
          label="Inclination"
          unit="deg"
          value={radToDeg(initial.inclination)}
          min={0}
          max={180}
          step={0.5}
          decimals={2}
          onChange={(v) =>
            setConfig((c) => {
              if (c.initial.mode === 'elements') c.initial.inclination = v * DEG;
            })
          }
          help={
            isHeliocentric
              ? 'Angle between the orbit plane and the J2000 EQUATOR - not the ecliptic. The planets all orbit within a couple of degrees of the ecliptic, which is itself inclined 23.4 degrees to this frame, so a coplanar interplanetary trajectory reads as about 23 degrees here.'
              : 'Angle between the orbit plane and the equator. Above 90 degrees the orbit is retrograde.'
          }
        />
        <NumberField
          label="RAAN"
          unit="deg"
          value={radToDeg(initial.raan)}
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
          value={radToDeg(initial.argumentOfPeriapsis)}
          min={0}
          max={360}
          step={1}
          decimals={2}
          onChange={(v) =>
            setConfig((c) => {
              if (c.initial.mode === 'elements') c.initial.argumentOfPeriapsis = v * DEG;
            })
          }
          help="Angle from the ascending node to periapsis, measured in the orbit plane."
        />
        <NumberField
          label="True anomaly"
          unit="deg"
          value={radToDeg(initial.trueAnomaly)}
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
  );
}
