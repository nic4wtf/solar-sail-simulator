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
dv/dt = a_central + a_J2 + a_J3 + a_moon + a_sun
        + a_planets + a_srp + a_drag + a_earthrad
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

### 2.4 Earth J3

```
k   = -(5/2) J3 (mu/r^2) (Re/r)^3
a_x = k [3 (z/r) - 7 (z/r)^3] x/r
a_y = k [3 (z/r) - 7 (z/r)^3] y/r
a_z = k [6 (z/r)^2 - 7 (z/r)^4 - 3/5]
```

Vallado eq. 8-39. Like J2 it is the gradient of
`U_n = -(mu/r) J_n (Re/r)^n P_n(z/r)`, and the validation suite checks both
against a numerical gradient of that potential rather than against each other.
Off by default: it is several times larger than a 1 m²/kg sail acceleration in
LEO but produces no secular change in semi-major axis. See
[`earth-model.md`](earth-model.md) §8.

### 2.5 Atmospheric drag

```
v_rel = v - omega_E x r
A_d   = A_bus + A_sail |v_hat_rel . n|
a     = -(1/2) rho C_D (A_d / m) |v_rel| v_rel
```

The second line is what makes drag interesting rather than merely necessary on
a sail: **the sail is the drag area**, and it is under attitude control. The
same `cos` projection that sets the sail force sets the drag area, but taken
against a different direction — the relative wind rather than the Sun line.
Density comes from a 28-band exponential fit to the US Standard Atmosphere
1976 / CIRA-72 and is identically zero above 2000 km. Earth centre only.

### 2.6 Earth radiation pressure

Reflected sunlight and thermal infrared, both arriving along the zenith
direction and both driving the same flat-plate law as sunlight:

```
E_ir  = M_ir (Re/r)^2                                      exact, M_ir = 240 W/m^2
E_alb = a S (Re/r)^2 [ w n(phi) + (1 - w) f(phi) ]         a = 0.30, w = (Re/r)^2
        n(phi) = max(0, cos phi)                           near-field limit
        f(phi) = (2/3pi)[sin phi + (pi - phi) cos phi]     Lambert-sphere limit
```

with `phi` the phase angle Sun–Earth–spacecraft. The infrared term does **not**
vanish in eclipse; the albedo term does, geometrically. Derivations and
accuracy in [`earth-model.md`](earth-model.md) §7.

### 2.7 Planetary third bodies

The same third-body expression as §2.2, summed over the configured planets.
Only meaningful heliocentrically: from Earth orbit Jupiter's tidal
acceleration is about 1e-13 of the central term. Positions come from
Standish's approximate Keplerian elements — see
[`interplanetary-model.md`](interplanetary-model.md) §2, including the
equinox-of-date precession correction that the validation suite caught.

### 2.8 Solar radiation pressure

See [`solar-sail-model.md`](solar-sail-model.md) for the full derivation.

---

### 2.9 The heliocentric frame

The integration centre is switchable between the Earth, the Moon and the Sun.
Nothing in §2 changes when it is the Sun: `sunToCraft` becomes `r`, the SRP
pressure law was always `1/r²`, and cone/clock angles were always Sun-relative.
The terms that ARE Earth-specific — J2, J3, drag, albedo and infrared — are
either refused outright or fall to zero geometrically.

Out there the governing parameter is the lightness number

```
beta = a_c / (mu_sun / AU^2)
```

which is the same everywhere, because the sail acceleration and solar gravity
both scale as `1/r²`. A Sun-facing sail reduces the effective gravitational
parameter to `mu(1 - beta)`, so a spacecraft on a circular orbit escapes when
`beta >= 0.5`. That threshold is checked directly by the validation suite; see
[`interplanetary-model.md`](interplanetary-model.md) §4.

---

## 3. Relative magnitudes

Order-of-magnitude ratios to the central term, which is what determines whether
a given effect can be neglected:

| Effect | LEO (500 km) | GEO |
| --- | --- | --- |
| Earth J2 | ~1e-3 | ~1e-5 |
| Earth J3 | ~4e-6 | ~2e-9 |
| Drag, 1 m²/kg sail broadside | ~1e-5 | 0 (above the model cutoff) |
| Earth albedo + infrared | ~2e-7 | ~1e-9 |
| Sail, 1 m²/kg | ~1e-6 | ~4e-5 |
| Moon third body | ~1e-7 | ~2e-5 |
| Sun third body | ~5e-8 | ~1e-5 |

Three things follow, all of which the tool is built around:

1. **In LEO the sail is a very small perturbation** — smaller than J2 by three
   orders of magnitude. Its effect is only visible after revolution averaging.
2. **In LEO drag is larger than the sail**, by about an order of magnitude for
   a broadside 1 m²/kg sail at 500 km, and it always opposes the motion. This
   is why the LEO answer for a large sail is decay, not orbit raising, and why
   drag is on by default for the Earth scenarios.
3. **At GEO the sail becomes comparable to lunisolar gravity**, and drag and
   Earth radiation vanish. Tidal acceleration grows as `r` while central
   gravity falls as `1/r²`, so the third-body ratio grows as `r³` — a factor
   of 230 between LEO and GEO. That is why the high-orbit scenarios enable
   lunar and solar gravity and disable drag by default.

The Earth-radiation row deserves a note: the *flux* it represents is ~40% of
the direct solar flux at 500 km, not 20% of the sail term. The ratio above is
small because that flux arrives along the local vertical, where it does very
little work on the orbit, and because the albedo half reverses sense between
the day and night halves of each revolution.

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

- Gravity harmonics beyond J3 (J22 and all higher terms)
- Sphere-of-influence patching: the integration centre never changes mid-run
- Departure hyperbolas, arrival B-planes, launch windows and porkchop plots
- Solar thermal limits, coronal drag and sail degradation, which are what
  actually decide whether a close solar pass is possible
- Planetary occultation of the Sun; eclipse is Earth and Moon only
- Thermospheric winds, the diurnal density bulge, and geomagnetic storms —
  the atmosphere model is static, and the solar-activity selector is a blunt
  multiplier rather than a density model
- Aerodynamic lift on the sail, and variation of C_D with incidence angle
- Wavelength dependence of the sail optical coefficients, which are
  visible-band values applied unchanged to Earth thermal infrared
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
