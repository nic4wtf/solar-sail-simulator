# Solar Sail Simulator

An interactive solar-sail performance simulator for **Earth-orbit, Earth-Moon
and interplanetary mission analysis**. Runs entirely in the browser: no backend, no database, no
account. Configure a spacecraft and a sail, choose a steering law, run a
trajectory, and watch the orbit evolve.

The tool exists to answer questions like *"if I put a 20 m²/kg sail on a 500 km
orbit, how much orbital change can I realistically generate?"* — and to make
clear why the answer is **not** `pressure × area / mass`.

> **Fidelity statement.** This is a concept-level analysis tool. Results are
> appropriate for comparing configurations, sizing a sail, and understanding
> which effects dominate. They are **not** suitable for flight-dynamics
> certification, operational planning, or collision avoidance.

---

## Quick start

### Option A — use the deployed version

**https://nic4wtf.github.io/solar-sail-simulator/**

The app loads with a working 500 km LEO simulation already running; press
**Run** to re-propagate after any change. Nothing to install, and no data
leaves your browser — the propagator, the analysis and the CSV export all run
client-side.

### Option B — run locally

```bash
npm install
npm run dev
```

That's it — two commands, then open the URL Vite prints (usually
`http://localhost:5173`). No setup scripts, no environment variables, no
services to start.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm start` | Alias for `npm run dev` |
| `npm run build` | Typecheck and produce a static bundle in `dist/` |
| `npm run preview` | Serve the built bundle locally |
| `npm test` | Run the validation suite (299 tests) |
| `npm run test:watch` | Validation suite in watch mode |
| `npm run typecheck` | TypeScript only, no emit |

Requires Node 20 or newer.

---

## Deploying to GitHub Pages

Already live at **https://nic4wtf.github.io/solar-sail-simulator/**, published
by `.github/workflows/deploy.yml` on every push to `main`. The workflow
typechecks, runs all 299 tests, builds, and only then publishes — so a broken
commit cannot reach the live site.

To set this up on a fork:

1. Push to `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Done.

No secrets or tokens are needed. Vite is configured with `base: './'`, so the
bundle works from any sub-path — you do not need to hard-code the repository
name, and the same build works at a custom domain or opened from the filesystem.

**Constraints this design accepts.** GitHub Pages serves static files only, so
everything runs client-side: the propagator, the analysis, the CSV export. That
is a deliberate architectural choice rather than a workaround — a 7-day LEO run
is ~40,000 RK4 steps and completes in about 0.7 s in the browser, so there is
nothing a server would usefully do.

---

## What the application does

### Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ SOLAR SAIL SIMULATOR                     Run  ▶ ⏸ ⏹ ↻             │
├──────────────┬─────────────────────────────────┬───────────────────┤
│ Mission      │                                 │ Results          │
│ Spacecraft   │        3D / 2D trajectory       │ Sensitivity      │
│ Solar Sail   │        + live telemetry HUD     │ Physics / Model  │
│ Attitude     │        + vector legend          │                  │
│ Simulation   │        + playback timeline      │                  │
│              ├─────────────────────────────────┤                  │
│              │  Charts (elements / altitude /  │                  │
│              │   sail / state / geometry)      │                  │
└──────────────┴─────────────────────────────────┴───────────────────┘
```

### Themes

Light, dark, and **system** (follows the OS preference live, not just at load).
The choice persists in `localStorage`.

Theming is not just CSS: the 3D view, the 2D canvas and the Plotly charts each
take colours in a form that cannot read CSS custom properties, so the palette
lives once in [`src/ui/theme.ts`](src/ui/theme.ts) and `styles.css` mirrors only
the chrome tokens. A test asserts the two halves define the same tokens, that
the light theme overrides every dark colour, and that every text/background
pairing meets WCAG AA.

The light palette is not a mechanical inversion. Three things had to change in
kind rather than in lightness: the **starfield is hidden** (pale dots on a pale
sky read as rendering dirt), the **ambient light is roughly doubled** (or the
night side of a body becomes a black hole), and the **not-yet-travelled path is
paled and made more transparent** (a 7-day LEO run is ~106 overlapping
revolutions, which accumulate into a solid band on a light background).

Switching themes recolours the live 3D scene in place rather than rebuilding
it, so the camera position and the running playback are preserved.

### Execution model

A run is **propagated to completion first**, into an array of samples, and then
**played back**. This means charts are complete the instant a run finishes, the
timeline is scrubbable, and the visualisation frame rate is completely
decoupled from the integration timestep.

- **Run** propagates (with a progress bar, cancellable, UI stays responsive).
- **▶ / ⏸ / ⏹** drive the playback cursor.
- The 3D view, the HUD and the chart cursor all follow that one cursor.

### Playback rate

The rate lives **beside the Run button** and is set in **simulation time per
real second** — not as an abstract multiplier, whose meaning would change with
the output interval and the display refresh rate.

A solar-sail study has two timescales of interest, and they are about **100x
apart**:

| | What you watch | Rate for a 500 km LEO |
| --- | --- | --- |
| **`1 rev`** | The sail feathering and re-pointing through one revolution | ~190x real time (1 rev in 30 s) |
| **`Whole run`** | The orbit itself evolving over the whole mission | ~20 000x real time (7 days in 30 s) |

No single rate serves both: at `1 rev` the default 7-day run takes **53
minutes** to play, and at `Whole run` a revolution flashes past in **0.28 s**.
So both are one click apart, a log slider covers everything between, and the
timeline always reports **both** numbers (`1 rev ≈ 30 s · run ≈ 53.4 min`) so
the trade-off is visible rather than hidden.

The rate auto-fits the whole run into ~30 s when a run finishes — the mission
scale is what you want to see first — and stops auto-fitting once you choose a
rate, so A/B comparisons stay comparable across re-runs.

For parking on a specific point in the orbit:

| Control | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Step one recorded sample |
| `Shift` + `←` `→` | Step ten samples |
| `◄ ►` buttons | Same, beside the timeline |

Shortcuts are ignored while a text field or slider has focus.

The HUD reports the **revolution number** and **orbit phase** (argument of
latitude), so "which part of the orbit is this?" is readable rather than
inferred from the picture.

The views **interpolate between recorded samples**, so slow playback glides
instead of stepping — the default LEO run has only ~38 samples per revolution.
The interpolation spans at most one output interval (2.7% of a revolution), so
a sharp attitude switch appears smoothed over that much; HUD numbers use the
nearest recorded sample so every figure shown is a real computed value, and
pausing or stepping lands exactly on a sample. The timeline warns when the
sampling — not the rate — is the limiting factor.

### Camera

Earth-centred, Moon-centred, spacecraft-following, or free. Following
translates the camera with the body rather than only re-aiming it, so your
chosen viewing direction and distance are preserved while the rig travels
along.

The spacecraft is followed in its own **orbital (RSW) frame** rather than in
inertial axes — the offset is held fixed relative to radial / along-track /
orbit-normal, so it revolves with the craft. This is not cosmetic: in a 500 km
orbit the spacecraft sits only 500 km above the surface, so *any* fixed
inertial offset longer than that which happens to point Earthward puts the
camera inside the planet and occludes the craft for much of the orbit. Locking
the offset to the orbital frame makes that impossible, and "above and behind"
stays above and behind all the way round.

### Scenarios

**Earth** — circular LEO (400/500/800/1000 km), sun-synchronous dawn-dusk,
elliptical, MEO, GEO, Molniya-like HEO, custom, and an Earth-escape experiment.

**Lunar** — Earth-to-Moon transfer, lunar approach, lunar orbit, custom lunar
orbit.

**Interplanetary** — deliberately **not implemented** in v1. See
[`docs/future-work.md`](docs/future-work.md) for what remains.

### Preset missions

Seven worked examples, each paired with the question it answers: LEO altitude
raising, LEO eccentricity change, GEO influence, Earth escape, lunar transfer,
lunar flyby, and an eclipse-cost comparison.

### Attitude rules

1. **Fixed** — constant angles in a chosen frame
2. **Time-based** — ramp, triangle or sinusoid with clamps
3. **Orbit-fraction** — interpolated schedule indexed by orbital phase, with a
   selectable phase variable (true anomaly, argument of latitude, mean anomaly,
   or **Sun phase**)
4. **Sun-relative** — cone and clock angles
5. **Locally optimal** — solves `tan(θ − α) = 2 tan α` each step to maximise
   force along prograde / retrograde / radial / normal
6. **Custom equation** — user formulae, parsed by a purpose-built evaluator
   with a whitelisted grammar (never `eval`, so a shared config file cannot
   execute code)

---

## The point of the tool

A sail's **characteristic acceleration** tells you very little about its
**useful manoeuvring capability**. Measured in the default 500 km LEO with a
1 m²/kg sail over 7 days, using revolution-averaged elements:

| Steering law | Δ(mean sma) | Impulse spent | Duty factor |
| --- | --- | --- | --- |
| Locally optimal prograde | **+2375 m** | 1.83 m/s | 36.5% |
| Feathering schedule (default) | **+901 m** | 0.96 m/s | 19.2% |
| Constant Sun-facing | −11 m | **3.16 m/s** | **63.0%** |
| Constant radial | −8 m | 1.20 m/s | 23.9% |
| Naive ±35° schedule | −699 m | 1.04 m/s | 20.7% |
| Constant 35° pitch | −948 m | 1.37 m/s | 27.3% |

Look at the **constant Sun-facing** row. It has the highest instantaneous
acceleration of any law here and spends the most impulse — and it changes the
orbit by eleven metres, because an unsteered force cancels over each
revolution. Three of the six laws *lower* the orbit.

The application therefore reports the theoretical figure and the simulated
outcome in **separate, explicitly labelled blocks**, and never presents one as
the other.

### Mean versus osculating elements

The propagator records *osculating* elements. Under J2 these oscillate by
**11.8 km peak-to-peak** in the default LEO, while the sail changes the
semi-major axis by hundreds of metres over a week. Differencing two osculating
samples would report J2 geometry as sail performance — wrong by a factor of
several hundred, with the wrong sign about half the time.

Every feasibility figure is therefore computed from **revolution-averaged**
elements (exact-endpoint integration over one orbital period), and the charts
default to the mean trace with the osculating trace one legend click away.

The averaging has a **resolution floor** of roughly 0.1% of the osculating
peak-to-peak (~10 m in LEO), which the Results panel reports and warns about
when a result falls near it.

---

## Mathematical model

Full derivations are in [`docs/`](docs/). Summary:

### Equations of motion

```
dr/dt = v
dv/dt = a_central + a_J2 + a_J3 + a_moon + a_sun
        + a_planets + a_srp + a_drag + a_earthrad

a_central = -mu r / |r|^3
a_3       = mu_3 [ (s - r)/|s - r|^3  -  s/|s|^3 ]
```

The second term of the third-body expression removes the third body's pull on
the *central* body; omitting it produces a spurious secular drift.

### Solar radiation pressure

```
P(r) = P0 (1 AU / r)^2 ,   P0 = W0 / c = 4.563 uN/m^2  (W0 = 1368 W/m^2)
```

Non-ideal flat plate (McInnes 1999, eq. 2.51, extended with transmission):

```
a = 1 - rho - tau

F_n = P A cos(alpha) [ (1 + rho s - tau) cos(alpha)
                       + B_f rho (1 - s)
                       + a (eps_f B_f - eps_b B_b) / (eps_f + eps_b) ]

F_t = P A cos(alpha) sin(alpha) (1 - rho s - tau)

F   = F_n n + F_t t
```

With `rho = s = 1, tau = 0` this reduces **exactly** to `F = 2 P A cos²(α) n`,
which the validation suite checks numerically. An ideal-sail-with-efficiency
model is also selectable.

### Reference frames

Integration is in a central-body-centred inertial frame (ECI or MCI, J2000
equatorial axes, switchable centre). Attitude frames — RSW, VNB, Sun-relative,
inertial — are each built by one shared function that returns an explicit
orthonormal **right-handed** triad, and every rule reports the frame it used.
Frames are never implicitly mixed.

### Integrators

- **RK4**, fixed step. Accuracy is governed by *steps per revolution*, not by
  the step in seconds.
- **Dormand-Prince 5(4)**, adaptive with PI step control. Necessary for
  eccentric orbits and lunar transfers, where the required step varies by
  orders of magnitude along the trajectory.

---

## Enabled and disabled effects

| Effect | Status |
| --- | --- |
| Earth / Moon / **Sun** point-mass gravity | ✅ (switchable integration centre) |
| Planetary third-body gravity | ✅ (Standish ephemerides, all eight planets) |
| Earth J2 oblateness | ✅ |
| Earth J3 pear-shape term | ✅ (off by default) |
| Sun and Moon third-body gravity | ✅ (toggleable) |
| Solar radiation pressure, non-ideal sail | ✅ |
| Eclipse — dual-cone umbra + penumbra | ✅ (on by default) |
| Atmospheric drag, with the sail as the drag area | ✅ (on by default for Earth orbits) |
| Earth albedo radiation pressure | ✅ (on by default for Earth orbits) |
| Earth infrared radiation pressure | ✅ (on by default for Earth orbits) |
| Gravity harmonics beyond J3 (incl. J22) | ❌ |
| Sphere-of-influence patching (the centre never changes mid-run) | ❌ |
| Departure hyperbolas, launch windows, arrival manoeuvres | ❌ |
| Solar thermal limits, coronal drag | ❌ |
| Thermospheric winds, diurnal bulge, geomagnetic storms | ❌ |
| Lunar gravity harmonics | ❌ |
| Attitude dynamics, control authority limits | ❌ |
| Sail billow, wrinkling, degradation | ❌ |
| Relativistic corrections | ❌ |

**Eclipse is on by default on purpose.** In a 500 km orbit the spacecraft is
shadowed for ~35% of every revolution; omitting it would overstate the
available sail impulse by about a third, so the headline feasibility numbers
would simply be wrong. It remains toggleable so the cost can be measured.

**Drag is on by default for the same reason, and it goes further: it changes
the sign of the LEO answer.** For a conventional satellite drag is a fixed
ballistic coefficient times a density. For a sail it is coupled to the control
variable, because *the sail is the drag area* — the same projection that sets
how much sunlight the sail catches sets how much atmosphere it catches, taken
against the relative wind instead of the Sun line. The default 100 m² / 100 kg
sail runs a ballistic coefficient of 0.45 kg/m² broadside against 45.5 kg/m²
edge-on, so its own attitude law has a 100× say in how fast it decays. That
coupling is what makes deorbit sails work.

In the default 500 km scenario over 7 days:

| Quantity | Sail only | With drag |
| --- | --- | --- |
| Change in mean semi-major axis | +901 m | −15.4 km |
| Sail impulse | 0.96 m/s | 0.96 m/s |
| Drag impulse | — | 9.19 m/s |

The atmosphere removes about ten times the impulse the sail supplies. No
steering law fixes that — at this altitude a sail this large is a deorbit
device, and the tool now says so rather than reporting an orbit-raising figure
that a real spacecraft would never see. Switch drag off to measure a steering
law on its own.

---

## Known limitations

- **The atmosphere model is static and is now the dominant LEO uncertainty.**
  Density comes from a piecewise-exponential fit to the US Standard Atmosphere
  1976 / CIRA-72, with a blunt ×0.4 / ×1 / ×3 solar-activity multiplier. Real
  thermospheric density spans an order of magnitude over the solar cycle, a
  factor of two between day and night, and jumps during geomagnetic storms.
  **A decay estimate from this model is a scale, not a date** — run both
  activity extremes and treat the spread as the answer.
- **No aerodynamic lift**, and no variation of the drag coefficient with
  incidence angle.
- **Earth albedo uses a single global mean** (0.30) and a phase model
  interpolated between two closed-form limits — good to ~3% at full phase over
  the subsolar point, much worse near the terminator where the flux is small.
  The sail's visible-band optical coefficients are also applied unchanged to
  Earth thermal infrared.
- **Simplified lunar ephemeris.** A truncated ELP2000 series (~150 km position
  error), not a JPL kernel. Lunar closest-approach distances are indicative to
  a few hundred km at best. A circular model (~47,000 km error) is also
  selectable for sensitivity checks.
- **Lunar transfer aiming is a geometric heuristic, not an optimiser.** It
  iterates a departure ellipse whose apogee meets the predicted lunar position.
  It reliably produces an encounter inside the lunar sphere of influence, which
  is the right starting point for asking whether the sail shifts it — but it is
  not a launch-quality targeting solution.
- **No lunar capture.** A sail of this class cannot supply the ~0.8 km/s of
  braking that lunar orbit insertion needs, and no such manoeuvre is modelled.
  The app reports *"Lunar orbit insertion not achieved"* rather than implying
  success.
- **Two-sided sail assumed optically identical** on both faces, which is not
  true of a real sail with a bare back surface.
- **Propellant mass is inert.** There is no thruster model in v1.
- **Single uniform time scale.** UTC, TT and TDB are not distinguished; the
  ~70 s maximum offset is far below the ephemeris error.
- **Mean-element resolution floor** of ~0.1% of the osculating peak-to-peak.

---

## Validation

`npm test` runs 299 tests across eight suites. Highlights:

- **Two-body conservation** — a circular orbit stays circular; energy and
  angular momentum hold to 2.4e-8 relative over 7 days (0.16 m of semi-major
  axis); the state closes to under 1 m after 20 exact revolutions.
- **J2 nodal regression** matches the analytic `-3/2 n J2 (Re/p)² cos i` to
  better than 1%.
- **J2 and J3 accelerations** are checked against a numerical gradient of the
  potential they claim to come from, at six positions — not against each
  other, which is how a sign slip survives.
- **Drag never does positive work** (`a · v < 0`) across 40 sampled states,
  altitudes and sail orientations. It is the only dissipative term in the
  model, so a sign error anywhere in the relative-velocity construction would
  show up as an orbit that gains energy.
- **Atmospheric density** matches the Vallado Table 8-4 values at nine band
  bases from 0 to 1000 km, falls monotonically to the cutoff, and drops by
  exactly 1/e over one scale height.
- **Earth infrared** reproduces the exact uniform-sphere result `M (Re/r)²` and
  keeps pushing in eclipse, where every other radiation term is zero.
- **Planetary ephemerides** match published semi-major axes and sidereal
  periods for all eight planets, obey Kepler's third law against the solar GM,
  stay between perihelion and aphelion over a century, and reproduce the Earth
  perihelion and aphelion distances *and dates*.
- **The β = 0.5 escape threshold** — a Sun-facing sail reduces effective solar
  gravity to `mu(1 - beta)`, so a circular orbit escapes at exactly β = 0.5.
  The suite builds sails either side of it and checks that one escapes and the
  other returns at the analytically predicted 2.5 AU apoapsis.
- **Heliocentric two-body conservation** holds the semi-major axis to 1e-10
  relative over a year, at a scale 24,000× the geocentric case.

> The Earth cross-check caught a **real bug**: the planetary elements are
> referred to the equinox of J2000 while the existing solar and lunar series
> work in the equinox of date, so the planets were rotated against the Sun by
> 0.7° by 2050 — 1.8 million km at 1 AU, and completely invisible in a
> trajectory plot.
- **Radiation pressure** — `P(1 AU) = 4.563 µN/m²`, exact inverse-square
  scaling, spot-checked at Venus and Mars distances.
- **Ideal-sail reduction** — the optical model collapses to `2 P A cos²α` with
  zero transverse force when `ρ = s = 1`.
- **Maximum transverse force at 35.26°**, found by brute-force scan.
- **Locally optimal steering** verified against a brute-force maximisation, not
  just against its own stationarity condition.
- **Eclipse fraction** matches the analytic `asin(Re/r)/π`.
- **Timestep convergence** — error falls by more than 8× per halving until it
  reaches round-off.
- **Ephemerides** checked against known astronomy: perihelion date, equinox
  declination, solstice declination equal to the obliquity, lunar
  perigee/apogee range, and the 5.30° lunar ecliptic-latitude limit.
- **Every scenario and preset** propagates without numerical failure, and the
  lunar transfer is verified to enter the lunar sphere of influence and to be
  measurably shifted by the sail.
- **Theming** — CSS/JS token parity, WCAG AA contrast for every text and
  notice pairing in both themes, and that the craft marker and trail stay
  legible against each scene background.

Bugs this suite caught during development, all now fixed: a left-handed VNB
triad, a sign error in the lunar latitude series (5.82° instead of the physical
5.30°), a lunar altitude floor that terminated a 100 km lunar orbit as an
impact, and a config loader that accepted a JSON array.

See [`docs/validation.md`](docs/validation.md) for the full error budget.

---

## Architecture

Physics, simulation, and UI are strictly separated. No React code appears in
`src/core` or `src/sim`, and no orbital mechanics appears in `src/ui`.

```
src/
├── core/                     Pure physics. SI units throughout.
│   ├── constants.ts          Physical constants, sourced and commented
│   ├── vec3.ts               3-vector helpers
│   ├── units.ts              The ONLY SI <-> display conversion layer
│   ├── orbital/              Elements, anomaly solvers, reference frames
│   ├── environment/          Time, Sun, Moon, planets, atmosphere, eclipse
│   ├── forces/               Gravity, J2/J3, SRP, drag, albedo, aggregator
│   ├── sail/                 Sail configuration and derived performance
│   ├── attitude/             Rule framework, optimal steering, expressions
│   └── integrator/           RK4 and Dormand-Prince 5(4)
├── sim/                      Mission definition and orchestration
│   ├── types.ts              SimulationConfig — the serialisable unit
│   ├── propagator.ts         Propagate-then-playback engine
│   ├── scenarios.ts          Scenario catalogue, lunar aiming heuristic
│   ├── presets.ts            Worked example missions
│   ├── analysis.ts           Mean elements, feasibility report
│   ├── sensitivity.ts        Parameter sweeps
│   └── exportData.ts         CSV / JSON
├── state/store.ts            Zustand — UI state and results only
└── ui/                       React. Panels, 3D/2D views, widgets.
```

Extension points that need no restructuring: the **integration centre** is
already switchable (the seam for a heliocentric frame), the **lunar ephemeris**
is behind a `MoonModel` switch (the seam for a JPL kernel), and an **attitude
rule** is added by extending one union type, one switch, and one editor.

### Dependencies

`react`, `three`, `plotly.js-basic-dist-min`, `zustand`. Nothing else at
runtime. Plotly's *basic* bundle is used rather than the full one (a third of
the size, and it contains everything needed). The Plotly React wrapper is
~50 lines written in-house rather than a dependency. Three.js is used
imperatively, without a React renderer for the scene graph.

Total bundle: ~625 KB gzipped, in three cacheable chunks.

---

## Documentation

| File | Contents |
| --- | --- |
| [`docs/physics.md`](docs/physics.md) | Constants, force model, derivations |
| [`docs/orbital-mechanics.md`](docs/orbital-mechanics.md) | Elements, frames, conversions |
| [`docs/solar-sail-model.md`](docs/solar-sail-model.md) | Full SRP derivation |
| [`docs/attitude-rules.md`](docs/attitude-rules.md) | Every steering law |
| [`docs/earth-model.md`](docs/earth-model.md) | Earth gravity, J2/J3, drag, albedo, eclipse |
| [`docs/interplanetary-model.md`](docs/interplanetary-model.md) | Heliocentric frame, planetary ephemerides, lightness number |
| [`docs/lunar-model.md`](docs/lunar-model.md) | Lunar ephemeris and assumptions |
| [`docs/validation.md`](docs/validation.md) | Test results and error budgets |
| [`docs/future-work.md`](docs/future-work.md) | Roadmap, incl. interplanetary |

The **Physics / Model** tab in the application shows the *active* model
configuration generated from the live config, so it can never drift out of date
with what is actually being computed.

---

## Roadmap and versioning

Planned work carries a **stable tag** — `ATM-MSIS`, `OPT-EVO`, `GRAV-J22` —
rather than a version tier. Tags are **unordered**: the next feature is
whichever one is most valuable at the time, not whichever is next in a list.
The full index, with the seam each item plugs into, is in
[`docs/future-work.md`](docs/future-work.md).

| Change | Bump |
| --- | --- |
| A feature — one tag lands | **MINOR** (1.3.0 → 1.4.0) |
| A bug fix or correction | **PATCH** (1.3.0 → 1.3.1) |
| A change that breaks saved configurations | **MAJOR** (1.x.y → 2.0.0) |

The major bump is tied to one concrete thing: whether `configFromJson` can
still migrate an old saved `SimulationConfig` forward. Drag, Earth radiation,
J3 and the entire heliocentric mode all shipped without breaking a saved file.

**Shipped so far** — `ATM-EXP` (sail-coupled atmospheric drag), `RAD-EARTH`
(Earth albedo and infrared), `GRAV-J3`, `UI-BUILDER` (one-screen mission
builder), `EPH-PLANETS` (planetary ephemerides), `FRAME-HELIO` (the Sun as an
integration centre), `VIZ-SCALE` (AU-scale visualisation).

**Largest open items** — `ATM-MSIS` (a real thermosphere model, now the
biggest uncertainty in any LEO result), `OPT-EVO` (trajectory optimisation),
`TRAJ-LAUNCH` (launch windows and arrival targeting), `TRAJ-SOI`
(sphere-of-influence patching), `EPH-JPL` (JPL lunar kernels).

Deliberately beyond scope, and tagged only because the original specification
named them: `PROP-TETHER`, `PROP-BEAMED`, `PROP-AIR`.

---

## References

- McInnes, C. R. *Solar Sailing: Technology, Dynamics and Mission
  Applications.* Springer, 1999.
- Vallado, D. A. *Fundamentals of Astrodynamics and Applications*, 4th ed.
  Microcosm Press, 2013.
- Macdonald, M. and McInnes, C. R. "Analytical Control Laws for Planet-Centred
  Solar Sailing." *Journal of Guidance, Control, and Dynamics*, 28(5), 2005.
- Meeus, J. *Astronomical Algorithms*, 2nd ed. Willmann-Bell, 1998.
- Dormand, J. R. and Prince, P. J. "A family of embedded Runge-Kutta formulae."
  *Journal of Computational and Applied Mathematics*, 6(1), 1980.

---

## License

MIT — see [LICENSE](LICENSE).
