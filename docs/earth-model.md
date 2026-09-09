# Earth model

Earth gravity, oblateness, eclipse, and the progression of fidelity across
versions.

---

## 1. Version progression

The specification asked for a staged build-up. Where v1 actually landed:

| Effect | Planned | Status in v1 |
| --- | --- | --- |
| Earth point-mass gravity | V1 | **Implemented** |
| Solar radiation pressure | V1 | **Implemented** (non-ideal optical sail) |
| Solar gravity | V1 | **Implemented**, toggleable |
| J2 perturbation | V1.x | **Implemented and on by default** |
| Eclipse | V2 | **Implemented and on by default** |
| Atmospheric drag | V2 | Not implemented |
| Earth albedo | V2 | Not implemented |
| Earth infrared radiation pressure | V2 | Not implemented |

Two effects were pulled forward from later versions, both deliberately:

**J2** because it is ~1e-3 of the central acceleration in LEO — roughly a
thousand times larger than any other harmonic — and it drives the nodal
regression and apsidal rotation that visibly shape a sail trajectory over
weeks. Leaving it out would have made the LEO scenarios qualitatively wrong.

**Eclipse** because in a 500 km orbit the spacecraft is shadowed for ~35% of
every revolution. Omitting it overstates the available sail impulse by about a
third, so the headline feasibility numbers — the entire point of the tool —
would have been wrong.

Both remain toggleable so their cost can be measured directly.

---

## 2. Earth constants

| Quantity | Value | Source |
| --- | --- | --- |
| GM | 3.986004418e14 m³/s² | EGM2008 / WGS-84 |
| Equatorial radius | 6 378 137 m | WGS-84 |
| Mean radius | 6 371 008.8 m | Reported but not used in dynamics |
| J2 | 1.08262668e-3 | WGS-84 / EGM96 |
| J3 | −2.53265649e-6 | Defined but **not applied** in v1 |
| Sidereal rotation rate | 7.2921159e-5 rad/s | Defined but unused |
| Obliquity at J2000 | 23.4392911° | IAU |

Altitudes are referenced to the **equatorial** radius, which is the convention
that makes "500 km orbit" mean what users expect. This differs from a
mean-radius reference by up to 7 km at the poles.

The rotation rate is unused because no Earth-rotation-dependent effect is
modelled — no drag, no albedo, no ground tracks. It is retained for when drag
arrives, since drag needs the co-rotating atmosphere velocity.

---

## 3. Point-mass gravity

```
a = -mu r / |r|^3
```

Surface acceleration from these constants is 9.798 m/s², which the validation
suite checks.

---

## 4. J2 oblateness

```
k   = -(3/2) J2 (mu/r^2) (Re/r)^2
a_x = k (1 - 5 z^2/r^2) x/r
a_y = k (1 - 5 z^2/r^2) y/r
a_z = k (3 - 5 z^2/r^2) z/r
```

Vallado eq. 8-38. Requires an Earth-**equatorial** frame, which the ECI
integration frame is. The force model refuses to apply this term when the
integration centre is the Moon, and the checkbox is disabled there.

### Secular effects

J2 produces secular drift in the node and the line of apsides, and **none** in
`a`, `e` or `i`:

```
dOmega/dt = -(3/2) n J2 (Re/p)^2 cos(i)                nodal regression
domega/dt =  (3/4) n J2 (Re/p)^2 (5 cos^2(i) - 1)      apsidal rotation
```

The validation suite checks the nodal regression against the analytic
expression to better than 1%.

Two consequences the scenarios exploit:

- **Sun-synchronous orbits.** At ~98° inclination and 700–800 km the node
  precesses at 0.9856°/day, matching the Sun's apparent motion, so the orbit
  plane holds a fixed angle to the Sun. That is what the dawn-dusk scenario
  uses to almost eliminate eclipse.
- **Critical inclination.** At 63.4° the apsidal rotation vanishes, freezing
  the line of apsides. That is the Molniya inclination, and why the HEO
  scenario uses it.

### Why J2 dominates the numerics

**J2 produces no secular change in the semi-major axis** — it is conservative.
But it makes the *osculating* semi-major axis oscillate by **12.7 km
peak-to-peak** in the default LEO, at twice the orbital frequency, while the
sail changes it by hundreds of metres over a week.

This single fact drives a major design decision: every feasibility figure in
the application is computed from **revolution-averaged** elements. See
[`validation.md`](validation.md) §4.

### Not implemented

J3 and all higher zonals, and all tesseral and sectoral harmonics (including
J22, which drives geostationary longitude drift). In LEO these are collectively
~1e-6 of the central term, three orders below J2.

---

## 5. Eclipse

Dual-cone (umbra plus penumbra) geometry, treating the Sun as a sphere of
finite radius and the Earth as an opaque sphere. At distance `d` along the
anti-Sun axis from a body of radius `R_b`, with the Sun at distance `d_s`:

```
f_umbra    = asin( (R_sun - R_b) / d_s )
f_penumbra = asin( (R_sun + R_b) / d_s )

r_umbra    = R_b - d tan(f_umbra)
r_penumbra = R_b + d tan(f_penumbra)
```

With `p` the perpendicular distance from the shadow axis, the illumination
fraction is 0 inside `r_umbra`, 1 outside `r_penumbra`, and **linearly
interpolated** between. That fraction multiplies `P` directly, so a partially
eclipsed sail produces a proportionally reduced force.

The Moon is also treated as an occulter; the two combine multiplicatively.

### Verification

The eclipse fraction for a 500 km circular orbit with the Sun in the orbit
plane matches the analytic `asin(Re/r)/pi` (about 35%) to two decimal places.

### The beta angle

How much of an orbit is shadowed depends on the **beta angle** — the elevation
of the Sun above the orbit plane. It is recorded per sample and plotted under
Geometry.

- **beta = 0** — the Sun lies in the orbit plane, giving the longest eclipse.
- **large beta** — the orbit is nearly edge-on to the Sun; above a threshold set
  by the altitude the orbit is **fully sunlit**. For a 500 km orbit that
  threshold is around 70°.

A dawn-dusk sun-synchronous orbit holds a high beta angle all year, which is
the physical basis of the eclipse-cost preset: comparing it against the default
51.6° LEO shows nearly a factor of two in useful impulse.

Because the beta angle depends on the RAAN **and** the epoch, changing the
mission start date materially changes the answer for a solar sail. That is why
the epoch control is prominent in the Mission panel rather than buried.

### Not modelled

Atmospheric refraction and the resulting partial illumination ring, limb
darkening, and the exact area-overlap integral of two discs. The linear
penumbra ramp differs from the true overlap by a few percent of the penumbra
crossing, which lasts only a few seconds out of a ~5700 s LEO revolution.

---

## 6. Atmospheric drag: why it is absent, and what that costs

Not modelled in v1. This is the **most consequential omission** for LEO work.

At 400 km with a typical sail area-to-mass ratio, drag exceeds the solar-sail
force by orders of magnitude:

| Altitude | Drag versus sail force |
| --- | --- |
| 300 km | Drag overwhelmingly dominates |
| 400 km | Drag still dominates by orders of magnitude |
| 600 km | Comparable at solar minimum; drag larger at solar maximum |
| 800 km and above | Sail dominates |

So a "LEO orbit raising" result below ~600 km from this tool describes what the
**sail contributes**, not the net orbit evolution — a real spacecraft there
would be losing altitude overall.

The application warns whenever a trajectory dips below 400 km, and the 400 km
scenario carries the warning in its own description. Above about 800 km the
omission is not important.

A sail is also a very large drag area, which is why deorbit-sail concepts exist
at all: the same hardware that raises an orbit at 800 km deorbits one at
400 km.

---

## 7. Also not modelled

- **Earth albedo radiation pressure.** Reflected sunlight from the Earth,
  roughly 30% of the direct solar flux at the sub-satellite point, falling off
  with altitude. In LEO it is a genuine few-percent effect on a sail.
- **Earth infrared radiation pressure.** Thermal emission, ~240 W/m² at the
  surface. Comparable to albedo in LEO, and unlike albedo it does **not**
  vanish in eclipse.
- **Solid-body and ocean tides.**
- **Relativistic corrections.**
- **Solar radiation pressure on the spacecraft bus**, as distinct from the sail.

---

## References

1. Vallado, D. A. *Fundamentals of Astrodynamics and Applications*, 4th ed.
   Microcosm Press, 2013. Chapters 8 and 9.
2. Montenbruck, O. and Gill, E. *Satellite Orbits.* Springer, 2000. Chapter 3.
3. NIMA. *Department of Defense World Geodetic System 1984*, TR8350.2, 3rd ed.
