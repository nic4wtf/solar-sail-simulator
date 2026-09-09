# Lunar model

Lunar dynamics, the ephemeris, and every assumption behind it.

Implementation: [`src/core/environment/moon.ts`](../src/core/environment/moon.ts).

---

## 1. Lunar ephemeris

Two selectable fidelity levels. Having two is partly architectural: the
`MoonModel` switch is the seam where a real ephemeris (a JPL DE kernel, or
SPICE) would be added without touching the force model.

### 1.1 Series model (default)

Truncated ELP2000 trigonometric series, from Meeus, *Astronomical Algorithms*,
Ch. 47, abridged.

**Fundamental (Delaunay) arguments**, with `d` = days since J2000:

```
L' = 218.3164477 + 13.17639648 d     Moon mean longitude
D  = 297.8501921 + 12.19074912 d     mean elongation Moon-Sun
M  = 357.5291092 +  0.98560028 d     Sun mean anomaly
M' = 134.9633964 + 13.06499295 d     Moon mean anomaly
F  =  93.2720950 + 13.22935024 d     argument of latitude
```

**Ecliptic longitude** [deg]:

```
lambda = L' + 6.289 sin M'          equation of the centre
            + 1.274 sin(2D - M')    evection
            + 0.658 sin(2D)         variation
            + 0.214 sin(2M')
            - 0.186 sin M           annual equation
            - 0.114 sin(2F)
            + 0.059 sin(2D - 2M')
            + 0.057 sin(2D - M - M')
            + 0.053 sin(2D + M')
            + 0.046 sin(2D - M)
            - 0.041 sin(M - M')
            - 0.035 sin D
            - 0.031 sin(M + M')
```

**Ecliptic latitude** [deg]:

```
beta = 5.128 sin F
     + 0.281 sin(M' + F)
     + 0.278 sin(M' - F)          <-- note the argument order
     + 0.173 sin(2D - F)
     + 0.055 sin(2D - M' + F)
     + 0.046 sin(2D - M' - F)
     + 0.033 sin(2D + F)
     + 0.017 sin(2M' + F)
```

> **A trap worth flagging.** The third term is `sin(M′ − F)`, **not**
> `sin(F − M′)`. The pair
>
> ```
> 0.281 sin(M' + F) + 0.278 sin(M' - F)  ~=  0.557 cos(F) sin(M')
> ```
>
> does *not* reinforce the leading `5.128 sin F` term. With the sign flipped it
> becomes `≈ 0.557 sin(F) cos(M′)`, which *does*, pushing the peak lunar
> ecliptic latitude to **5.82°** — half a degree beyond anything physical, since
> the lunar orbital inclination only oscillates between 5.00° and 5.30°.
>
> This was a real bug in an early version of this file, caught by the
> ecliptic-latitude bound test in
> [`environment.test.ts`](../src/test/environment.test.ts).

**Geocentric distance** [km]:

```
Delta = 385000.56
      - 20905.355 cos M'
      -  3699.111 cos(2D - M')
      -  2955.968 cos(2D)
      -   569.925 cos(2M')
      +   246.158 cos(2D - 2M')
      -   204.586 cos(M - M')
      -   170.733 cos(2D + M')
      -   152.138 cos(2D + M - M')
      -   129.620 cos D
      +   108.743 cos(D + M')
```

The spherical `(λ, β, Δ)` is converted to ecliptic rectangular coordinates and
then rotated into equatorial axes by the mean obliquity of date.

**Accuracy: ~150 km in position** over 1950–2050 (about 0.02° in longitude).

### 1.2 Circular model

Circular orbit at the mean distance, in a plane inclined 5.145° to the
ecliptic, with the regression of the ascending node:

```
L'   = 218.3164477 + 13.17639648 d       mean longitude
node = 125.0445479 -  0.0529539  d       ascending node (18.6 yr regression)
u    = L' - node                         argument of latitude
r    = 384,400 km                        fixed
```

**Accuracy: up to ~47,000 km in position.** Two contributions, and the second
is the larger:

| Source | Magnitude |
| --- | --- |
| Ignoring the eccentricity (0.0549) | ~21,000 km **radially** |
| Dropping the equation of the centre (6.29°) | `384,400 × sin 6.29°` ≈ **42,000 km along-track** |

It is worth being explicit about this because "ignores eccentricity →
21,000 km" understates the total error by more than a factor of two. The model
is offered for **sensitivity checks** — to see how much an answer depends on the
ephemeris — not for quantitative lunar work.

### 1.3 Lunar velocity

Obtained by a central finite difference of the analytic position over ±60 s.
Truncation error is ~1e-5 m/s, negligible against the ephemeris error itself,
and it avoids differentiating the series by hand. Verified against an
independent finite difference to < 0.01° in direction.

---

## 2. Documented lunar assumptions

| Quantity | Value | Notes |
| --- | --- | --- |
| Moon GM | 4.9048695e12 m³/s² | DE430 |
| Mean radius | 1737.4 km | Sphere; no shape model |
| Mean semi-major axis | 384,400 km | |
| Mean eccentricity | 0.0549 | Series model only |
| Inclination to the **ecliptic** | 5.145° | Not to the Earth equator |
| Sidereal period | 27.321661 days | |
| Node regression period | 18.6 years | Retrograde |
| Apsidal precession period | 8.85 years | Included via the series arguments |
| Sphere of influence radius | 66,100 km | Used for encounter detection |

### Not modelled

- **Lunar gravity harmonics.** The Moon is a point mass. Its J2 is 2.03e-4 —
  about a fifth of the Earth's — and for a low lunar orbit it is a significant
  perturbation. This is the main reason the lunar-orbit scenario should not be
  used for quantitative low-lunar-orbit lifetime work.
- **Lunar libration and physical orientation.** Irrelevant to a point-mass
  model, but it means no surface-relative geometry is available.
- **Lunar mascons.**
- **Earth-Moon barycentre motion.** The Earth is treated as the ECI origin
  rather than the barycentre, which displaces things by ~4670 km. This is
  consistent within the model — the third-body formulation handles the
  accelerating origin correctly — but a comparison against barycentric
  ephemerides needs the offset applied.

---

## 3. Reference frames

**Both** the Earth-centred (ECI) and Moon-centred (MCI) frames use **J2000
equatorial axes**: X toward the J2000 vernal equinox, Z along the Earth mean
rotation axis. They differ **only in origin**.

This matters and is easy to misread: **lunar orbital elements in this tool are
relative to the Earth equator**, not the lunar equator and not the ecliptic. A
"90° inclination" lunar orbit is polar with respect to the Earth's equator, not
the Moon's. Published lunar orbit parameters are usually given in a
Moon-equator or Moon-mean-Earth frame and will not compare directly.

### Integration centre

The centre is configurable per scenario:

| Centre | Central term | Third bodies |
| --- | --- | --- |
| `earth` | Earth GM | Moon, Sun |
| `moon` | Moon GM | Earth, Sun |

The third-body formulation includes the indirect (inertial) term, so the
accelerating central-body frame is handled correctly in both cases. See
[`physics.md`](physics.md) §2.2.

**Which to use.** For a transfer, integrate about the **Earth** — the Earth
dominates for most of the trajectory. For a lunar orbit, integrate about the
**Moon** — integrating a 100 km lunar orbit in ECI would put a ~2000 km orbit
on top of a 384,000 km position vector, losing about four significant digits to
cancellation.

---

## 4. Earth → Moon transfer

### The aiming heuristic

Reaching the Moon requires the departure ellipse to have its apogee where the
Moon *will be*, which is a targeting problem. The implementation uses a
**geometric fixed-point iteration**, not an optimiser:

1. Guess the time of flight as half the period of an ellipse with apogee at the
   mean lunar distance.
2. Look up where the Moon will be at that time.
3. Set the apogee radius to that lunar distance; re-derive the period.
4. Repeat. Converges in three or four passes, because the lunar distance varies
   by only ±5.5% over a month.

Then:

- The **apsidal line** is placed along the predicted lunar direction — apogee at
  the Moon, perigee opposite.
- The **transfer plane** is chosen to contain the lunar orbital angular
  momentum, so the encounter is coplanar with the Moon's motion.
- The spacecraft starts at **perigee** with the vis-viva perigee speed.

For a 400 km perigee this gives a ~5 day transfer with apogee near 384,000 km
(e ≈ 0.966).

### What it is and is not

It **reliably delivers an encounter inside the lunar sphere of influence**,
which the validation suite asserts. That is the right starting point for the
question the tool actually asks: *does the sail measurably shift the
encounter?* — which it also asserts (> 1 km shift for a 400 m²/50 kg sail).

It is **not** a launch-quality targeting solution. There is no B-plane
targeting, no optimisation of the arrival conditions, no correction manoeuvres,
and no attempt to hit a specific periselene altitude.

### Lunar capture is not achieved, and is not claimed

Lunar orbit insertion needs roughly **0.8 km/s** of impulsive braking at
periselene. A solar sail of this class produces micronewtons: the impulse
budget over a 5-day transfer is of order **1 m/s**, three orders of magnitude
short.

The simulator therefore reports **"Lunar orbit insertion not achieved"**
whenever the final state is not bound to the Moon, which is essentially always.
A test asserts this explicitly, so no future change can quietly start claiming
success.

When the final state *does* have negative Moon-relative energy, the wording is
still cautious, because the test is an energy check at one instant and nothing
more:

- No insertion manoeuvre was modelled.
- The Earth tide is a large perturbation at lunar distance.
- The lunar ephemeris is a truncated analytic series.

The capture test uses the Moon-relative state at the **final** time — not, as an
early version did, the relative speed at closest approach, which is a different
quantity.

---

## 5. Lunar dynamics: what actually matters

Approximate perturbation ratios for a 100 km circular lunar orbit:

| Effect | Ratio to lunar central gravity |
| --- | --- |
| Lunar J2 (**not modelled**) | ~2e-4 |
| Earth third body | ~1e-5 |
| Sun third body | ~5e-8 |
| Sail at 1 m²/kg | ~3e-6 |

**The unmodelled lunar J2 is the largest perturbation there.** That is stated
plainly because it means low-lunar-orbit results from this tool are qualitative:
the real orbit's periselene would evolve under J2 in ways this model cannot
show. The Earth tide, which *is* modelled, is the second largest and is enabled
by default in lunar scenarios.

For a **transfer**, the ordering is different: Earth gravity dominates until
close to the Moon, and the sail has 5 days of continuous action, so the sail's
integrated effect on the arrival geometry is readily visible even though its
instantaneous ratio is small.

---

## 6. Visualisation

The 3D view renders the lunar orbit as a reference path sampled from the
**actual ephemeris** in use over one sidereal month — so it shows the real
plane and eccentricity being integrated, not an idealised circle.

Camera targets: Earth, Moon, spacecraft, or free. The Moon target is disabled
when lunar gravity is off and the trajectory stays near the Earth, since there
is nothing to look at.

In a Moon-centred run the lunar orbit path is not drawn: the Moon is at the
origin and its own orbit is not a meaningful thing to display.

---

## 7. Upgrading the ephemeris

The seam is deliberate and narrow. To add a JPL DE kernel:

1. Add a variant to `MoonModel` in `moon.ts`.
2. Implement it behind the existing `moonPosition(jd, model)` signature.
3. Add the label and accuracy string to `MOON_MODEL_LABELS` /
   `MOON_MODEL_ACCURACY`.

Nothing in the force model, the propagator, the attitude rules or the UI needs
to change — the ephemeris is reached only through that one function. The same
applies to planetary ephemerides for interplanetary work; see
[`future-work.md`](future-work.md).

---

## References

1. Meeus, J. *Astronomical Algorithms*, 2nd ed. Willmann-Bell, 1998. Ch. 47.
2. Chapront-Touzé, M. and Chapront, J. "ELP 2000-85: a semi-analytical lunar
   ephemeris adequate for historical times." *Astronomy and Astrophysics*, 190,
   1988.
3. Vallado, D. A. *Fundamentals of Astrodynamics and Applications*, 4th ed.
   Microcosm Press, 2013. §5.3, §12.
4. Parker, J. S. and Anderson, R. L. *Low-Energy Lunar Trajectory Design.*
   JPL Deep Space Communications and Navigation Series, 2014.
