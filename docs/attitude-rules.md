# Attitude rules (steering laws)

How the sail is pointed. This is the most consequential choice in the whole
tool: the same sail on the same orbit can raise it, lower it, or do nothing
at all depending only on the steering law.

Implementation: [`src/core/attitude/`](../src/core/attitude/).

---

## 0. Why this matters more than the sail

Measured in the default 500 km LEO, 1 m²/kg sail, 7 days, using
revolution-averaged elements:

| Steering law | Δ(mean sma) | Impulse spent | Duty factor |
| --- | --- | --- | --- |
| Locally optimal prograde | **+2375 m** | 1.83 m/s | 36.5% |
| Feathering schedule | **+901 m** | 0.96 m/s | 19.2% |
| Constant Sun-facing | −11 m | **3.16 m/s** | **63.0%** |
| Constant radial (pitch 0) | −8 m | 1.20 m/s | 23.9% |
| Naive ±35° schedule | −699 m | 1.04 m/s | 20.7% |
| Constant 35° pitch | −948 m | 1.37 m/s | 27.3% |

The **constant Sun-facing** row is the one to study. It has the highest
instantaneous acceleration of any law here — a 63% duty factor, more than three
times the feathering schedule — and it spends the most impulse, 3.16 m/s. It
changes the orbit by **eleven metres**.

Three of the six laws *lower* the orbit.

### The reason: a sail can only push away from the Sun

Over one revolution of a planet-centred orbit, the along-track component of an
anti-sunward push is prograde for roughly half the orbit and retrograde for the
other half. A **constant** attitude therefore nets out to nearly zero no matter
how much force it generates.

Producing a secular change requires **breaking that symmetry**, and there are
only two ways to do it:

1. **Feathering** — turn the sail edge-on (zero projected area, zero force)
   through the unfavourable half, and to a working angle through the favourable
   half. This throws away half the available impulse but what remains is
   one-sided.
2. **Continuous re-solving** — at every instant, point the sail so as to
   maximise the force component along the direction you want. This is the
   locally optimal law, and it does better still.

---

## 1. Reference frames

Every rule works through one shared function that returns an explicit
orthonormal **right-handed** triad in inertial coordinates, and reports which
frame it used. Frames are never implicitly mixed.

Convention, identical in every frame so the angles mean the same thing
whichever you pick:

```
n = cos(a2) [ cos(a1) e1 + sin(a1) e2 ] + sin(a2) e3
```

so `a1 = a2 = 0` gives `n = e1`.

### RSW (orbital)

| Axis | Direction |
| --- | --- |
| `R` = e1 | radial, outward |
| `S` = e2 | along-track (`W × R`; equals the velocity direction for a circular orbit) |
| `W` = e3 | orbit normal (along the specific angular momentum) |

Zero angles point the sail normal **radially outward**. A positive first angle
("pitch") tilts it toward the direction of motion — the classic sail pitch for
orbit raising.

### VNB

| Axis | Direction |
| --- | --- |
| `V` = e1 | velocity |
| `B` = e2 | bi-normal, `N × V` |
| `N` = e3 | orbit normal |

Zero angles point the normal **along the velocity vector**, which a sail often
cannot achieve — the reported incidence angle makes that visible, and the sail
will be flipped.

> **Handedness note.** `B` is deliberately `N × V` and *not* the `V × N` some
> references use. With `V × N` the triad `(V, B, N)` satisfies `e1 × e2 = −e3`,
> i.e. it is **left-handed**, and a positive second angle would then tilt the
> sail toward `−N` here while tilting it toward `+W` in RSW. A test asserts
> right-handedness for all four frames; it caught exactly this bug during
> development. The consequence of the choice is that `B` points radially
> *inward* for a prograde circular orbit.

### Sun-relative (cone / clock)

| Axis | Direction |
| --- | --- |
| `u` = e1 | Sun → spacecraft |
| `p` = e2 | orbit normal, projected perpendicular to the Sun line |
| `q` = e3 | `u × p` |

Parameterised as **cone** and **clock** rather than as a spherical pair:

```
n = cos(cone) e1 + sin(cone) [ cos(clock) e2 + sin(clock) e3 ]
```

- **cone = 0** — sail faces the Sun squarely. Maximum force, zero transverse
  component.
- **cone = 90°** — sail edge-on. **Zero projected area, zero force.** This is
  feathering.
- **clock** selects the azimuth about the Sun line: 0 tilts the normal toward
  the orbit normal, 90° tilts it within the orbit plane.

If the Sun line happens to be parallel to the orbit normal, the clock reference
degenerates and the code falls back to an arbitrary but continuous
perpendicular, flagging `degenerate`.

### Inertial

Right ascension and declination in the J2000 equatorial frame. The commanded
direction is fixed in inertial space and takes no account of the Sun, so the
sail feathers and flips as the orbit carries it around. Mostly useful as a
diagnostic.

---

## 2. Rule 1 — Fixed attitude

Constant angles in the chosen frame. Parameters: two angles.

Useful as a baseline and for understanding the geometry. Rarely produces a
large secular change, for the reason in §0.

---

## 3. Rule 2 — Time-based

```
angle(t) = initial + rate x t     clamped to [min, max]
```

Three profiles:

- **ramp** — linear, clamped at the limits and held there
- **triangle** — linear, reflecting at the limits (a triangle wave)
- **sine** — sinusoid sweeping the `[min, max]` band, starting from `initial`

The second angle is held constant. `rate` is entered per day in the UI and
stored in rad/s.

---

## 4. Rule 3 — Orbit-fraction schedule

A table of knots indexed by orbital phase, linearly interpolated, **wrapping**
from the last knot back to the first so the command is continuous and periodic.

```
Phase | Cone angle
------|-----------
0.00  |  90 deg   (feathered)
0.45  |  90 deg
0.55  |  35 deg   (working)
0.95  |  35 deg
```

This is the **default rule** and the shape above is the default schedule.

### Phase variable

Which "orbital phase" means is selectable, and the choice matters:

| Variable | Measured from | Use for |
| --- | --- | --- |
| **True anomaly** | periapsis | Changing eccentricity. Undefined for a perfectly circular orbit. |
| **Argument of latitude** | ascending node | Always well defined, including circular orbits. Safe default. |
| **Mean anomaly** | periapsis, uniform in time | Equal fractions are equal *time* intervals rather than equal swept angle. |
| **Sun phase** | the Sun direction projected into the orbit plane | **Solar sailing.** Tracks where the spacecraft is relative to the incoming sunlight, which is what actually governs energy change. |

`sunPhase` is defined as `atan2(s·S, s·R)` where `s` is the spacecraft→Sun
direction and `(R, S)` the RSW in-plane axes. Phase 0 is local noon (Sun
radially overhead); the anti-sunward push is **prograde** for phase in
(0.5, 1.0), which is why the default schedule works there and feathers
elsewhere.

Using `argLat` instead of `sunPhase` for a feathering schedule produces a
schedule that is periodic in the *orbit* but not in the *Sun geometry*, so its
effect drifts to zero over weeks as the orbit plane precesses relative to the
Sun. That is a real trap and the reason the phase variable is exposed at all.

---

## 5. Rule 4 — Sun-relative

Fixed cone and clock angles. Shares the Sun-frame implementation with Rule 1
but is presented separately because cone/clock is the natural parameterisation
for solar sailing and deserves its own defaults and labels.

For an ideal sail the force scales as `cos²(cone)`, which the panel reports as
a percentage of maximum.

---

## 6. Rule 5 — Locally optimal thrust direction

**Problem.** Given the Sun line `u` and a desired thrust direction `d`, which
sail normal `n` maximises the force component along `d`?

For an ideal sail the force is `2 P A cos²(α) n`, so with `θ` the angle between
`u` and `d`, and `α` the angle from `u` to `n` measured in the `(u, d)` plane,
maximise

```
g(alpha) = cos^2(alpha) cos(theta - alpha)
```

Setting `dg/dα = 0`:

```
-2 cos(alpha) sin(alpha) cos(theta - alpha) + cos^2(alpha) sin(theta - alpha) = 0
```

Dividing by `cos α` (non-zero for an illuminated sail) gives the compact
stationarity condition

```
tan(theta - alpha) = 2 tan(alpha)
```

**Notable values:**

| θ | α |
| --- | --- |
| 0° | 0° |
| 45° | 21.6° |
| **90°** | **35.264°** |

The 35.264° result is the classical maximum-transverse-force angle: the force
magnitude falls as `cos²α` while its transverse projection grows as `sin α`,
and the product peaks well before 45°.

### Solution method

No closed form exists for general `θ`, so the condition is solved by bisection
on

```
alpha in ( max(0, theta - 90deg), min(theta, 90deg) )
```

The interval is bounded by `cos α > 0` (the sail must be illuminated) and
`cos(θ − α) > 0` (the projection onto `d` must be positive). The residual
`sin(θ−α)cos α − 2 sin α cos(θ−α)` is positive at the lower end and negative at
the upper, so bisection converges unconditionally. 60 iterations take the
interval below double precision.

The validation suite checks this against a **brute-force scan** of the
objective, not merely against its own stationarity condition.

### Available directions

Prograde, retrograde, radial outward, radial inward, orbit normal,
anti-orbit-normal.

### Caveats

This is **locally** optimal — greedy at each instant, with no regard for where
it leaves the orbit later. It is the correct reference for *"how fast could
this sail change this orbit"*, not a globally optimal transfer. Global
optimisation is v2 work (see [`future-work.md`](future-work.md)).

The angle is derived from the **ideal** force law and then applied to the
non-ideal optical sail as well. That is standard practice: the transverse
component of a real sail shifts the true optimum by only a degree or two, far
less than the error from the law being instantaneous rather than global.

---

## 7. Rule 6 — Custom equation

Two user-supplied formulae, for the two steering angles, in **degrees**.

### Not `eval`

Configurations are shareable as JSON, so `eval` or `new Function` would let a
pasted config execute arbitrary code. Instead there is a hand-written
recursive-descent parser over a fixed grammar with a whitelist of names:

```
expr    := term (('+' | '-') term)*
term    := unary (('*' | '/' | '%') unary)*
unary   := ('+' | '-') unary | power
power   := primary ('^' unary)?          right-associative
primary := number | ident | ident '(' args ')' | '(' expr ')'
```

Expressions compile **once** into a closure tree and are cached by source text,
so a propagation evaluating the rule 250,000 times parses nothing.

Non-finite results (division by zero, `sqrt(-1)`) degrade to 0 rather than
propagating NaN into the integrator. An invalid formula falls back to a
Sun-facing normal and flags the run as degenerate.

### Available variables

`t`, `tDays`, `tHours`, `nu`, `u`, `M`, `sunPhase`, `orbitFraction`, `sma`,
`ecc`, `inc`, `raan`, `argp`, `alt`, `r`, `vel`, `period`, `sunAngle`,
`betaAngle`. Angles in degrees, lengths in km, speeds in km/s.

### Functions

`sin cos tan asin acos atan sinh cosh tanh exp log log10 sqrt abs sign floor
ceil round deg rad`, plus `atan2 pow min max mod` (two arguments) and
`clamp if` (three).

There are no comparison operators, so `if(x - 5, a, b)` means "if x > 5".

### Examples

```
if(sunPhase - 180, 35, 90)        the feathering schedule as a formula
35 + 20 * sin(2 * pi * tDays)     smooth sweep, once per day
35 * sin(rad(nu))                 pitch proportional to true anomaly
if(abs(betaAngle) - 20, 0, 90)    feather when the beta angle is unfavourable
```

---

## 8. Adding a rule

1. Add a variant to `AttitudeConfig` in
   [`types.ts`](../src/core/attitude/types.ts)
2. Add a case to `evaluateAttitude` in
   [`rules.ts`](../src/core/attitude/rules.ts)
3. Add an editor branch in
   [`AttitudePanel.tsx`](../src/ui/panels/AttitudePanel.tsx)

Nothing else changes. The rule receives `AttitudeInput` (time, state, Sun
direction, osculating elements, `mu`) and returns a unit normal plus metadata.
It must be pure and cheap — it is called at every stage of every step.

---

## References

1. McInnes, C. R. *Solar Sailing.* Springer-Praxis, 1999. §4.4.
2. Macdonald, M. and McInnes, C. R. "Analytical Control Laws for
   Planet-Centred Solar Sailing." *Journal of Guidance, Control, and
   Dynamics*, 28(5), 2005.
3. Coverstone, V. L. and Prussing, J. E. "Technique for Escape from
   Geosynchronous Transfer Orbit Using a Solar Sail." *Journal of Guidance,
   Control, and Dynamics*, 26(4), 2003.
