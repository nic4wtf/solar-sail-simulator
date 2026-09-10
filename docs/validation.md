# Validation and error budget

`npm test` runs **299 tests** across eight suites. This document records what
they check, the measured numbers, and the resulting error budget.

| Suite | Tests | Covers |
| --- | --- | --- |
| [`conservation.test.ts`](../src/test/conservation.test.ts) | 10 | Two-body conservation, J2 secular rates, timestep convergence, element round-trips |
| [`srp.test.ts`](../src/test/srp.test.ts) | 24 | Radiation pressure, sail force law, orientation behaviour, eclipse geometry |
| [`attitude.test.ts`](../src/test/attitude.test.ts) | 33 | Reference frames, steering laws, schedule interpolation, expression parser |
| [`environment.test.ts`](../src/test/environment.test.ts) | 28 | Time conversions, solar and lunar ephemerides, gravity term magnitudes |
| [`perturbations.test.ts`](../src/test/perturbations.test.ts) | 49 | Atmosphere and drag, Earth albedo and infrared, J2/J3 against their potentials |
| [`interplanetary.test.ts`](../src/test/interplanetary.test.ts) | 71 | Planetary ephemerides, the heliocentric frame, the lightness-number escape threshold |
| [`scenarios.test.ts`](../src/test/scenarios.test.ts) | 36 | Every scenario and preset, orbit-raising behaviour, lunar transfer, export, sweeps |
| [`theme.test.ts`](../src/test/theme.test.ts) | 42 | CSS/JS palette parity, WCAG contrast in both themes, renderer palette validity |

---

## 1. Orbit conservation

With the sail and every perturbation disabled, a 500 km circular orbit is
propagated for 7 days with RK4 at a 15 s step (40,320 steps, 161,280
acceleration evaluations).

| Quantity | Measured | Tolerance |
| --- | --- | --- |
| Max eccentricity (started at 0) | < 1e-8 | 1e-7 |
| Relative range of semi-major axis | **2.35e-8** (= 0.16 m) | 1e-7 |
| Relative range of specific energy | **2.35e-8** | 1e-7 |
| Relative range of angular momentum | **1.17e-8** | 1e-7 |
| Inclination range | < 1e-9 rad | 1e-9 |
| RAAN deviation | < 1e-9 rad | 1e-9 |

The angular-momentum error is **exactly half** the semi-major axis error, as it
must be for a circular orbit where `h ∝ √a`. That internal consistency is a
useful check that the errors are genuine truncation rather than a bookkeeping
mistake.

This is ordinary fourth-order truncation drift: the local relative error per
step is about `(h/T)^5 = 1.3e-13`, and the observed total is within a small
factor of the step count times that.

### Closure test

The sharpest available end-to-end check: after **exactly 20 orbital periods**
the state vector must reproduce itself.

| Quantity | Measured | Tolerance |
| --- | --- | --- |
| Position closure after 20 revolutions | < 1 m | 1 m |
| Velocity closure | < 1e-3 m/s | 1e-3 m/s |

Over ~864,000 km of travelled arc.

---

## 2. J2 secular rates

The J2 nodal regression is compared against the analytic first-order secular
rate (Vallado eq. 9-37):

```
dOmega/dt = -(3/2) n J2 (Re/p)^2 cos(i)
```

Propagated for 5 days at a 10 s step, with the RAAN history unwrapped.
Agreement is better than **1%**, which is the meaningful bar since the analytic
expression is itself only a first-order approximation.

---

## 3. Timestep convergence

Same two-body configuration, 1 day, varying the fixed step.

| Timestep | Steps/revolution | Relative sma drift |
| --- | --- | --- |
| 80 s | ~71 | largest |
| 40 s | ~142 | ÷ >8 |
| 20 s | ~284 | ÷ >8 |
| 10 s | ~568 | ÷ >8 |

Each halving reduces the drift by more than a factor of 8 (fourth order
predicts 16) until round-off dominates. The test asserts the ratio only while
the drift exceeds 1e-13, since below that the improvement legitimately stops.

A grossly oversized step (600 s, ~9.5 steps/revolution) is asserted to degrade
the orbit by more than 1e-6 relative — this guards the timestep warning in the
Simulation panel, ensuring it warns about something real.

### Practical guidance

**RK4 accuracy is governed by steps per revolution, not by the step in
seconds.**

| Steps/revolution | Relative sma error over a week | Verdict |
| --- | --- | --- |
| ~570 | < 1e-10 | Excellent |
| ~380 | 2.4e-8 | Default. Fine for anything here. |
| ~95 | ~1e-8 to 1e-6 | Acceptable for a quick look |
| ~30 | ~1e-5 | Visibly wrong |
| < 30 | large | Unusable |

The Simulation panel warns below ~100 steps/revolution and errors below 30.

For **eccentric** orbits the binding constraint is periapsis, where the angular
rate exceeds the mean by `√(1+e)/(1−e)^1.5` — a factor of 10 at e = 0.74.
Above about e = 0.3 the adaptive integrator is the right choice.

### Adaptive integrator

On an e = 0.7 orbit with `relTol = 1e-11`, the Dormand-Prince 5(4) scheme holds
the semi-major axis to < 1e-8 relative and the eccentricity to < 1e-8 absolute
over 5 days, while varying its step by more than a factor of 3 along the orbit.

---

## 4. Mean versus osculating elements

**This is the most consequential numerical issue in the tool.**

Under J2, the *osculating* semi-major axis of the default 500 km LEO oscillates
by **12.7 km peak-to-peak**. The sail changes it by hundreds of metres over a
week. Differencing two osculating samples reports J2 geometry as sail
performance.

### Averaging performance

Measured over the default 7-day LEO run (4007 samples, 3968 mean points,
window 5670.3 s):

| Quantity | Osculating | Mean | Reduction |
| --- | --- | --- | --- |
| sma ripple (RMS 2nd difference) | 4.66e+2 | **3.46e-1** | **1348×** |
| ecc ripple | 1.05e-4 | **2.15e-7** | **485×** |
| sma range | 12,712 m | 913 m | — |
| ecc range | 1.65e-3 | 7.65e-6 | — |

The mean sma range of 913 m *is* the secular signal; the osculating range of
12,712 m is almost entirely J2 geometry.

### Why exact-endpoint integration is used

A boxcar average annihilates the J2 short-period terms only if the window is
**exactly** one period: the averaging kernel's sinc zeros sit at every integer
multiple of `1/P`, which is precisely where those terms live.

Snapping the window ends to the nearest recorded sample makes the effective
window length jitter by up to one output interval — 2.7% of a period in the
default LEO. That detunes the zeros and leaves a residual ripple of the same
order as the sail signal itself. An early implementation did exactly this, and
it inflated the measured 7-day Δsma from 901 m to 1400 m.

The implementation therefore builds an exact cumulative integral of the
piecewise-linear interpolant and evaluates it at interpolated endpoints — O(n)
setup, O(log n) per window, and no window-length error at all.

### Resolution floor

Averaging is not perfect: the window is the **median** osculating period, while
the true oscillation period drifts slightly under the perturbation. With the
sail disabled (where the true secular change in `a` is exactly zero, since J2
is conservative), the residual is:

| Quantity | Value |
| --- | --- |
| Spurious Δ(mean sma) over 7 days | **8.5 m** |
| As a fraction of osculating peak-to-peak | 0.07% |

The application estimates this floor conservatively as **0.1% of the osculating
peak-to-peak** (~12.7 m in LEO), reports it in the Results panel, and **warns
when a result falls within 3× of it** — because at that level neither the
magnitude nor the sign is trustworthy.

---

## 5. Radiation pressure

| Check | Expected | Result |
| --- | --- | --- |
| `P(1 AU)` | 4.563 µN/m² | ✅ matches to 3 dp |
| `P0 = W0/c` | identity | ✅ to 15 dp |
| Inverse-square scaling | `P(2 AU)/P(1 AU) = 0.25` | ✅ to 12 dp |
| At Venus (0.723 AU) | 8.73 µN/m² | ✅ |
| At Mars (1.524 AU) | 1.965 µN/m² | ✅ |

### Ideal-sail reduction

With `ρ = s = 1, τ = 0` the optical model must collapse to `2 P A cos²α n`.
Verified at α = 0, 15, 30, 35.264, 45, 60, 75, 89°:

- Force magnitude matches `2 P A cos²α` to 10 dp
- Force is purely along the normal (transverse component < 1e-14)
- At normal incidence, exactly `2 P A`

### Orientation behaviour

| Check | Result |
| --- | --- |
| Edge-on gives zero force | ✅ (< 1e-14) |
| Force decreases monotonically with tilt | ✅ over 0–89° |
| Maximum *transverse* force at 35.26° | ✅ found by 0.01° brute-force scan |
| A reversed normal is flipped, not thrust toward the Sun | ✅ |
| Reversing the tilt mirrors the transverse force | ✅ to 14 dp |
| Non-ideal force < ideal force at all angles | ✅ |
| Default normal-incidence coefficient | 1.816 (vs ideal 2.0) |
| Non-zero transverse force at oblique incidence | ✅ matches `PA cosα sinα (1−ρs−τ)` to 12 dp |
| Transmissivity strictly reduces force | ✅ |

### Characteristic acceleration

| Check | Expected | Result |
| --- | --- | --- |
| Ideal sail, 1 m²/kg | 9.13 µm/s² | ✅ |
| Linear in A/m | factor 2 for double area | ✅ to 12 dp |
| Lightness number 1 at A/m ≈ 650 m²/kg | β = 1 | ✅ |

---

## 6. Eclipse geometry

| Check | Result |
| --- | --- |
| Full sunlight on the sunward side | ✅ exactly 1 |
| Total eclipse directly behind the Earth | ✅ exactly 0 |
| Full sunlight well outside the shadow cylinder | ✅ exactly 1 |
| Penumbra ramp is monotonic across the terminator | ✅ over 400 samples |
| Eclipse fraction for a 500 km orbit, Sun in plane | matches analytic `asin(Re/r)/π` to 2 dp (≈ 35%) |
| Zero illumination gives zero force | ✅ |
| Partial illumination scales force linearly | ✅ to 12 dp |

---

## 7. Steering laws

| Check | Result |
| --- | --- |
| All four frames orthonormal | ✅ to 12 dp |
| All four frames **right-handed** (`e1 × e2 = e3`) | ✅ to 10 dp |
| Degenerate frame flagged for purely radial motion | ✅ |
| `α(θ=0) = 0` | ✅ |
| `α(θ=90°) = 35.2644°` | ✅ to 3 dp |
| `tan(θ−α) = 2 tan α` satisfied | ✅ to 8 dp at 8 values of θ |
| **Brute-force verification** that `α` maximises `cos²α cos(θ−α)` | ✅ over a 0.0005 rad scan at 7 values of θ |
| `α` monotonic in θ, bounded by 35.2645° | ✅ |
| Optimal normal lies in the `(u, d)` plane | ✅ to 12 dp |
| Steering efficiency 1 on-axis, 0.3849 perpendicular | ✅ |
| Schedule interpolation exact at knots, linear between, periodic | ✅ |
| Schedule handles unsorted knots, single knot, empty | ✅ |
| Time profiles respect their clamps | ✅ |
| Invalid expression falls back to Sun-facing and flags degenerate | ✅ |
| Optimal prograde beats Sun-facing at along-track force | ✅ (Sun-facing gives exactly zero when θ = 90°) |

### Expression parser

Precedence, right-associative `^`, unary minus binding, exponent notation, all
whitelisted functions, variable substitution, the documented examples, and
rejection of `window`, `alert(1)`, `process.exit`, malformed input, wrong
arity, and over-long input. Non-finite results degrade to 0.

---

## 8. Ephemerides

Checked against independently known astronomy rather than against another
implementation.

### Sun

| Check | Expected | Result |
| --- | --- | --- |
| Annual distance range | 0.9833–1.0167 AU | ✅ |
| Perihelion date | 2–5 January | ✅ within 10 days |
| Declination at March equinox | ~0° | ✅ < 0.2° |
| Right ascension at March equinox | ~0° | ✅ < 0.5° |
| Declination at solstices | ±23.44° | ✅ |
| Daily motion | 0.9856°/day | ✅ |
| Annual closure | < 0.1° after 365.2422 days | ✅ |

Stated accuracy: **~0.01°** in ecliptic longitude, ~2e-5 AU in range, over
1950–2050.

### Moon (series model)

| Check | Expected | Result |
| --- | --- | --- |
| Perigee distance | ~356,500 km | ✅ 355,000–362,000 km |
| Apogee distance | ~406,700 km | ✅ 403,000–408,000 km |
| Sidereal period closure | < 3° after 27.321661 days | ✅ |
| Max ecliptic latitude | **5.00–5.30°** | ✅ 5.0–5.4° |
| Orbital speed | ~1.022 km/s | ✅ 0.9–1.12 km/s |
| Velocity vs finite difference | < 0.01° direction, < 1e-4 magnitude | ✅ |

> The ecliptic-latitude test caught a **real bug**: the third latitude term must
> be `sin(M′ − F)`, not `sin(F − M′)`. With the wrong sign the pair
> `0.281 sin(M′+F) + 0.278 sin(F−M′)` becomes `≈ 0.557 sin F cos M′`, which
> *reinforces* the leading `5.128 sin F` term and pushes the peak lunar ecliptic
> latitude to **5.82°** — half a degree beyond anything physical. With the
> correct sign the pair is `≈ 0.557 cos F sin M′` and does not reinforce it.

Stated accuracy: **~150 km** position over 1950–2050.

### Moon (circular model)

Disagrees with the series model by up to **47,000 km**, as documented:
~21,000 km radially from ignoring the eccentricity, plus ~42,000 km along-track
from dropping the equation of the centre (`384,400 × sin 6.29°`).

The along-track contribution is the larger one, which is worth stating
explicitly because "ignores eccentricity → 21,000 km" understates the error by
more than a factor of two.

---

## 9. Gravity term magnitudes

| Check | Result |
| --- | --- |
| Surface gravity from Earth GM and radius | 9.798 m/s² ✅ |
| Inverse-square falloff | factor 4 for double radius ✅ to 10 dp |
| J2 / central in LEO, over the pole | 1e-3 to 4e-3 ✅ |
| J2 larger at the pole than the equator | ✅ |
| **Third-body acceleration vanishes at `r = 0`** | ✅ to 12 dp |
| Third-body grows ~linearly with `r` | 2.06× for double `r` ✅ (the 3% excess is the next order in `r/s`) |
| Lunar / solar tidal ratio at Earth | 1.5–3× ✅ (physical value ~2.2) |
| Lunar perturbation ratio, GEO vs LEO | > 100× ✅ (theory: `(42164/6878)³ = 230`) |

The `r = 0` test is the important one: it is the defining property of the
third-body formulation and the thing most easily got wrong by dropping the
indirect term.

### Zonal harmonics against their own potential

J2 and J3 are hand-derived closed forms. A sign slip in either is invisible
until it is checked against the potential it claims to come from, so both are
compared with a central-difference gradient of

```
U_n = -(mu/r) J_n (Re/r)^n P_n(z/r)
```

at six positions spanning equatorial, polar and general geometry.

| Check | Result |
| --- | --- |
| J2 acceleration = grad(U_2) | ✅ to 1e-6 relative (limited by the finite difference, not the formula) |
| J3 acceleration = grad(U_3) | ✅ to 1e-6 relative |
| J3 / J2 magnitude ratio in LEO | ✅ 1e-3 to 2e-2 (theory ≈ 4e-3) |
| J3 in-plane components vanish on the equator | ✅ exactly |
| J3 is antisymmetric about the equator | ✅ to 18 dp |

The J2 test is redundant with the code that already shipped — which is the
point. It pins the sign convention that the J3 derivation was matched against,
so the two cannot disagree silently.

---

## 9b. Atmospheric drag

### Density model

| Check | Result |
| --- | --- |
| Matches Vallado Table 8-4 at nine band bases, 0–1000 km | ✅ |
| Falls monotonically from the surface to the 2000 km cutoff | ✅ (400 samples) |
| Exactly zero above the cutoff, < 1e-16 kg/m³ just below it | ✅ |
| Drops by 1/e over one scale height inside a band | ✅ to 12 dp |
| Band-crossing scale-height residual | ✅ within 10% |
| Band-boundary continuity | ✅ ratio 0.7–1.4 across five boundaries |
| Solar activity leaves the troposphere untouched | ✅ exactly equal at 50 km |
| Solar activity multipliers apply in full above 200 km | ✅ ×3 and ×0.4 to 6 dp |

The cutoff test matters more than it looks: an abrupt truncation is only
acceptable if the density there is already irrelevant, otherwise it introduces
a genuine discontinuity in the dynamics.

### Drag force

| Check | Result |
| --- | --- |
| **Drag never does positive work** — `a · v < 0` | ✅ over 40 sampled states, altitudes and sail orientations |
| Broadside sail exposes bus + full sail area | ✅ to 6 dp |
| Edge-on sail exposes the bus only | ✅ to 6 dp |
| Attitude authority over the decay rate | ✅ > 50× (measured 101× at the defaults) |
| Matches the drag equation evaluated by hand at 400 km | ✅ to 20 dp |
| Co-rotation subtracts ω×r from the inertial velocity | ✅ 494 m/s at 400 km, 6% of orbital speed |
| Zero at GEO | ✅ exactly |

The work test is the global one. Drag is the only dissipative term in the
model, and a sign error anywhere in the relative-velocity construction would
show up as an orbit that gains energy — which is exactly what a plausible
trajectory plot would hide.

### Integration-level consequences

| Check | Result |
| --- | --- |
| A sail that raises a 500 km orbit **decays** once drag is on | ✅ +sma → −sma |
| Drag impulse exceeds sail impulse at 500 km | ✅ 9.19 vs 0.96 m/s over 7 days |
| A bigger sail decays faster (the deorbit-sail result) | ✅ |
| Drag diagnostics finite and bounded on every sample | ✅ |
| Drag impulse is monotonically non-decreasing | ✅ |
| GEO is bit-identical with drag on and off | ✅ to 6 dp |
| Drag and J3 refuse to act about the Moon | ✅ exactly zero |
| Every new term is exactly zero when toggled off | ✅ |

---

## 9c. Earth albedo and infrared

| Check | Result |
| --- | --- |
| Infrared matches `M (Re/r)²` exactly | ✅ to 18 dp |
| Infrared irradiance at 500 km | ✅ 206 W/m², handbook range 195–215 |
| **Infrared still acts in eclipse** | ✅ non-zero and radially outward on the night side |
| Albedo vanishes on the night side | ✅ < 1e-20 N/m² |
| Albedo irradiance over the subsolar point | ✅ 300–353 W/m² |
| Albedo falls monotonically from subsolar to terminator | ✅ |
| Phase factor hits its closed-form limits | ✅ 1, 2/3, 2/3π and 0 to 12 dp |
| Falls off as 1/r² | ✅ factor 4 for double distance |
| Negligible at lunar distance | ✅ < 1e-3 of the 1 AU sail acceleration |
| Zero beyond the 100-Earth-radius cutoff | ✅ exactly |
| Total flux at 500 km, as a fraction of direct sunlight | ✅ 30–50% |
| Momentum is purely radial | ✅ to 9 dp |

The eclipse test is the one worth keeping: the infrared term is the only force
in the whole model that is *on* precisely when the sail is supposedly doing
nothing, and any refactor that folds Earth radiation into the eclipse gate
would silently delete it.

---

## 10. Scenario-level integration

Every scenario (14) and every preset (7) is propagated and checked for finite
state, no numerical failure, and physically bounded sail acceleration.

### Orbit-raising behaviour

Measured with drag and Earth radiation **disabled**, because these tests are
about the steering law rather than the net LEO outcome. With drag on, the
100 m² / 100 kg default has a ballistic coefficient near 1 kg/m² and the
atmosphere swamps the signal being measured — a real result, asserted
separately in §9b, and noise here.

| Check | Result |
| --- | --- |
| Prograde steering raises the orbit | ✅ +2375 m |
| Retrograde steering lowers it | ✅ −2390 m |
| The two are near mirror images | ✅ 0.6% asymmetry |
| Doubling sail area doubles Δsma | ✅ |
| Quadrupling area quadruples Δsma | ✅ |
| No sail force → no secular change | ✅ 8.5 m, within the resolution floor |
| Dawn-dusk SSO is less eclipsed than 51.6° LEO | ✅ |
| GEO achieves a higher duty factor than LEO | ✅ |

The prograde/retrograde mirror symmetry is a strong global check: the geometry
is identical and only the sign of the target direction differs, so any
asymmetry beyond a few percent would indicate a directional bug.

### Lunar transfer

| Check | Result |
| --- | --- |
| Aiming produces apogee at the lunar distance | ✅ 355,000–410,000 km |
| Time of flight | ✅ 4–6 days |
| Perigee at the requested altitude | ✅ |
| **Enters the lunar sphere of influence** | ✅ (< 66,100 km) |
| Closest approach occurs after day 3, not at the start | ✅ |
| The sail measurably shifts the encounter | ✅ > 1 km with a 400 m²/50 kg sail |
| **Does not claim lunar capture** | ✅ `boundToMoonAtEnd = false` |

### Lunar orbit

A 100 km circular lunar orbit stays bound (negative energy at every sample),
never drops below the surface, and has a period of 100–140 minutes (physical
value ~118 min).

> This test caught a **real bug**: the 100 km altitude floor inherited from the
> Earth default equalled the orbit altitude, so the run terminated as an
> "impact" on the first perturbation. Lunar scenarios now use a 10 km floor.

### Export and configuration

- Every scenario round-trips losslessly through JSON
- Malformed configurations are rejected with useful messages (invalid JSON,
  arrays, unsupported version, missing fields)
- CSV has a commented provenance header, one row per sample, and a consistent
  column count on every row

> The array rejection test caught a **real bug**: `typeof [] === 'object'`, so a
> JSON array passed the object check and produced a confusing "unsupported
> version undefined" instead of a clear message.

### Sensitivity sweep

Sweeping area-to-mass from 1 to 8 m²/kg produces a monotonically increasing
Δsma with a ratio of 6–10× across an 8× parameter range — i.e. very nearly
linear, as expected while the response stays in the small-perturbation regime.

---

## 10b. Interplanetary

### Planetary ephemerides

Every check here is against astronomy, not against the code.

| Check | Result |
| --- | --- |
| Semi-major axis, all eight planets | ✅ within 0.1% of published |
| Sidereal period, all eight planets | ✅ within 0.2% of published |
| **Kepler third law against the solar GM** | ✅ `a³/P² = mu/4pi²` to 10 dp |
| Stays between perihelion and aphelion, 1950-2050 | ✅ |
| Speed obeys vis-viva | ✅ to 9 dp |
| Orbit plane inclination to the ecliptic | ✅ within 0.1° of published, all eight |
| **Positions are EQUATORIAL, not ecliptic** | ✅ Earth orbit normal sits 23.44° from the J2000 pole |
| Earth perihelion 0.9833 AU in early January | ✅ |
| Earth aphelion 1.0167 AU in early July | ✅ |
| Synodic period Earth-Mars 779.9 d, Earth-Venus 583.9 d | ✅ |
| Solar series Earth vs table Earth-Moon barycentre | ✅ < 60,000 km over 2000-2050 |

The equatorial check is the one that matters most and looks least important.
Dropping the ecliptic-to-equatorial rotation entirely would leave every
trajectory looking completely reasonable — it would simply be in the wrong
frame.

> The Earth cross-check caught a **real bug**. The planetary elements are
> referred to the equinox of J2000; `sun.ts` and `moon.ts` work in the equinox
> of date. Uncorrected, the planets rotate against the Sun and Moon by 0.7°
> over 2000-2050 — 1.8 million km at 1 AU. The check failed by a factor of
> thirty and nothing else in the suite noticed. Fixed by precessing the
> elements into the equinox of date; see
> [`interplanetary-model.md`](interplanetary-model.md) §2.

### The heliocentric frame

| Check | Result |
| --- | --- |
| Sun at the origin, mu and radius correct | ✅ |
| Earth at 1 AU, Moon beside it and not at the origin | ✅ |
| **Same planet, seen from the Sun and from the Earth, differs by exactly the Sun-Earth vector** | ✅ to 1e-9 AU |
| No planets computed unless asked | ✅ |
| The Earth is never double-counted as a perturbing planet | ✅ |

### Heliocentric propagation

| Check | Result |
| --- | --- |
| Semi-major axis of a 1 AU orbit over a year | ✅ < 1e-10 relative |
| Specific energy over a year | ✅ < 1e-10 relative |
| `sunDistance` equals `radius` with the Sun at the origin | ✅ to 1e-12 |
| Drag, J2 and J3 refuse to act about the Sun even when switched on | ✅ exactly zero |
| Radiation pressure scaled by r² is constant across a 150:1 range of solar distance | ✅ to 1e-9 |

### The lightness-number escape threshold

The single strongest check in the suite: it ties the ephemeris, the frame, the
SRP law, the attitude frame and the integrator together against a number that
can be derived on paper.

A Sun-facing sail reduces the effective gravitational parameter to
`mu(1 - beta)`, so a spacecraft on a circular orbit escapes when `beta >= 0.5`.

| Check | Result |
| --- | --- |
| The test rig builds a sail of exactly the requested beta | ✅ to 9 dp |
| beta = 0.7 escapes, reaching > 5 AU | ✅ positive final energy |
| beta = 0.3 stays bound | ✅ |
| beta = 0.3 apoapsis matches `2(1-beta)/(1-2beta) - 1 = 2.5 AU` | ✅ |
| beta = 0.3 returns to 1 AU periapsis | ✅ |

### Scenario-level behaviour

| Check | Result |
| --- | --- |
| Prograde steering spirals outward, retrograde inward | ✅ both sma and energy |
| Earth-to-Mars reaches Mars's orbital radius | ✅ 2.08 AU |
| ...and does NOT reach Mars | ✅ closest approach 2.2 AU, no SOI entry |
| Solar escape scenario escapes | ✅ final energy +150 MJ/kg |
| **A sail that cannot escape from 1 AU escapes after a close solar pass** | ✅ beta = 0.14, perihelion 0.089 AU, escaped |
| Cruise baseline holds sma flat, so later changes are attributable | ✅ < 1e-10 |
| Target distance recorded on every sample, and the summary minimum matches | ✅ |
| Target distance is infinite when no target is set | ✅ |

The Mars result is the honest one and is asserted as such: reaching an orbital
radius and reaching a planet are different achievements, and an unphased
departure gets the first without the second.

---

## 11. Summary error budget

| Source | Magnitude | Notes |
| --- | --- | --- |
| RK4 truncation, default settings | 2.4e-8 relative (0.16 m sma over 7 days) | Reduce the timestep if it matters |
| Mean-element resolution floor | ~0.1% of osculating peak-to-peak (~12 m in LEO) | **Usually the binding limit** |
| Solar ephemeris | ~0.01° direction | < 1e-4 relative force error |
| Lunar ephemeris (series) | ~150 km position | Dominates lunar closest-approach accuracy |
| Lunar ephemeris (circular) | ~47,000 km | Sensitivity checks only |
| Eclipse penumbra ramp | few % of a few seconds per revolution | Negligible |
| Time scale (UTC/TT/TDB conflation) | Sun 3e-4°, Moon ~35 km | Below the ephemeris error |
| Sail optical coefficients | not quantified | **Likely the largest real-world uncertainty** |
| Atmospheric density | factor of ~3 either way at 400–600 km | **Dominates every LEO drag result** |
| Albedo phase model | ~3% at full phase, tens of % near the terminator | Absolute flux there is a few percent of peak |
| Earth albedo field (single global mean) | up to a factor of 2 instantaneously | Much smaller after revolution averaging |
| Sail optical coefficients applied to thermal IR | not quantified | A fraction of a term that is itself a fraction |
| Planetary ephemerides | arcseconds (inner), < 1 arcmin (outer) | Negligible next to the sail model |
| Earth position, solar series vs planetary table | < 60,000 km over 2000-2050 | Bounds the one frame inconsistency the model accepts |
| Heliocentric departure idealisation | not quantifiable | No departure leg is modelled at all - see below |

**For LEO sail studies below about 600 km the atmosphere is now the binding
uncertainty**, and it is not close: a factor of three in density is a factor of
three in the decay rate, against a mean-element floor of tens of metres. Run
both solar-activity extremes and treat the spread as the answer.

Above the atmosphere, the mean-element resolution floor rather than the
integrator is what limits a result. For lunar work the ephemeris dominates. For
any comparison against a real mission, the optical coefficients and unmodelled
sail mechanics are almost certainly the largest error — which is why the tool
exposes every coefficient rather than burying them.

---

## 12. Theming

The palette is necessarily defined twice - as CSS custom properties for the
chrome, and as a TypeScript object for the three renderers that cannot read CSS
(WebGL, canvas 2D, Plotly). These tests stop the halves drifting apart.

| Check | Result |
| --- | --- |
| Both themes define every shared chrome token | OK |
| The light theme overrides every colour the dark theme defines | OK |
| No token is accidentally identical in both themes | OK |
| Primary and secondary text meet WCAG AA on the panel surface | OK, both themes |
| On-accent text is legible on the accent fill | OK, both themes |
| Every notice text colour is legible on its own tint | OK |
| Semantic vector colours are distinguishable from the panel | OK |
| Both renderer palettes define the same keys | OK |
| Every numeric colour is a valid 24-bit value | OK |
| Chart traces are legible against the panel surface | OK, both themes |
| Craft marker contrasts with the scene background (> 4:1) | OK |
| Trajectory trail contrasts with the scene background (> 2.5:1) | OK |

Rendered brightness was also measured end-to-end in a real browser, from a
screenshot of the 3D viewport:

| Theme | Mean viewport brightness |
| --- | --- |
| Light | 201.6 / 255 |
| Dark | 30.1 / 255 |

> Measuring this took a detour worth recording. The obvious approach - calling
> `gl.readPixels` on the WebGL canvas - returns **all zeros**, because Three.js
> creates its context with `preserveDrawingBuffer: false` and the buffer is
> gone by the time a test can read it. That silently made a "is the scene
> dark?" assertion pass for *both* themes while failing the light one. The
> check now decodes an actual screenshot instead.

## 13. Reproducing these numbers

```bash
npm test                              # all 299 tests
npx vitest run src/test/srp.test.ts   # one suite
npm run test:watch                    # watch mode
```

Measured baselines are recorded as comments in the test files themselves, so a
regression shows up as a failure rather than as a slightly different number
nobody notices.
