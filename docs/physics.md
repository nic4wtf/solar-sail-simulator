# Physics model

Everything the simulator computes, and the constants it computes it with.

All internal quantities are **SI**: metres, kilograms, seconds, newtons,
radians. `src/core/units.ts` is the only module that converts to display
units, so a formatting change cannot leak into the physics.

---

## 1. Constants

Defined in [`src/core/constants.ts`](../src/core/constants.ts), each with its
source.

| Constant | Value | Source |
| --- | --- | --- |
| Astronomical unit | 1.495978707e11 m | IAU 2012 (exact) |
| Speed of light | 299 792 458 m/s | exact |
| Earth GM | 3.986004418e14 m³/s² | EGM2008 / WGS-84 |
| Moon GM | 4.9048695e12 m³/s² | DE430 |
| Sun GM | 1.32712440018e20 m³/s² | IAU 2015 nominal |
| Earth equatorial radius | 6 378 137 m | WGS-84 |
| Moon mean radius | 1 737 400 m | — |
| Sun radius | 6.957e8 m | IAU 2015 nominal |
| J2 (Earth) | 1.08262668e-3 | WGS-84 / EGM96 |
| Obliquity at J2000 | 23.4392911° | IAU |

### Solar irradiance

Two conventions are selectable, because the literature and the measurements
disagree slightly and it matters for reproducing published figures:

| Choice | W₀ | P₀ = W₀/c |
| --- | --- | --- |
| Classical (**default**) | 1368 W/m² | 4.5633 µN/m² |
| Modern (SORCE/TIM TSI) | 1361 W/m² | 4.5399 µN/m² |

The classical value is used throughout the solar-sailing literature
(McInnes 1999) and reproduces the canonical **P₀ ≈ 4.56 µN/m²** quoted
everywhere. The difference between the two is 0.5% — smaller than the
uncertainty in a real sail's optical coefficients, but the choice is exposed
rather than buried.

---

## 2. Equations of motion

The simulator integrates the second-order system directly rather than reducing
it to first order, because the acceleration depends on velocity (the attitude
rules use the velocity direction):

```
dr/dt = v
dv/dt = a_central + a_J2 + a_moon + a_sun + a_srp
```

Each term is individually switchable, and the **Physics / Model** tab lists
which are active for the current configuration.

### 2.1 Central body

```
a_central = -mu r / |r|^3
```

`mu` is the GM of whichever body is the integration centre (Earth or Moon).

### 2.2 Third body

In a frame centred on — and therefore accelerating with — the central body:

```
a_3 = mu_3 [ (s - r)/|s - r|^3  -  s/|s|^3 ]
```

where `s` is the central-body-to-third-body vector and `r` the
central-body-to-spacecraft vector.

The **first** term is the direct pull of the third body on the spacecraft. The
**second** is the indirect (inertial) term that removes the third body's pull on
the *central body*, which is what makes the accelerating central-body frame
usable at all. Dropping it is a classic error producing a spurious secular
drift; the code spells it out and a test asserts that the two terms cancel
exactly at `r = 0`.

**Numerical note.** For `|r| ≪ |s|` the two terms nearly cancel. With
`|r|/|s| ≈ 1e-2` (LEO against the Moon) roughly four significant digits are
lost, leaving about twelve — far more than the simulation needs, so the direct
form is retained for clarity over a reformulated difference.

### 2.3 Earth oblateness (J2)

```
k   = -(3/2) J2 (mu/r^2) (Re/r)^2
a_x = k (1 - 5 z^2/r^2) x/r
a_y = k (1 - 5 z^2/r^2) y/r
a_z = k (3 - 5 z^2/r^2) z/r
```

Vallado eq. 8-38. Requires an Earth-**equatorial** frame, which the ECI
integration frame is; the force model refuses to apply this term when the
integration centre is the Moon.

J2 is ~1e-3 of the central acceleration in LEO — roughly a thousand times
larger than any other harmonic, which is why it is the only one included. It
drives the nodal regression and apsidal rotation that visibly shape a sail
trajectory over weeks.

**It is also the reason mean elements matter.** J2 makes the *osculating*
semi-major axis oscillate by 11.8 km peak-to-peak in the default LEO. See
[`validation.md`](validation.md) §4.

### 2.4 Solar radiation pressure

See [`solar-sail-model.md`](solar-sail-model.md) for the full derivation.

---

## 3. Relative magnitudes

Order-of-magnitude ratios to the central term, which is what determines whether
a given effect can be neglected:

| Effect | LEO (500 km) | GEO |
| --- | --- | --- |
| Earth J2 | ~1e-3 | ~1e-5 |
| Sail, 1 m²/kg | ~1e-6 | ~4e-5 |
| Moon third body | ~1e-7 | ~2e-5 |
| Sun third body | ~5e-8 | ~1e-5 |

Two things follow, both of which the tool is built around:

1. **In LEO the sail is a very small perturbation** — smaller than J2 by three
   orders of magnitude. Its effect is only visible after revolution averaging.
2. **At GEO the sail becomes comparable to lunisolar gravity.** Tidal
   acceleration grows as `r` while central gravity falls as `1/r²`, so the
   third-body ratio grows as `r³` — a factor of 230 between LEO and GEO. That
   is why the high-orbit scenarios enable lunar and solar gravity by default.

---

## 4. Eclipse

Dual-cone geometry treating the Sun as a sphere of finite radius and the
occulting body as an opaque sphere. At distance `d` along the anti-Sun axis
from a body of radius `R_b`, with the Sun at distance `d_s`:

```
f_umbra    = asin( (R_sun - R_b) / d_s )
f_penumbra = asin( (R_sun + R_b) / d_s )

r_umbra    = R_b - d tan(f_umbra)
r_penumbra = R_b + d tan(f_penumbra)
```

With `p` the perpendicular distance from the shadow axis, the illumination
fraction is 0 inside `r_umbra`, 1 outside `r_penumbra`, and linearly
interpolated between. That fraction multiplies `P` directly.

Both the Earth and the Moon act as occulters, combined multiplicatively.

**Not modelled:** atmospheric refraction and the resulting partial illumination
ring, limb darkening, and the exact area-overlap integral of two discs (a
linear ramp is used instead, differing by a few percent of the penumbra
crossing — a few seconds out of a ~5700 s LEO revolution).

**Why it is in v1:** in a 500 km orbit the spacecraft is shadowed for ~35% of
every revolution. Omitting it overstates the available sail impulse by about a
third. It is toggleable so the cost can be measured directly.

---

## 5. Time

A single scalar `t` = seconds since the mission epoch. The epoch is stored as a
Julian date and absolute time is `epochJd + t/86400`.

**A single uniform time scale is used.** UTC, TT and TDB are not distinguished.
The maximum offset between them is ~70 s, which displaces the Sun by 3e-4° and
the Moon by ~35 km — both far below the error of the analytic ephemerides
themselves.

**Not modelled:** light-time correction, aberration, nutation, polar motion, or
precession beyond the J2000 mean obliquity drift term.

---

## 6. Ephemerides

### Sun

Low-precision analytic series from the Astronomical Almanac (also Vallado
Alg. 29 / Meeus Ch. 25 abridged):

```
d      = days since J2000
L      = 280.460 + 0.9856474 d                          [deg]
g      = 357.528 + 0.9856003 d                          [deg]
lambda = L + 1.915 sin g + 0.020 sin 2g                 [deg]
R      = 1.00014 - 0.01671 cos g - 0.00014 cos 2g       [AU]
eps    = 23.439 - 4.0e-7 d                              [deg]
```

Then ecliptic → equatorial. Accuracy ~0.01° in longitude and ~2e-5 AU in range
over 1950–2050. A 0.01° direction error changes the sail incidence angle by the
same amount, altering the force by under 1e-4 relative.

### Moon

See [`lunar-model.md`](lunar-model.md).

---

## 7. Not modelled

Listed explicitly so nothing has to be inferred from silence:

- Atmospheric drag
- Earth albedo and infrared radiation pressure
- Gravity harmonics beyond J2 (J3, J22, and all higher terms)
- Lunar gravity harmonics (the Moon is a point mass here)
- Solid-body and ocean tides
- Relativistic corrections
- Solar radiation pressure on the spacecraft bus, as distinct from the sail
- Sail billow, wrinkling, thermal deformation, and degradation over time
- Attitude dynamics, slew rates, and control authority limits — the commanded
  attitude is achieved instantaneously and exactly
- Thruster or propellant expenditure (propellant mass is inert)
- Solar flux variation with the solar cycle
- Spacecraft charging, outgassing, and micrometeoroid effects

---

## References

1. McInnes, C. R. *Solar Sailing: Technology, Dynamics and Mission
   Applications.* Springer-Praxis, 1999.
2. Vallado, D. A. *Fundamentals of Astrodynamics and Applications*, 4th ed.
   Microcosm Press, 2013.
3. Montenbruck, O. and Gill, E. *Satellite Orbits: Models, Methods,
   Applications.* Springer, 2000.
4. Meeus, J. *Astronomical Algorithms*, 2nd ed. Willmann-Bell, 1998.
