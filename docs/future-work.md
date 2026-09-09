# Future work

What is deliberately out of scope for v1, and how each item fits the existing
architecture. Nothing here is implemented.

The architectural point of this document is that none of it requires
restructuring. Each item names the specific seam it plugs into.

---

## The seams that already exist

Three extension points were built into v1 specifically to carry future work:

| Seam | Where | Enables |
| --- | --- | --- |
| **Switchable integration centre** | `CentralBody` in [`environment.ts`](../src/core/environment/environment.ts) | Heliocentric frame, hence all interplanetary work |
| **Pluggable ephemeris** | `MoonModel` in [`moon.ts`](../src/core/environment/moon.ts) | JPL kernels, planetary ephemerides |
| **Attitude rule union** | `AttitudeConfig` in [`types.ts`](../src/core/attitude/types.ts) | Any new steering law, including optimiser output |

Adding a force term means adding one field to `ForceToggles` and one block to
`evaluateForces`. Adding a scenario means adding one entry to the `SCENARIOS`
array.

---

## V1.x — near-term, within the current model

### Atmospheric drag

**The most valuable single addition.** Below ~600 km drag dominates the sail
force, so LEO results are currently incomplete (see
[`earth-model.md`](earth-model.md) §6).

Needs: an atmosphere density model (NRLMSISE-00 is the standard; a simple
exponential or Jacchia-Roberts model would be a reasonable first cut), a
drag coefficient and drag area for the spacecraft, and the co-rotating
atmosphere velocity — which is why `EARTH_ROTATION_RATE` is already in
`constants.ts`.

Fits as: one more term in `evaluateForces`, one more `ForceToggles` field.

The interesting coupling is that the **sail itself is the drag area**, and it
changes with attitude — the same `cos α` projection that sets the sail force
sets the drag area. A feathered sail has low drag; a Sun-facing sail at low
altitude has enormous drag. That coupling is what makes deorbit sails work and
would make this addition genuinely instructive rather than merely more
accurate.

### Earth albedo and infrared radiation pressure

Reflected sunlight (~30% of direct flux at the sub-satellite point) and thermal
emission (~240 W/m² at the surface). Both are few-percent effects on a sail in
LEO. Infrared does **not** vanish in eclipse, which makes it qualitatively
different from albedo.

Needs: a view-factor integral over the visible Earth disc, and an
albedo/emission model. The existing eclipse code already computes the geometry
needed for the view factor.

### Higher-order gravity harmonics

J3 is already defined in `constants.ts` but not applied. J22 drives
geostationary longitude drift and would matter for the GEO scenarios over
months.

### Web Worker propagation

Currently the propagator yields to the event loop every 20,000 steps, which
keeps the UI responsive but still competes with rendering. Moving propagation
to a Worker would let a sensitivity sweep run at full speed while the 3D view
animates.

The propagate-then-playback design already makes this straightforward: the
Worker boundary is a `SimulationConfig` in and a `SimulationResult` out, both
of which are plain serialisable data. Deliberately not done in v1 because the
complexity was not yet justified — a 7-day run takes 0.7 s.

### Solar flux variation

The solar constant varies ~0.1% over the solar cycle, and more at specific
wavelengths. Currently a fixed selectable constant.

---

## V2 — better models and optimisation

### JPL ephemerides

Replace the truncated analytic series with DE440 or similar, read from a binary
kernel or a fitted Chebyshev representation.

Fits as: a new `MoonModel` variant. Nothing else changes — the ephemeris is
reached only through `moonPosition(jd, model)`.

This would improve lunar closest-approach accuracy from ~150 km to metres, and
is a prerequisite for any quantitative lunar work.

### Eclipse refinement

Replace the linear penumbra ramp with the exact two-disc overlap integral, and
add atmospheric refraction and limb darkening. Currently worth a few percent of
a few seconds per revolution, so low priority.

### Sophisticated sail optical models

- **Wavelength-dependent** reflectivity, integrated over the solar spectrum
  rather than using a single broadband coefficient.
- **Angle-dependent** coefficients — real reflectivity varies with incidence
  angle, which the flat-coefficient model ignores.
- **Distinct front and back optical properties.** V1 assumes both faces are
  identical; a real sail has a bare back. The `flipped` flag in `SrpResult`
  already marks when the back face is illuminated, so the hook is there.
- **Billow and wrinkling** — a shape model rather than a flat plate.
- **Thermal model** for the emission term, instead of assuming equilibrium.

### Trajectory optimisation

The largest single addition, and the natural next step after v1.

Currently the tool evaluates a *given* steering law. Optimisation would search
for one:

- **Direct methods** — discretise the control history and solve the resulting
  nonlinear program.
- **Evolutionary methods** — differential evolution or genetic algorithms over
  a parameterised steering law. Well suited here because the parameter space is
  already defined (schedule knots, cone/clock angles) and evaluating a
  candidate is exactly one `propagate()` call.
- **Indirect methods** — Pontryagin's principle with the sail's control
  constraint, which is the classical approach for solar sails.

Fits as: a new module alongside `sensitivity.ts`, which already contains the
machinery for running many configurations and extracting a scalar metric. An
optimiser is a sweep with a search strategy instead of a grid.

The `optimalDirection` rule already provides the locally optimal reference
solution to beat.

### Target orbit and constraint handling

"Reach a 1000 km circular orbit in minimum time" rather than "run for 30 days
and report what happened". Needs a target specification, a cost function, and
constraint handling (minimum altitude, eclipse duration limits, slew-rate
limits).

### Attitude dynamics and control authority

V1 achieves the commanded attitude instantaneously and exactly. A real sail has
a large moment of inertia and slews slowly.

This matters for the default feathering schedule specifically: it demands rapid
attitude changes at its switch points, and a real sail might not achieve them.
Modelling slew rate limits would show how much of the predicted performance
survives.

---

## V3 — interplanetary

**Explicitly out of scope for v1.** This is the largest planned expansion, and
the groundwork is deliberately in place.

### What already supports it

- **Switchable integration centre.** `CentralBody` would gain a `'sun'`
  variant. The environment already returns body positions relative to a
  configurable origin.
- **Heliocentric-distance-dependent SRP.** `pressureAt(sail, r)` already scales
  as `1/r²` with no assumption that `r ≈ 1 AU`. The validation suite already
  spot-checks Venus and Mars distances.
- **Sun-relative attitude frame.** Cone and clock angles are already the
  natural interplanetary parameterisation, and the locally optimal steering law
  is already frame-agnostic.
- **Lightness number.** Already computed and displayed, and it is the governing
  parameter for heliocentric sailing.

### What remains

1. **Planetary ephemerides** — VSOP87 or a JPL kernel. Plugs into the same seam
   as the lunar ephemeris.
2. **Heliocentric frame option** — a `'sun'` central body, plus planets as
   third bodies.
3. **Sphere-of-influence patching** — switching the integration centre mid-run
   at SOI boundaries, or moving to a full n-body formulation.
4. **Launch and arrival targeting** — departure hyperbola, arrival B-plane,
   launch windows and porkchop plots.
5. **Scale handling in the visualisation** — the 3D view works in units of
   1000 km, which is right for Earth-Moon space and wrong for 1 AU. It would
   need a switchable scale, or a logarithmic one.

### Concepts this would enable

Venus and Mars transfers, solar escape, Solar-Oberth-like manoeuvres (a close
solar pass where `1/r²` gives enormous acceleration), non-Keplerian displaced
orbits, and artificial equilibrium points — all of which are genuinely
interesting for sails and none of which make sense in Earth orbit.

### Also V3

- **Multiple spacecraft** and formation flying. Would need the store to hold an
  array of results rather than one, and the 3D view to render several
  trajectories.
- **Sail degradation** over the mission — UV and atomic-oxygen exposure
  reducing reflectivity over months to years. A time-dependent `SailConfig`.
- **Flexible and deformable sail dynamics** — a structural model coupled to the
  force model, which is a substantially harder problem than everything else on
  this list.

---

## V4 — other propulsion concepts

Well beyond the scope of a solar-sail tool, listed because the specification
mentioned them:

- **Electrodynamic tethers** — needs a geomagnetic field model and an
  ionospheric plasma model.
- **Beamed-energy propulsion** — laser or microwave sails. The sail force model
  would largely carry over with a different, steerable source, but the beam
  pointing and diffraction problem is new.
- **Atmosphere-breathing propulsion** — needs the atmosphere model from V1.x
  plus an intake and thruster model.

These would arguably be better served by a separate tool. The sail force model
and the propagation core would be reusable.

---

## Deliberately not planned

Things that would change the character of the tool rather than extend it:

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
[`physics.md`](physics.md), [`lunar-model.md`](lunar-model.md) or
[`attitude-rules.md`](attitude-rules.md) — each ends with a short note on how
to extend it.

Any new physics needs a validation test that checks it against something
independent: an analytic limit, a known astronomical fact, or a conservation
law. Four real bugs in v1 were caught that way (see
[`validation.md`](validation.md)), and none of them would have been visible by
looking at a plausible-looking trajectory.
