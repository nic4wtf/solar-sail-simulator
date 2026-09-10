# Interplanetary model

The heliocentric frame, the planetary ephemerides, and what a solar sail can
and cannot do once the Sun is the central body.

---

## 1. Why this was easy, and what that says about the architecture

The first release deliberately built three extension points and predicted that
interplanetary work would need only the first of them. That prediction held.
The work shipped as tags `EPH-PLANETS`, `FRAME-HELIO` and `VIZ-SCALE`.
Adding the heliocentric mode touched:

| File | Change |
| --- | --- |
| `environment/environment.ts` | `CentralBody` gains `'sun'`; a heliocentric branch |
| `environment/planets.ts` | New — the planetary ephemerides |
| `forces/forceModel.ts` | One `ForceToggles` field, one summation loop |
| `sim/scenarios.ts` | Six new scenarios |
| `viz/Scene3D.tsx`, `viz/View2D.tsx` | Scale switching, Sun and planets |

and **nothing at all** in the gravity, SRP, attitude or integrator code. Three
things already in place are the reason:

- **`sunToCraft(env, r)`** returns `r - r_sun`, which becomes simply `r` when
  the Sun sits at the origin. The SRP model needed no heliocentric branch
  because it never assumed a planet-centred frame in the first place.
- **`pressureAt(sail, r)`** was always `P0 (1 AU / r)²`, with no assumption
  that `r ≈ 1 AU`. At 0.1 AU it returns 100× the pressure, which is exactly
  what the close-solar-pass scenario needs.
- **Cone and clock angles** were always measured from the Sun line. The
  interplanetary parameterisation *is* the Sun-relative frame, so the steering
  laws transferred unchanged.

The one thing that did need real work was the visualisation, and the roadmap
said so.

---

## 2. Planetary ephemerides

Standish's *Keplerian Elements for Approximate Positions of the Major Planets*
(JPL Solar System Dynamics): six elements per planet plus a linear rate per
Julian century, for the 1800–2050 span. Position follows by solving Kepler's
equation and converting exactly as for any other orbit — the module reuses
`elementsToRv` rather than writing its own conversion, so the planets and the
spacecraft go through the same code.

Accuracy is a few arcseconds for the inner planets and under an arcminute for
the outer ones. For comparison, the sail force at 1 AU is uncertain at the 1%
level from the optical coefficients alone, so the ephemeris is nowhere near
the limiting error.

The UI warns when the mission epoch falls outside 1800–2050, because outside
that span the linear element rates are being extrapolated and the error grows
quadratically.

### The precession bug that the validation caught

The elements are referred to the **ecliptic and mean equinox of J2000**.
`sun.ts` and `moon.ts` are not: both evaluate apparent coordinates referred to
the equinox **of date**, which is the correct convention for the
low-precision series they implement.

The giveaway is in the rate constants. The solar series advances at
0.9856474 °/day — the *tropical* year, because its origin precesses. The
Standish table advances the Earth at 0.9856092 °/day — the *sidereal* year,
because its origin does not. The difference is the general precession in
longitude, 50.29 arcseconds a year.

Left alone that rotates the planets against the Sun and Moon by **0.7° over
2000–2050**, which is 1.8 million kilometres at 1 AU. It is completely
invisible in a trajectory plot: the result simply looks like a slightly
different launch date.

The fix is to precess the elements into the equinox of date before use, adding
the accumulated general precession `p_A = 5028.796″ T + 1.105″ T²` to the
node, the longitude of perihelion and the mean longitude *together*. Adding it
to all three rotates the orbit bodily about the ecliptic pole and leaves the
argument of perihelion and the mean anomaly untouched — which is what a change
of origin for longitudes must do. The conversion to equatorial axes then uses
the obliquity of date, matching the other two ephemerides.

> This was found by the cross-check in
> [`interplanetary.test.ts`](../src/test/interplanetary.test.ts) that compares
> the table's Earth against the solar series over fifty years. Without the
> correction it fails by a factor of thirty. Nothing else would have shown it.

### Why the Earth is not taken from the planetary table

The table's Earth row is the Earth–**Moon barycentre**, and the environment
already has an Earth: the solar series that every geocentric calculation in
the simulator has always used. Taking the Earth from a second source in
heliocentric mode would mean the Earth *jumped* by tens of thousands of
kilometres when the integration centre was switched.

So `earthHeliocentric()` negates the Earth→Sun vector and one Earth is used
everywhere. The barycentre row is still tabulated, and the validation suite
cross-checks the two — bounding the disagreement (under 60,000 km over
2000–2050) rather than hiding it.

---

## 3. The heliocentric frame

```
centre = 'sun'   →   mu = 1.327e20 m^3/s^2,  reference radius = R_sun
```

| Body | Where it comes from |
| --- | --- |
| Sun | The origin |
| Earth | `-sunState(jd).position`, the same solar series as every other frame |
| Moon | Earth position + the geocentric lunar vector |
| Planets | The Standish table, shifted into the frame in force |

Force terms behave as follows:

| Term | Heliocentric behaviour |
| --- | --- |
| Central gravity | The Sun |
| `sunGravity` | Disabled — the Sun is the central term, not a third body |
| `moonGravity` | Becomes the Earth **and** Moon as third bodies, summed separately |
| `planetGravity` | The configured planet list |
| J2, J3, drag | Never applied; they are Earth-surface terms |
| Earth albedo / infrared | Switch themselves off geometrically past 100 Earth radii |
| Eclipse | Still active, and not vacuous — a trajectory near the Earth crosses its shadow |

The Earth and Moon are summed **separately** rather than lumped at the
barycentre: the Moon is 4700 km from the barycentre and 384,400 km from the
Earth, and for a spacecraft passing near either one that difference is the
whole encounter.

### The departure, and what it is not

The interplanetary scenarios place the spacecraft **on the Earth's own
heliocentric orbit**, leading the Earth along track by 0.1 AU, optionally with
a hyperbolic excess velocity.

There is no departure hyperbola, no parking orbit, no launch-window search and
no C3 budget. The spacecraft simply appears on the Earth's orbit already
travelling at the given excess. That is the standard patched-conic
idealisation with the planet-centred leg deleted rather than solved, and it is
the right simplification for the question this tool asks: *what can the sail
do once it is out there* must not depend on a launch vehicle the tool does not
model. With zero excess velocity the spacecraft starts on the Earth's orbit
and every subsequent change is the sail and nothing else.

**Why along-track rather than "at the Earth".** Placing the spacecraft at the
Earth's position means placing it inside a singularity. Placing it one sphere
of influence away *radially* — the obvious patched-conic boundary — turns out
to be worse than it looks: with zero excess velocity the spacecraft is then
marginally bound to the Earth and spends the run in a quasi-satellite dance
that moves the osculating semi-major axis by 2.5% of an AU **with no sail
force at all**. Real physics, and a terrible baseline to measure a sail
against. Displacing along track instead puts the spacecraft on the Earth's
orbit exactly — same semi-major axis, eccentricity and period, apsides rotated
by the lead angle.

The Earth's gravity is **off by default** heliocentrically for the same
reason. The scenarios start on the Earth's orbit because that is where a
mission would leave from, but they do not model the departure, so the
spacecraft's proximity to the Earth at t = 0 is an artefact of the initial
condition rather than a fact about the mission. The toggle is there, and
switching it on is how to see the 0.4%-per-year co-orbital tug for yourself.

---

## 4. The lightness number

Out here `β` is the governing parameter, not the area-to-mass ratio:

```
beta = a_c / (mu_sun / AU^2)
```

Both the sail acceleration and solar gravity fall off as `1/r²`, so their
**ratio is the same everywhere**. A sail that cannot escape from 1 AU cannot
escape from 5 AU either; the geometry never improves.

### The β = 0.5 threshold

A sail held normal to the Sun line reduces the effective gravitational
parameter to `mu(1 - beta)`, because both terms are radial and both scale as
`1/r²`. A spacecraft on a circular orbit has `v² = mu/r`, and escapes the
reduced field when

```
v^2 >= 2 mu (1 - beta) / r     ->     mu/r >= 2 mu (1 - beta)/r     ->     beta >= 0.5
```

This is the cleanest available check of the whole heliocentric mode: it ties
the ephemeris, the frame, the SRP law, the attitude frame and the integrator
together against one number derivable on paper. The validation suite builds
sails at β = 0.7 and β = 0.3 and confirms that the first escapes and the
second is bound at the analytically predicted apoapsis

```
a' = r (1 - beta) / (1 - 2 beta)    ->    apoapsis = 2.5 AU for beta = 0.3
```

### What β actually costs

| β | Area-to-mass | Areal density for a 100 kg craft | Status |
| --- | --- | --- | --- |
| 0.0014 | 1 m²/kg | 1000 g/m² | The default LEO sail |
| 0.014 | 10 m²/kg | 100 g/m² | Around LightSail 2 |
| 0.14 | 100 m²/kg | 10 g/m² | The "high-performance sail" of the literature |
| 0.50 | 360 m²/kg | 2.8 g/m² | Solar escape without help |

The right-hand column is the honest one. Flown sails are around 10–30 g/m²
including structure, so β = 0.5 is not an engineering projection.

---

## 5. What the scenarios show

### Reaching an orbit is not reaching a planet

The Earth-to-Mars scenario reaches Mars's **orbital radius** in about 500 days
and comes nowhere near Mars — closest approach 2.2 AU. That is the honest
outcome of an unphased departure, and the Results panel reports the two facts
separately on purpose. Closing that gap is what a launch window is for, and
the Mission panel quotes the synodic period (2.14 years for Mars) so the
spacing of the opportunities is visible.

### Inward spirals accelerate

Spiralling inward needs the sail to push **retrograde**, removing orbital
energy — which a sail does perfectly well, because the force directions it can
reach span a cone about the anti-Sun line rather than just the outward radial.
The `1/r²` growth in pressure means an inward spiral accelerates as it goes,
and nothing in this model stops it: no arrival is modelled, so the Venus
scenario continues past Venus and would eventually reach the Sun.

### The close solar pass is an Oberth manoeuvre for sails

A β = 0.14 sail cannot escape from a circular 1 AU orbit. The same sail,
dropped to a 0.09 AU perihelion first, escapes easily — because the pressure
it works with there is 120× its value at Earth. Falling in and then sailing
out is the sail analogue of an Oberth burn, and it is the one manoeuvre where
a modest sail does something a large one cannot do from 1 AU.

**Nothing here models the thermal problem, which is the real obstacle.** No
sail material yet made survives 0.1 AU. The run floor stops at 5 solar radii,
below which the corona is dense and none of that is modelled either.

---

## 6. Visualisation scale

The planet-centred view works in units of 1000 km, so a LEO orbit and the
lunar distance share one depth buffer. Heliocentrically that breaks down —
1 AU would be 149,600 units next to a 6-unit Earth — so the scale switches
with the integration centre to units of 10⁶ km: 1 AU becomes 149.6 units and
the solar radius 0.696, the same dynamic range the Earth–Moon view already
handles.

Bodies are still *built* at the planetary scale and rescaled by a group
transform, so there is one set of geometry rather than two. The heliocentric
view adds the Sun (unlit — it is the light source, and shading it would draw a
terminator on the one object that cannot have one), a point light at the
origin, and Mercury, Venus, Mars and Jupiter with their orbit rings sampled
from the ephemeris itself rather than from idealised ellipses.

Both views frame to at least 1.6 AU heliocentrically, so a run that falls
short of Mars still shows Mars — otherwise there is no way to see that it fell
short.

---

## 7. Deliberately not implemented

- **Sphere-of-influence patching** (`TRAJ-SOI`). The simulator integrates in
  one frame throughout. When a trajectory enters a planet's SOI the Results
  panel says so and says explicitly that the heliocentric two-body formulation
  has stopped being the right one — it does not switch centres mid-run.
- **Launch and arrival targeting** (`TRAJ-LAUNCH`). No departure hyperbola, no
  B-plane, no porkchop plots. Targeting is a search problem and belongs with
  the trajectory optimiser (see [`future-work.md`](future-work.md)).
- **Arrival manoeuvres.** The sail never stops thrusting.
- **Solar thermal limits, coronal drag, and sail degradation**
  (`SAIL-THERMAL`, `SAIL-DEGRADE`) — the things that actually decide whether a
  close solar pass is possible.
- **Relativistic corrections**, which are measurable for Mercury and
  irrelevant here.
- **Planetary occultation of the Sun.** Eclipse is computed for the Earth and
  Moon only.

---

## References

1. Standish, E. M. *Keplerian Elements for Approximate Positions of the Major
   Planets.* JPL Solar System Dynamics.
2. McInnes, C. R. *Solar Sailing: Technology, Dynamics and Mission
   Applications.* Springer, 1999. Chapters 4–5.
3. Vallado, D. A. *Fundamentals of Astrodynamics and Applications*, 4th ed.
   Microcosm Press, 2013. Chapters 9 and 12.
4. IAU 2006 precession model (Capitaine, Wallace and Chapront, 2003).
