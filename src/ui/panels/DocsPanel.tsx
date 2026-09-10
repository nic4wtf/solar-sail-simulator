/**
 * Documentation panel (spec S7, S22, S23).
 *
 * Shows the ACTIVE model configuration alongside the equations, so the user
 * never has to guess what the simulator is currently calculating. The
 * enabled/disabled list is generated from the live config rather than written
 * out, so it cannot drift out of date.
 */

import { CENTRAL_BODY_LABELS } from '../../core/environment/environment.ts';
import { MOON_MODEL_ACCURACY, MOON_MODEL_LABELS } from '../../core/environment/moon.ts';
import { INTEGRATOR_LABELS } from '../../core/integrator/integrators.ts';
import { FRAME_LABELS } from '../../core/orbital/frames.ts';
import { ATTITUDE_RULE_LABELS } from '../../core/attitude/types.ts';
import { SAIL_FORCE_MODEL_LABELS, SOLAR_CONSTANT_OPTIONS } from '../../core/sail/sail.ts';
import { formatTimestep, sig } from '../../core/units.ts';
import { useStore } from '../../state/store.ts';
import {
  Collapsible,
  Equation,
  Notice,
  Readout,
  ReadoutGrid,
  Section,
} from '../widgets/Controls.tsx';

function OnOff({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <div className="readout">
      <span className="readout-label">{children}</span>
      <span className={`readout-value ${on ? 'readout-good' : 'readout-neutral'}`}>
        {on ? 'ENABLED' : 'disabled'}
      </span>
    </div>
  );
}

export function DocsPanel() {
  const config = useStore((s) => s.config);
  const { forces, integration: integ, sail, attitude } = config;
  const isEarth = config.centralBody === 'earth';
  const isHeliocentric = config.centralBody === 'sun';

  return (
    <div className="panel-body">
      <Section
        title="Active model configuration"
        subtitle="Generated from the current configuration. Anything marked disabled, and anything absent from this list, is not being computed."
      >
        <ReadoutGrid>
          <OnOff on={forces.centralGravity}>
            {isEarth ? 'Earth' : 'Moon'} point-mass gravity
          </OnOff>
          <OnOff on={forces.earthJ2 && isEarth}>Earth J2 oblateness</OnOff>
          <OnOff on={forces.earthJ3 && isEarth}>Earth J3 pear-shape term</OnOff>
          <OnOff on={forces.moonGravity}>
            {isEarth ? 'Moon' : 'Earth'} third-body gravity
          </OnOff>
          <OnOff on={forces.sunGravity && !isHeliocentric}>Sun third-body gravity</OnOff>
          <OnOff on={forces.planetGravity && config.perturbingPlanets.length > 0}>
            Planetary third-body gravity
            {config.perturbingPlanets.length > 0
              ? ` (${config.perturbingPlanets.join(', ')})`
              : ''}
          </OnOff>
          <OnOff on={forces.solarRadiationPressure}>Solar radiation pressure</OnOff>
          <OnOff on={forces.eclipse}>Eclipse (umbra and penumbra)</OnOff>
          <OnOff on={forces.atmosphericDrag && isEarth}>
            Atmospheric drag (sail-coupled)
          </OnOff>
          <OnOff on={forces.earthAlbedo}>Earth albedo radiation pressure</OnOff>
          <OnOff on={forces.earthInfrared}>Earth infrared radiation pressure</OnOff>
          <OnOff on={false}>Gravity harmonics beyond J3</OnOff>
          <OnOff on={false}>Thermospheric winds and geomagnetic storms</OnOff>
          <OnOff on={false}>Sphere-of-influence patching</OnOff>
          <OnOff on={false}>Departure, arrival and launch-window targeting</OnOff>
          <OnOff on={false}>Solar thermal limits and coronal drag</OnOff>
          <OnOff on={false}>Lunar gravity harmonics</OnOff>
          <OnOff on={false}>Attitude dynamics and control limits</OnOff>
          <OnOff on={false}>Sail billow, wrinkling and degradation</OnOff>
          <OnOff on={false}>Relativistic corrections</OnOff>
        </ReadoutGrid>

        <ReadoutGrid>
          <Readout label="Integrator" value={INTEGRATOR_LABELS[integ.integrator]} />
          <Readout
            label={integ.integrator === 'rk4' ? 'Timestep' : 'Maximum timestep'}
            value={formatTimestep(integ.timestep)}
          />
          <Readout label="Duration" value={formatTimestep(integ.duration)} />
          <Readout label="Output interval" value={formatTimestep(integ.outputInterval)} />
          <Readout label="Sail force law" value={SAIL_FORCE_MODEL_LABELS[sail.forceModel]} />
          <Readout label="Attitude rule" value={ATTITUDE_RULE_LABELS[attitude.kind]} />
          <Readout label="Lunar ephemeris" value={MOON_MODEL_LABELS[config.moonModel]} />
          <Readout
            label="Solar irradiance"
            value={`${SOLAR_CONSTANT_OPTIONS[sail.solarConstant].irradiance} W/m^2`}
          />
        </ReadoutGrid>

        <Notice kind="warning" title="Fidelity statement">
          This is a concept-level analysis tool. Results are appropriate for comparing
          configurations, sizing a sail, and understanding which effects dominate.
          They are <strong>not</strong> suitable for flight-dynamics certification,
          operational planning, or collision avoidance.
        </Notice>
      </Section>

      {/* ------------------------------------------------------------ */}
      <Section title="Reference frames">
        <div className="doc-prose">
          <p>
            <strong>Integration frame.</strong> {CENTRAL_BODY_LABELS[config.centralBody]}.
            X points toward the J2000 vernal equinox, Z along the Earth mean rotation axis,
            Y completes the right-handed set. The frame is treated as non-rotating.
          </p>
          <p>
            The Moon-centred frame uses the <em>same axis directions</em> and differs only
            in origin. Third-body terms include the indirect (inertial) correction, so the
            accelerating origin is handled correctly.
          </p>
        </div>
        <Collapsible title="Attitude frames" defaultOpen>
          <div className="doc-prose">
            <ul>
              <li>
                <strong>RSW</strong> - {FRAME_LABELS.rsw}. Zero angles point the sail normal
                radially outward.
              </li>
              <li>
                <strong>VNB</strong> - {FRAME_LABELS.vnb}. Zero angles point it along the
                velocity vector.
              </li>
              <li>
                <strong>Sun-relative</strong> - {FRAME_LABELS.sun}. Cone angle from the Sun
                line, clock angle about it. Cone 0 gives maximum force; cone 90 degrees
                feathers the sail.
              </li>
              <li>
                <strong>Inertial</strong> - {FRAME_LABELS.inertial}.
              </li>
            </ul>
            <p>
              Every rule builds its frame through one shared function that returns an
              explicit orthonormal triad in inertial coordinates, and reports the frame it
              used. Frames are never implicitly mixed.
            </p>
          </div>
        </Collapsible>
      </Section>

      {/* ------------------------------------------------------------ */}
      <Section title="Equations of motion">
        <Equation>{`Second-order system, integrated directly:

  dr/dt = v
  dv/dt = a_central + a_J2 + a_J3 + a_moon + a_sun
          + a_planets + a_srp + a_drag + a_earthrad

Central body (point mass):

  a_central = -mu r / |r|^3

Third body (in a frame centred on the central body):

  a_3 = mu_3 [ (s - r)/|s - r|^3  -  s/|s|^3 ]

  s = central body -> third body
  The second term removes the third body's pull on the
  central body itself. Omitting it is a classic error
  that produces a spurious secular drift.

Earth J2 oblateness (Vallado eq. 8-38):

  k   = -(3/2) J2 (mu/r^2) (Re/r)^2
  a_x = k (1 - 5 z^2/r^2) x/r
  a_y = k (1 - 5 z^2/r^2) y/r
  a_z = k (3 - 5 z^2/r^2) z/r

Earth J3 pear-shape term (Vallado eq. 8-39):

  k   = -(5/2) J3 (mu/r^2) (Re/r)^3
  a_x = k [3 (z/r) - 7 (z/r)^3] x/r
  a_y = k [3 (z/r) - 7 (z/r)^3] y/r
  a_z = k [6 (z/r)^2 - 7 (z/r)^4 - 3/5]

Both are the gradient of  U_n = -(mu/r) J_n (Re/r)^n P_n(z/r),
which is what the validation suite checks them against.`}</Equation>
      </Section>

      <Section title="Atmospheric drag">
        <Equation>{`Velocity relative to a rigidly co-rotating atmosphere:

  v_rel = v - omega_E x r ,  omega_E = 7.2921159e-5 rad/s

Drag area, projected on the relative wind:

  A_d = A_bus + A_sail |v_hat_rel . n|

Acceleration:

  a_drag = -(1/2) rho C_D (A_d / m) |v_rel| v_rel

Density: piecewise-exponential fit to the US Standard
Atmosphere 1976 / CIRA-72 (Vallado Table 8-4),

  rho(h) = rho_0 exp(-(h - h_0)/H)

evaluated in whichever of 28 bands contains h, and
identically zero above 2000 km.`}</Equation>
        <div className="doc-prose">
          <p>
            <strong>Why drag is different for a sail.</strong> For a conventional
            satellite drag is a nuisance parameter: a fixed ballistic coefficient times a
            density. For a sail it is <em>coupled to the control variable</em>, because
            the sail is the drag area. The same projection that decides how much sunlight
            the sail catches decides how much atmosphere it catches - except the two
            projections are taken against different directions, the Sun line and the
            relative wind. A sail edge-on to the wind has almost no drag; the same sail
            broadside has the full area, two orders of magnitude more. That coupling is
            what makes deorbit sails work, and it is why a steering law optimised purely
            against the Sun line can behave very differently once drag is switched on.
          </p>
          <p>
            <strong>What is not modelled.</strong> The density model is static: no diurnal
            bulge, no thermospheric winds, no geomagnetic response. Real density above
            200 km spans about an order of magnitude over the solar cycle, which the
            activity selector represents only as a blunt multiplier. A flat plate in
            free-molecular flow also develops lift perpendicular to the wind; that is
            omitted, as is any variation of C_D with incidence angle.
          </p>
        </div>
      </Section>

      <Section title="Earth radiation pressure">
        <Equation>{`Both terms arrive along the ZENITH direction and drive
the same flat-plate law as sunlight, with a different
pressure.

Thermal infrared - exact for a uniform Lambertian sphere:

  E_ir = M_ir (Re/r)^2 ,   M_ir = 240 W/m^2

Reflected sunlight - interpolated between the two limits
that have closed forms, weighted by w = (Re/r)^2:

  near:  a S (Re/r)^2 max(0, cos phi)
  far:   a S (Re/r)^2 (2/3pi) [sin phi + (pi - phi) cos phi]

  phi = phase angle Sun-Earth-spacecraft
  a   = 0.30  (Earth Bond albedo)`}</Equation>
        <div className="doc-prose">
          <p>
            At 500 km these return of order 40% of the direct solar flux - far from
            negligible on a vehicle propelled entirely by photon momentum. They translate
            into much less than 40% more useful thrust, because both arrive along the
            local vertical where they do very little work on the orbit.
          </p>
          <p>
            <strong>The infrared term does not stop in eclipse.</strong> That makes it
            qualitatively different from everything else in the model: it is the only
            force still pushing on the sail in shadow. The albedo term switches itself off
            geometrically instead - a spacecraft in the Earth's shadow is over the night
            side, where the phase factor is zero.
          </p>
        </div>
      </Section>

      {isHeliocentric && (
        <Section title="Heliocentric frame">
          <Equation>{`Governing parameter out here is the LIGHTNESS NUMBER:

  beta = a_c / (mu_sun / AU^2)

Both the sail acceleration and solar gravity fall off
as 1/r^2, so beta is the SAME EVERYWHERE. A sail that
cannot escape from 1 AU cannot escape from 5 AU either.

A Sun-facing sail reduces the effective gravitational
parameter to mu (1 - beta), so a circular orbit escapes
when

  v^2 >= 2 mu (1 - beta) / r    ->    beta >= 0.5`}</Equation>
          <div className="doc-prose">
            <p>
              <strong>Adding this frame changed almost nothing.</strong> The Sun-relative
              vector <code>r - r_sun</code> becomes simply <code>r</code>; the pressure law
              was always <code>P0 (1 AU / r)&sup2;</code> with no assumption that{' '}
              <code>r</code> is near 1 AU; and cone and clock angles were always measured
              from the Sun line. The steering laws, the force model and the integrator are
              the same code that runs in low Earth orbit.
            </p>
            <p>
              <strong>What is not modelled.</strong> There is no departure hyperbola, no
              launch-window search, no arrival manoeuvre and no sphere-of-influence
              patching: the integration centre never changes mid-run. A trajectory that
              enters a planet&apos;s sphere of influence is reported as having arrived in
              the neighbourhood, not as a capture solution. Solar thermal limits, coronal
              drag and sail degradation - the three things that actually decide whether a
              close solar pass is possible - are all absent.
            </p>
            <p>
              Planetary positions come from Standish&apos;s approximate Keplerian elements,
              precessed into the equinox of date so they agree with the solar and lunar
              series. See <code>docs/interplanetary-model.md</code>.
            </p>
          </div>
        </Section>
      )}

      <Section title="Solar radiation pressure">
        <Equation>{`Pressure at heliocentric distance r:

  P(r) = P0 (1 AU / r)^2 ,   P0 = W0 / c

  W0 = ${SOLAR_CONSTANT_OPTIONS[sail.solarConstant].irradiance} W/m^2  (selected)
  P0 = ${(SOLAR_CONSTANT_OPTIONS[sail.solarConstant].irradiance / 299792458 * 1e6).toFixed(4)} uN/m^2`}</Equation>

        {sail.forceModel === 'ideal' ? (
          <Equation>{`Ideal sail with efficiency eta:

  F = 2 eta P A cos^2(alpha) n

  eta = ${sig(sail.efficiency, 4)}  (selected)`}</Equation>
        ) : (
          <Equation>{`Non-ideal flat plate (McInnes 1999, eq. 2.51,
extended with a transmission term):

  a = 1 - rho - tau            (absorptivity)

  F_n = P A cos(alpha) [ (1 + rho s - tau) cos(alpha)
                         + B_f rho (1 - s)
                         + a (eps_f B_f - eps_b B_b)
                             / (eps_f + eps_b) ]

  F_t = P A cos(alpha) sin(alpha) (1 - rho s - tau)

  F   = F_n n + F_t t

  n = sail normal, oriented so cos(alpha) = u . n >= 0
  u = Sun -> spacecraft unit vector
  t = in-plane unit vector along the component of u
      perpendicular to n

Current coefficients:
  rho   = ${sig(sail.reflectivity, 4)}
  s     = ${sig(sail.specularFraction, 4)}
  tau   = ${sig(sail.transmissivity, 4)}
  eps_f = ${sig(sail.emissivityFront, 4)}
  eps_b = ${sig(sail.emissivityBack, 4)}
  B_f   = ${sig(sail.lambertianFront, 4)}
  B_b   = ${sig(sail.lambertianBack, 4)}

Setting rho = s = 1 and tau = 0 reduces this exactly to
  F = 2 P A cos^2(alpha) n
which the validation suite checks numerically.`}</Equation>
        )}

        <div className="doc-prose">
          <p>
            <strong>Two-sided sail.</strong> A sail is a physical sheet, so the Sun
            illuminates whichever face is turned toward it. If the commanded normal has
            <code> u . n &lt; 0</code> it is flipped, and the force always pushes
            anti-sunward. Version 1 assumes both faces are optically identical, which is
            not true of a real sail with a bare back surface.
          </p>
        </div>
      </Section>

      <Section title="Eclipse">
        <Equation>{`Dual-cone (umbra + penumbra) geometry.

Along the anti-Sun axis at distance d from the occulting
body of radius R_b, with the Sun at distance d_s:

  f_umbra    = asin( (R_sun - R_b) / d_s )
  f_penumbra = asin( (R_sun + R_b) / d_s )

  r_umbra    = R_b - d tan(f_umbra)
  r_penumbra = R_b + d tan(f_penumbra)

With p the perpendicular distance from the shadow axis:

  p <= r_umbra       ->  illumination = 0
  p >= r_penumbra    ->  illumination = 1
  otherwise          ->  linear ramp between them

The illumination fraction multiplies P directly.`}</Equation>
        <div className="doc-prose">
          <p>
            The linear penumbra ramp replaces the exact overlap integral of two discs. The
            difference is a few percent of the penumbra crossing, which in LEO lasts only a
            few seconds out of a ~5700 s revolution.
          </p>
          <p>
            <strong>Why eclipse is enabled by default.</strong> In a 500 km circular orbit
            the spacecraft is shadowed for roughly 35% of every revolution. Omitting it
            would overstate the available sail impulse by about a third, so the headline
            feasibility numbers would simply be wrong.
          </p>
        </div>
      </Section>

      <Section title="Locally optimal steering">
        <Equation>{`Maximise the force component along a chosen
direction d, for an ideal sail:

  maximise  cos^2(alpha) cos(theta - alpha)

  theta = angle between u and d
  alpha = angle between u and n, in the (u, d) plane

d/d(alpha) = 0, divided through by cos(alpha), gives:

  tan(theta - alpha) = 2 tan(alpha)

Solved by bisection on
  alpha in ( max(0, theta - 90deg), min(theta, 90deg) )

  theta = 0    ->  alpha = 0
  theta = 90   ->  alpha = 35.264 deg`}</Equation>
        <div className="doc-prose">
          <p>
            The 35.264 degree result is the classical maximum-transverse-force angle: the
            force magnitude falls as cos<sup>2</sup>(alpha) while its transverse projection
            grows as sin(alpha), and the product peaks well before 45 degrees.
          </p>
          <p>
            This law is <strong>locally</strong> optimal - greedy at each instant, with no
            regard for the resulting trajectory. It is the correct reference for "how fast
            could this sail change this orbit", not a globally optimal transfer.
          </p>
        </div>
      </Section>

      <Section title="Why feathering matters">
        <div className="doc-prose">
          <p>
            A sail can only push away from the Sun. Over one revolution of a planet-centred
            orbit, the along-track component of that push is prograde for roughly half the
            orbit and retrograde for the other half, so a <em>constant</em> attitude nets
            out to almost nothing.
          </p>
          <p>
            Turning the sail edge-on (cone = 90 degrees, zero projected area) through the
            unfavourable half and back to a working angle through the favourable half
            leaves a one-sided, secular energy change. Measured in the default 500 km LEO
            with a 1 m<sup>2</sup>/kg sail over 7 days:
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Steering law</th>
                <th className="num">d(mean sma)</th>
                <th className="num">Impulse</th>
                <th className="num">Duty</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Locally optimal prograde</td>
                <td className="num" style={{ color: 'var(--ok)' }}>+2375 m</td>
                <td className="num">1.83 m/s</td>
                <td className="num">36.5%</td>
              </tr>
              <tr>
                <td>Feathering schedule (default)</td>
                <td className="num" style={{ color: 'var(--ok)' }}>+901 m</td>
                <td className="num">0.96 m/s</td>
                <td className="num">19.2%</td>
              </tr>
              <tr>
                <td>Constant Sun-facing</td>
                <td className="num">-11 m</td>
                <td className="num">3.16 m/s</td>
                <td className="num">63.0%</td>
              </tr>
              <tr>
                <td>Constant radial (pitch 0)</td>
                <td className="num">-8 m</td>
                <td className="num">1.20 m/s</td>
                <td className="num">23.9%</td>
              </tr>
              <tr>
                <td>Naive +/-35 deg schedule</td>
                <td className="num" style={{ color: 'var(--err)' }}>-699 m</td>
                <td className="num">1.04 m/s</td>
                <td className="num">20.7%</td>
              </tr>
              <tr>
                <td>Constant 35 deg pitch</td>
                <td className="num" style={{ color: 'var(--err)' }}>-948 m</td>
                <td className="num">1.37 m/s</td>
                <td className="num">27.3%</td>
              </tr>
            </tbody>
          </table>
          <p>
            Look at the <strong>constant Sun-facing</strong> row. It has by far the highest
            instantaneous acceleration - a duty factor of 63%, more than three times the
            feathering schedule - and it spends the most impulse of any law here, 3.16 m/s.
            It changes the orbit by <strong>eleven metres</strong>, because an unsteered
            force cancels over each revolution.
          </p>
          <p>
            Meanwhile three of the six laws <em>lower</em> the orbit. That is the whole
            argument for this tool existing: instantaneous sail acceleration tells you
            almost nothing about useful manoeuvring capability. You have to integrate the
            actual acceleration vector and look at what the orbit did.
          </p>
        </div>
      </Section>

      <Section title="Mean versus osculating elements">
        <div className="doc-prose">
          <p>
            The propagator records <strong>osculating</strong> elements - the instantaneous
            two-body elements of the state vector. Under J2 these oscillate at twice the
            orbital frequency: in the default LEO the osculating semi-major axis swings
            about <strong>11.8 km peak-to-peak</strong>, while the sail changes it by tens
            of metres over the same six hours.
          </p>
          <p>
            Every feasibility figure in this application is therefore computed from{' '}
            <strong>revolution-averaged (mean)</strong> elements, using a centred boxcar
            average over exactly one orbital period. The charts show both traces so the
            distinction stays visible.
          </p>
          <p>
            Differencing two osculating samples would report J2 geometry as sail
            performance - wrong by a factor of several hundred, and with the wrong sign
            about half the time.
          </p>
        </div>
      </Section>

      <Section title="Ephemerides and time">
        <div className="doc-prose">
          <p>
            <strong>Sun.</strong> Low-precision analytic series from the Astronomical
            Almanac, accurate to about 0.01 degrees in ecliptic longitude. A 0.01 degree
            direction error changes the sail incidence angle by the same amount, altering
            the force by under 1e-4 relative.
          </p>
          <p>
            <strong>Moon.</strong> {MOON_MODEL_LABELS[config.moonModel]}.{' '}
            {MOON_MODEL_ACCURACY[config.moonModel]}
          </p>
          <p>
            <strong>Time scale.</strong> A single uniform time scale is used; UTC, TT and
            TDB are not distinguished. The maximum offset between them is about 70 seconds,
            which displaces the Sun by 3e-4 degrees and the Moon by ~35 km - both far below
            the error of the ephemerides themselves.
          </p>
          <p>
            <strong>Not modelled:</strong> light-time correction, aberration, nutation,
            polar motion, or precession beyond the J2000 mean obliquity drift term.
          </p>
        </div>
      </Section>

      <Section title="Numerical accuracy">
        <div className="doc-prose">
          <p>
            RK4 accuracy is governed by <strong>steps per revolution</strong>, not by the
            timestep in seconds. Measured on a two-body 500 km circular orbit over 7 days
            (see <code>docs/validation.md</code> and the test suite):
          </p>
          <ul>
            <li>~570 steps/rev (10 s): relative semi-major axis drift below 1e-10</li>
            <li>~95 steps/rev (60 s): drift of order 1e-8</li>
            <li>~19 steps/rev (300 s): drift of order 1e-5, visibly wrong</li>
          </ul>
          <p>
            With no sail force enabled, a circular orbit stays circular and the energy and
            angular momentum are conserved to round-off - the first validation test in the
            suite. The Simulation panel warns when the configured timestep falls below
            about 100 steps per revolution.
          </p>
          <p>
            For eccentric orbits the binding constraint is periapsis, where the angular
            rate exceeds the mean by <code>sqrt(1+e)/(1-e)^1.5</code>. Above about e = 0.3
            the adaptive Dormand-Prince integrator is the right choice.
          </p>
        </div>
      </Section>

      <Section title="Further documentation">
        <div className="doc-prose">
          <p>The repository contains fuller write-ups:</p>
          <ul>
            <li><code>docs/physics.md</code> - constants, force model, derivations</li>
            <li><code>docs/orbital-mechanics.md</code> - elements, frames, conversions</li>
            <li><code>docs/solar-sail-model.md</code> - full SRP derivation</li>
            <li><code>docs/attitude-rules.md</code> - every steering law in detail</li>
            <li><code>docs/earth-model.md</code> - Earth gravity, J2/J3, drag, albedo, eclipse</li>
            <li><code>docs/interplanetary-model.md</code> - heliocentric frame, planetary ephemerides, lightness number</li>
            <li><code>docs/lunar-model.md</code> - lunar ephemeris and assumptions</li>
            <li><code>docs/validation.md</code> - test results and error budgets</li>
            <li><code>docs/future-work.md</code> - roadmap, including interplanetary</li>
          </ul>
          <p>Key references:</p>
          <ul>
            <li>
              McInnes, C. R., <em>Solar Sailing: Technology, Dynamics and Mission
              Applications</em>, Springer, 1999.
            </li>
            <li>
              Vallado, D. A., <em>Fundamentals of Astrodynamics and Applications</em>, 4th
              ed., Microcosm Press, 2013.
            </li>
            <li>
              Macdonald, M. and McInnes, C. R., "Analytical Control Laws for Planet-Centred
              Solar Sailing", <em>Journal of Guidance, Control, and Dynamics</em>, 28(5),
              2005.
            </li>
            <li>
              Meeus, J., <em>Astronomical Algorithms</em>, 2nd ed., Willmann-Bell, 1998
              (Ch. 25 and 47).
            </li>
            <li>
              Dormand, J. R. and Prince, P. J., "A family of embedded Runge-Kutta
              formulae", <em>Journal of Computational and Applied Mathematics</em>, 6(1),
              1980.
            </li>
          </ul>
        </div>
      </Section>

      <Section title="Interplanetary: deliberately out of scope">
        <Notice kind="info">
          Version 1 covers Earth orbit and Earth-Moon space only. The groundwork is
          already in place: the environment exposes a switchable integration centre, the
          SRP model scales with heliocentric distance, and the attitude rules work in a
          Sun-relative frame. What remains is planetary ephemerides, a heliocentric frame
          option, sphere-of-influence patching and launch/arrival targeting. See{' '}
          <code>docs/future-work.md</code>.
        </Notice>
      </Section>
    </div>
  );
}
