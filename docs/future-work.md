# Future work

What is deliberately out of scope, and how each item fits the existing
architecture.

The architectural point of this document is that none of it requires
restructuring. Each item names the specific seam it plugs into — and the
"Already shipped" section below is the evidence that the claim holds, because
each of those items went in through exactly the seam this document predicted.

---

## How this document is organised

Items carry a **stable tag** rather than a version number. Tags look like
`ATM-MSIS` or `OPT-EVO`: an area prefix and a short name, assigned once and
never reused.

This replaces the old `V1.x / V2 / V3 / V4` tiers, which implied an order that
was never real. Drag was tier `V2` and shipped before half of `V1.x`; the
whole `V3` interplanetary block shipped while `V2` remains untouched. A
numbered tier is a promise about sequence, and this project does not want to
make one — the next feature should be whichever one is most valuable at the
time, not whichever one is next in a list.

So: **tags are unordered and non-sequential.** Pick any item, in any order.
The area prefixes group related work; they carry no priority.

### Versioning

| Change | Bump | Example |
| --- | --- | --- |
| A feature — one tag from this document lands | **MINOR** | 1.3.0 → 1.4.0 |
| A bug fix, correction or doc-only change | **PATCH** | 1.3.0 → 1.3.1 |
| A change that breaks saved configurations | **MAJOR** | 1.x.y → 2.0.0 |

The major bump is tied to one concrete thing: the `version` field in a saved
`SimulationConfig`. As long as `configFromJson` can still migrate an old file
forward, the release is a minor or a patch, however large the feature. That
has held so far — drag, Earth radiation, J3 and the entire heliocentric mode
all shipped without breaking a single saved file, because each new field has a
documented default that reproduces the old behaviour.

Every release names the tags it contains in its git tag annotation, so
`git tag -l -n20` is the changelog.

---

## Tag index

### Shipped

| Tag | Item | Released |
| --- | --- | --- |
| `ATM-EXP` | Piecewise-exponential atmosphere and sail-coupled drag | 1.1.0 |
| `RAD-EARTH` | Earth albedo and infrared radiation pressure | 1.1.0 |
| `GRAV-J3` | J3 zonal harmonic | 1.1.0 |
| `UI-BUILDER` | One-screen mission builder | 1.2.0 |
| `EPH-PLANETS` | Planetary ephemerides (Standish elements) | 1.3.0 |
| `FRAME-HELIO` | Sun as an integration centre, planets as third bodies | 1.3.0 |
| `VIZ-SCALE` | Scale switching in the 3D and 2D views | 1.3.0 |

### Open

| Tag | Item | Rough size |
| --- | --- | --- |
| `ATM-MSIS` | A real thermosphere model (NRLMSISE-00 / JB2008) | Large |
| `ATM-DIURNAL` | Diurnal density bulge | Small |
| `ATM-LIFT` | Free-molecular lift on the sail | Medium |
| `ATM-CD` | Angle-dependent drag coefficient | Small |
| `GRAV-J22` | Sectorial harmonic and geostationary longitude drift | Medium |
| `EPH-JPL` | JPL kernels for the lunar ephemeris | Large |
| `ECL-EXACT` | Exact two-disc eclipse overlap integral | Small |
| `SAIL-SPECTRAL` | Wavelength-dependent reflectivity | Medium |
| `SAIL-ANGLE` | Angle-dependent optical coefficients | Small |
| `SAIL-TWOSIDED` | Distinct front and back optical properties | Small |
| `SAIL-BILLOW` | Billow and wrinkling shape model | Large |
| `SAIL-THERMAL` | Sail thermal model instead of assumed equilibrium | Medium |
| `SAIL-DEGRADE` | Optical degradation over the mission | Small |
| `ATT-DYNAMICS` | Attitude dynamics, slew rates, control authority | Medium |
| `OPT-EVO` | Evolutionary trajectory optimisation | Large |
| `OPT-DIRECT` | Direct-transcription optimisation | Large |
| `OPT-INDIRECT` | Indirect (Pontryagin) optimisation | Large |
| `TRAJ-TARGET` | Target orbit and constraint handling | Medium |
| `TRAJ-LAUNCH` | Departure and arrival targeting, launch windows | Large |
| `TRAJ-SOI` | Sphere-of-influence patching | Large |
| `FLEET-MULTI` | Multiple spacecraft and formation flying | Medium |
| `PERF-WORKER` | Web Worker propagation | Small |
| `SOL-CYCLE` | Solar flux variation over the solar cycle | Small |
| `PROP-TETHER` | Electrodynamic tethers | Large |
| `PROP-BEAMED` | Beamed-energy propulsion | Large |
| `PROP-AIR` | Atmosphere-breathing propulsion | Large |

---

## Already shipped

| Tag | Went in as | Cost |
| --- | --- | --- |
| `ATM-EXP` | one `ForceToggles` field, one block in `evaluateForces`, one new `environment/atmosphere.ts` | ~250 lines + 25 tests |
| `RAD-EARTH` | two `ForceToggles` fields, one `forces/albedo.ts`, sharing the flat-plate law with SRP | ~190 lines + 13 tests |
| `GRAV-J3` | one function in `forces/gravity.ts`, one toggle | ~30 lines + 11 tests |
| `EPH-PLANETS` + `FRAME-HELIO` + `VIZ-SCALE` | one `CentralBody` variant, one `environment/planets.ts`, one `ForceToggles` field, and a scale switch in the two views | ~700 lines + 71 tests |

The drag prediction was right about the physics and wrong about the scale of
the consequence. It said LEO results were "incomplete" without drag. They were
not incomplete — for a large sail they had **the wrong sign**. The default
500 km scenario went from +901 m of semi-major axis over a week to −15.4 km,
with the atmosphere removing ten times the impulse the sail supplied. That
reversal is now the most instructive thing the tool shows in LEO, and it is
why drag ships on by default rather than as an option.

The interplanetary prediction held almost exactly. Adding the heliocentric
mode changed the environment, added an ephemeris, added one force toggle and
rewrote the view scale — and touched **nothing** in the gravity, SRP, attitude
or integrator code, for the three reasons this document had named:
`sunToCraft` already returned the right vector, `pressureAt` already scaled as
`1/r²` with no assumption about `r`, and cone/clock angles were always
Sun-relative.

The one thing the prediction missed was a frame bug. The planetary elements
are referred to the equinox of J2000; `sun.ts` and `moon.ts` work in the
equinox of date. Left uncorrected, that rotates the planets against the Sun
and Moon by 0.7° over 2000–2050 — invisible in any trajectory plot, and caught
only by a cross-check that compared the two Earths against each other.

Details in [`earth-model.md`](earth-model.md) §6–§8 and
[`interplanetary-model.md`](interplanetary-model.md).

---

## The seams that already exist

Three extension points were built into the first release specifically to carry
future work:

| Seam | Where | Enables |
| --- | --- | --- |
| **Switchable integration centre** | `CentralBody` in [`environment.ts`](../src/core/environment/environment.ts) | `FRAME-HELIO` — shipped |
| **Pluggable ephemeris** | `MoonModel` in [`moon.ts`](../src/core/environment/moon.ts) | `EPH-JPL`, and `EPH-PLANETS` — shipped |
| **Attitude rule union** | `AttitudeConfig` in [`types.ts`](../src/core/attitude/types.ts) | `OPT-*` — any new steering law, including optimiser output |

Adding a force term means adding one field to `ForceToggles` and one block to
`evaluateForces`. Adding a scenario means adding one entry to the `SCENARIOS`
array. A fourth seam has since proved itself: `atmosphericDensity(altitude,
activity)` is the same shape as `MoonModel` and is what `ATM-MSIS` plugs into.

---

## Atmosphere

### `ATM-MSIS` — a real thermosphere model

Drag ships, but on a **static** density model: a 28-band exponential fit with
a blunt solar-activity multiplier. That model is now the largest single
uncertainty in every LEO result the tool produces — larger than the
integrator, the mean-element floor and the sail optical coefficients combined.
A factor of three in density is a factor of three in the decay rate.

Needs: NRLMSISE-00 or JB2008, driven by F10.7 and Ap indices. Both are
substantial ports, and both need index data the tool would have to embed or
fetch — which collides with the no-backend constraint, so a fitted or
tabulated subset is the realistic route.

Fits as: a new variant behind `atmosphericDensity(altitude, activity)`. The
drag force code does not change at all, and neither does anything upstream of
it.

### `ATM-DIURNAL` — the diurnal bulge

Density peaks around 14:00 local solar time and is a factor of ~2 lower at
night. Needs only the Sun direction, which the environment already supplies,
and would put a once-per-revolution ripple on the drag that a static model
completely misses. The best value per line of anything in this document.

### `ATM-LIFT` — free-molecular lift

A flat plate in free-molecular flow develops a force perpendicular to the
wind. For a sail — a flat plate by definition, and one under attitude control
— this is a **steerable** force that the current model discards entirely.
Needs an accommodation-coefficient model.

### `ATM-CD` — angle-dependent drag coefficient

Currently a single free-molecular constant of 2.2, referred to the projected
area.

---

## Gravity field

### `GRAV-J22` — sectorial harmonics and geostationary drift

J3 ships (off by default). J22 is the remaining one worth having: it drives
geostationary longitude drift toward the stable points at 75.3°E and 104.7°W,
and would matter for the GEO scenarios over months.

It is the first term in the model that is not axially symmetric, so unlike
every zonal it needs the spacecraft position in an **Earth-fixed** frame —
hence Greenwich sidereal time, which `environment/time.ts` does not currently
compute. That is the whole cost: a GMST function, a rotation in and out, and
the sectorial gradient.

---

## Ephemerides and geometry

### `EPH-JPL` — JPL kernels for the Moon

Replace the truncated analytic series with DE440 or similar, read from a
binary kernel or a fitted Chebyshev representation.

Fits as: a new `MoonModel` variant. Nothing else changes — the ephemeris is
reached only through `moonPosition(jd, model)`.

This would improve lunar closest-approach accuracy from ~150 km to metres, and
is a prerequisite for any quantitative lunar work. The planetary ephemerides
that shipped with `EPH-PLANETS` are already better than the lunar one, which
makes this the weakest link in the geometry.

### `ECL-EXACT` — exact eclipse geometry

Replace the linear penumbra ramp with the exact two-disc overlap integral, and
add atmospheric refraction and limb darkening. Currently worth a few percent
of a few seconds per revolution, so low priority.

### `SOL-CYCLE` — solar flux variation

The solar constant varies ~0.1% over the solar cycle, and more at specific
wavelengths. Currently a fixed selectable constant.

Worth noting the asymmetry now that drag ships: the same solar cycle that
moves the solar constant by 0.1% moves thermospheric density by a factor of
several. For a LEO sail the cycle matters enormously — through the atmosphere,
not through the sunlight.

---

## Sail model

### `SAIL-SPECTRAL` — wavelength-dependent reflectivity

Integrated over the solar spectrum rather than using a single broadband
coefficient. Now more pressing than it was: with Earth infrared modelled, the
sail's visible-band coefficients are being applied to 10 µm thermal radiation,
where a real aluminised sail behaves differently. `flatPlateForce` already
takes the pressure and the source direction as arguments, so a per-band
coefficient set would slot in at the call site.

### `SAIL-ANGLE` — angle-dependent coefficients

Real reflectivity varies with incidence angle, which the flat-coefficient
model ignores.

### `SAIL-TWOSIDED` — distinct front and back optical properties

Both faces are currently assumed identical; a real sail has a bare back. The
`flipped` flag in `SrpResult` already marks when the back face is illuminated,
so the hook is there.

### `SAIL-BILLOW` — billow and wrinkling

A shape model rather than a flat plate.

### `SAIL-THERMAL` — thermal model

For the emission term, instead of assuming equilibrium.

### `SAIL-DEGRADE` — degradation over the mission

UV and atomic-oxygen exposure reducing reflectivity over months to years. A
time-dependent `SailConfig`. More pressing since the interplanetary scenarios
landed: those run for years, where a real sail's optical properties would
measurably decay.

---

## Attitude and control

### `ATT-DYNAMICS` — attitude dynamics and control authority

The commanded attitude is currently achieved instantaneously and exactly. A
real sail has a large moment of inertia and slews slowly.

This matters for the default feathering schedule specifically: it demands
rapid attitude changes at its switch points, and a real sail might not achieve
them. Modelling slew rate limits would show how much of the predicted
performance survives.

---

## Optimisation and targeting

The tool currently evaluates a *given* steering law. Everything in this
section is about searching for one instead, and it is the largest coherent
block of unbuilt work.

All three optimiser tags fit the same way: a new module alongside
`sensitivity.ts`, which already contains the machinery for running many
configurations and extracting a scalar metric. **An optimiser is a sweep with
a search strategy instead of a grid.** The `optimalDirection` rule already
provides the locally optimal reference solution to beat.

### `OPT-EVO` — evolutionary methods

Differential evolution or genetic algorithms over a parameterised steering
law. Well suited here because the parameter space is already defined (schedule
knots, cone/clock angles) and evaluating a candidate is exactly one
`propagate()` call. The natural first optimiser.

### `OPT-DIRECT` — direct methods

Discretise the control history and solve the resulting nonlinear program.

### `OPT-INDIRECT` — indirect methods

Pontryagin's principle with the sail's control constraint, which is the
classical approach for solar sails.

### `TRAJ-TARGET` — target orbit and constraint handling

"Reach a 1000 km circular orbit in minimum time" rather than "run for 30 days
and report what happened". Needs a target specification, a cost function, and
constraint handling (minimum altitude, eclipse duration limits, slew-rate
limits).

### `TRAJ-LAUNCH` — departure and arrival targeting

Departure hyperbola, arrival B-plane, launch windows and porkchop plots.

This is the gap the interplanetary scenarios currently report rather than
close: the Mars spiral reaches Mars's orbital radius and misses Mars by 2.2 AU,
because nothing phases the departure. The Results panel says so explicitly and
the Mission panel quotes the synodic period. Closing it is a **search**
problem, which is why it belongs here with the optimisers rather than with the
interplanetary work that shipped.

### `TRAJ-SOI` — sphere-of-influence patching

The simulator integrates in one frame throughout. When a trajectory enters a
planet's sphere of influence the Results panel says so, and says explicitly
that the heliocentric formulation has stopped being the right one — but it
does not switch centres mid-run.

Doing it properly means either a patched-conic state handover (with the
discontinuity that implies) or a full n-body formulation, and it is only worth
having once there is an arrival manoeuvre to hand over *to*.

---

## Scale and performance

### `FLEET-MULTI` — multiple spacecraft and formation flying

Would need the store to hold an array of results rather than one, and the 3D
view to render several trajectories. The comparison-run machinery already
stores several results side by side, so the store half is largely there.

### `PERF-WORKER` — Web Worker propagation

The propagator yields to the event loop every 20,000 steps, which keeps the UI
responsive but still competes with rendering. Moving propagation to a Worker
would let a sensitivity sweep run at full speed while the 3D view animates.

The propagate-then-playback design already makes this straightforward: the
Worker boundary is a `SimulationConfig` in and a `SimulationResult` out, both
of which are plain serialisable data. Not done originally because the
complexity was not yet justified — a 7-day run takes 0.7 s. The interplanetary
scenarios weaken that argument: a 2500-day escape run takes about 5 s.

---

## Other propulsion concepts

Well beyond the scope of a solar-sail tool, listed because the original
specification mentioned them. These would arguably be better served by a
separate tool; the sail force model and the propagation core would be
reusable.

- **`PROP-TETHER`** — electrodynamic tethers. Needs a geomagnetic field model
  and an ionospheric plasma model.
- **`PROP-BEAMED`** — laser or microwave sails. The sail force model would
  largely carry over with a different, steerable source, but the beam pointing
  and diffraction problem is new.
- **`PROP-AIR`** — atmosphere-breathing propulsion. Needs the atmosphere model
  (`ATM-EXP`, shipped) plus an intake and thruster model.

---

## Deliberately not planned

Things that would change the character of the tool rather than extend it.
These get no tag, because they are not going to be built.

- **A backend.** Everything runs client-side, which is what makes the project
  deployable as static files and forkable without infrastructure. A 7-day run
  takes 0.7 s in the browser; there is nothing a server would usefully do.
- **User accounts or saved sessions.** Configurations serialise to JSON files,
  which is enough and requires no infrastructure.
- **Real-time telemetry ingestion.** This is a design tool, not an operations
  tool.
- **Certified flight-dynamics accuracy.** The fidelity statement is honest and
  meeting it would mean a different, much larger project — and one where
  established tools (GMAT, STK, Orekit) already exist. This tool's value is
  being immediately usable and transparent about its own limits.

---

## Contributing

Each item above names the seam it plugs into. Before adding a force term, an
ephemeris, or a steering law, read the corresponding section of
[`physics.md`](physics.md), [`earth-model.md`](earth-model.md),
[`lunar-model.md`](lunar-model.md),
[`interplanetary-model.md`](interplanetary-model.md) or
[`attitude-rules.md`](attitude-rules.md) — each ends with a short note on how
to extend it.

Any new physics needs a validation test that checks it against something
independent: an analytic limit, a known astronomical fact, a conservation law,
or a numerical gradient of the potential it claims to come from. Every real
bug caught in this project so far was caught that way (see
[`validation.md`](validation.md)), and none of them would have been visible by
looking at a plausible-looking trajectory.

When an item lands:

1. Move its tag from **Open** to **Shipped** in the index above, with the
   release it went out in.
2. Replace its section with what it actually cost and what it changed —
   especially where the prediction here turned out to be wrong. The two
   corrections recorded above are the most useful paragraphs in this document.
3. Bump the MINOR version, and name the tag in the git tag annotation.
