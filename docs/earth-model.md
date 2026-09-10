# Earth model

Earth gravity, oblateness, eclipse, and the progression of fidelity across
versions.

---

## 1. What is modelled

The original specification asked for a staged build-up. Where the Earth model
has actually landed:

| Effect | Status | Tag |
| --- | --- | --- |
| Earth point-mass gravity | **Implemented** | — |
| Solar radiation pressure | **Implemented** (non-ideal optical sail) | — |
| Solar gravity | **Implemented**, toggleable | — |
| J2 perturbation | **Implemented and on by default** | — |
| Eclipse | **Implemented and on by default** | — |
| Atmospheric drag | **Implemented and on by default** (sail-coupled) | `ATM-EXP` |
| Earth albedo | **Implemented and on by default** | `RAD-EARTH` |
| Earth infrared radiation pressure | **Implemented and on by default** | `RAD-EARTH` |
| J3 zonal harmonic | **Implemented**, off by default | `GRAV-J3` |
| J22 sectorial harmonic | Not implemented | `GRAV-J22` |
| Thermospheric variability (MSIS/JB2008) | Not implemented | `ATM-MSIS` |

Tags refer to [`future-work.md`](future-work.md), which is keyed by capability
rather than by version — see there for why.

Two effects were pulled forward ahead of the original plan, both deliberately:

**J2** because it is ~1e-3 of the central acceleration in LEO — roughly a
thousand times larger than any other harmonic — and it drives the nodal
regression and apsidal rotation that visibly shape a sail trajectory over
weeks. Leaving it out would have made the LEO scenarios qualitatively wrong.

**Eclipse** because in a 500 km orbit the spacecraft is shadowed for ~35% of
every revolution. Omitting it overstates the available sail impulse by about a
third, so the headline feasibility numbers — the entire point of the tool —
would have been wrong.

Both remain toggleable so their cost can be measured directly.

**Atmospheric drag, Earth albedo and Earth infrared** arrived after the first
release and are on by default for Earth orbits. Drag changes the LEO answer
outright — see §6 — and switching it off silently would have left the tool
giving the wrong sign for the altitude change of any large sail below about
600 km. Configurations saved before those terms existed load with them **off**,
so an old file still reproduces the trajectory it was saved against.

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

### Beyond J2

J3 is implemented (§8, off by default). All higher zonals and all tesseral and
sectoral harmonics — including J22, which drives geostationary longitude drift
— are not. In LEO these are collectively ~1e-6 of the central term, three
orders below J2.

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

## 6. Atmospheric drag

**Modelled**, and for a sail it is the term that decides the LEO answer.

### Why a sail cannot treat drag as a correction

For a conventional satellite drag is a nuisance parameter: a fixed ballistic
coefficient times a density. For a sail it is *coupled to the control
variable*, because the sail **is** the drag area. The same projection that
decides how much sunlight the sail catches decides how much atmosphere it
catches — except the two projections are taken against **different
directions**: the Sun line for radiation pressure, the relative wind for drag.

The default 100 m² sail on 100 kg has a ballistic coefficient of

| Attitude | m / (C_D A) |
| --- | --- |
| Broadside to the wind | 0.45 kg/m² |
| Edge-on (feathered) | 45.5 kg/m² |

against roughly 50 kg/m² for a cubesat and 100 kg/m² for a spent rocket body.
A sail broadside is two orders of magnitude draggier than anything else in low
orbit, and its own attitude law chooses between those two numbers every
second.

### Model

```
v_rel = v - omega_E x r                     co-rotating atmosphere
A_d   = A_bus + A_sail |v_hat_rel . n|      projected drag area
a     = -(1/2) rho C_D (A_d / m) |v_rel| v_rel
```

Density is the piecewise-exponential fit to the US Standard Atmosphere 1976 /
CIRA-72 tabulated by Vallado (Table 8-4): 28 bands of
`rho(h) = rho_0 exp(-(h - h_0)/H)`, one exponential per evaluation, exactly
zero above 2000 km. `C_D = 2.2` by default, referred to the projected area.

The atmosphere is assumed to co-rotate rigidly with the Earth. At 400 km that
subtracts 494 m/s from the inertial velocity — about 6% of the orbital speed
and 12% of the drag.

### What this changes

Turning drag on reverses the headline LEO result. In the default 500 km
scenario with a 1 m²/kg sail over 7 days:

| Quantity | Sail only | With drag |
| --- | --- | --- |
| Change in mean semi-major axis | +901 m | −15.4 km |
| Sail impulse | 0.96 m/s | 0.96 m/s |
| Drag impulse | — | 9.19 m/s |

The atmosphere removes roughly ten times the impulse the sail supplies. That
is not a defect of the steering law and no steering law fixes it: at this
altitude a sail this large is a deorbit device. The tool now says so, in the
run events, in the feasibility warnings and in the drag-versus-sail ratio on
the Results panel.

Because the orbital change is no longer attributable to the sail, the
"useful fraction of impulse budget" figure is **withheld** whenever drag
contributes more than 5% of the non-gravitational impulse — dividing a
drag-driven decay by a small sail impulse produces a spectacular and
meaningless efficiency. Switch drag off to measure a steering law on its own.

### Not modelled

- **Thermospheric variability.** The density model is static. Real density
  above 200 km spans about an order of magnitude over the solar cycle, a
  factor of two between day and night, and jumps during geomagnetic storms.
  The solar-activity selector (×0.4 / ×1 / ×3, ramped in between 100 and
  200 km) is a blunt stand-in for the first of those and nothing else. **A
  decay estimate from this model is a scale, not a date** — run both extremes
  and treat the spread as the answer.
- **Thermospheric winds** (~100 m/s against 494 m/s of co-rotation).
- **Lift.** A flat plate in free-molecular flow develops a force component
  perpendicular to the wind. Omitted; small at the near-broadside attitudes
  where drag matters, and doing it properly needs an accommodation-coefficient
  model this tool does not have.
- **Variation of C_D with incidence angle.**

---

## 7. Earth albedo and infrared radiation pressure

**Modelled.** Both treat the Earth as a diffusely radiating sphere and deliver
their momentum along the **zenith** direction, driving the same flat-plate law
as sunlight with a different pressure — the code literally shares
`flatPlateForce` with the SRP term.

### Infrared — exact

For a uniform Lambertian sphere of exitance `M`, the irradiance on a plate
facing it at centre distance `r` is exactly

```
E_ir = M (R_E / r)^2 ,     M = 240 W/m^2
```

(integrate the constant radiance `M/pi` over the cone of half-angle
`arcsin(R_E/r)`). At 500 km that is 206 W/m², about 15% of the direct solar
flux, and the net momentum is radial by symmetry. No approximation is involved
beyond uniform emission.

**It does not stop in eclipse.** That makes it qualitatively different from
every other term in the model: it is the only force still pushing on the sail
in shadow.

### Albedo — interpolated between two closed forms

Reflected sunlight is cosine-weighted on the lit hemisphere and absent on the
night side, so the same integral has no elementary closed form for a general
viewing geometry. With `phi` the phase angle Sun–Earth–spacecraft (equivalently
the solar zenith angle at the sub-satellite point) and `w = (R_E/r)^2`:

```
near field (r -> R_E):  a S (R_E/r)^2 max(0, cos phi)
far field  (r >> R_E):  a S (R_E/r)^2 (2/3pi) [sin phi + (pi - phi) cos phi]

E_albedo = a S (R_E/r)^2 [ w * near + (1 - w) * far ] ,   a = 0.30
```

At 500 km over the subsolar point this reproduces a direct numerical
integration over the visible cap to about 3%, giving ~340 W/m² — roughly 25%
of the direct solar flux. Near the terminator the relative error is much
larger, but the absolute flux there is a few percent of its subsolar value.

### Why 40% of the solar flux is not 40% more thrust

Together the two terms return of order 40% of the direct solar flux at 500 km,
which sounds decisive on a vehicle propelled entirely by photon momentum. It
is not, for two reasons: both arrive along the **local vertical**, where they
do almost no work on the orbit, and the albedo half reverses sense between the
day and night halves of every revolution. The secular orbital effect is small.
They are enabled by default in the Earth scenarios because "small" is a
conclusion the model should reach rather than assume.

### Not modelled

- The **tangential bias** of reflected flux when the spacecraft is off the
  Sun–Earth line; the momentum is taken as purely radial.
- Geographic, diurnal and seasonal albedo variation, and cloud. A single
  global Bond albedo stands in for a field that runs from ~0.1 over dark ocean
  to ~0.8 over fresh snow, so an *instantaneous* albedo flux can be wrong by a
  factor of two. The revolution average is much better than that.
- **Wavelength dependence.** The sail's optical coefficients are visible-band
  values being applied to 10 µm thermal radiation, where a real aluminised
  sail behaves differently again.

---

## 8. J3 and higher harmonics

**J3 is modelled** (off by default); everything above it is not.

```
k   = -(5/2) J3 (mu/r^2) (Re/r)^3
a_x = k [3 (z/r) - 7 (z/r)^3] x/r
a_y = k [3 (z/r) - 7 (z/r)^3] y/r
a_z = k [6 (z/r)^2 - 7 (z/r)^4 - 3/5]
```

J3 is about 400× smaller than J2, which still leaves it near 4e-5 m/s² in LEO
— several times **larger** than the acceleration of a 1 m²/kg sail. Being
north–south asymmetric it produces a long-period oscillation in eccentricity
and argument of periapsis rather than a clean secular regression, and those
are exactly the elements a sail is trying to move, so leaving it out invites
mistaking a gravity-field oscillation for a sail effect. It causes no secular
change in semi-major axis, so altitude-raising figures are unaffected either
way — which is why it is off by default rather than on.

Still not implemented: **J22**, the sectorial term that drives geostationary
longitude drift toward the stable points at 75.3°E and 104.7°W. It would
matter for the GEO scenarios over months, and needs a rotating-frame
conversion (hence Greenwich sidereal time) that no other term in the model
requires.

---

## 9. Also not modelled

- **Solid-body and ocean tides.**
- **Relativistic corrections.**
- **Solar radiation pressure on the spacecraft bus**, as distinct from the sail.
- **Lunar gravity harmonics.**

---

## References

1. Vallado, D. A. *Fundamentals of Astrodynamics and Applications*, 4th ed.
   Microcosm Press, 2013. Chapters 8 and 9.
2. Montenbruck, O. and Gill, E. *Satellite Orbits.* Springer, 2000. Chapter 3.
3. NIMA. *Department of Defense World Geodetic System 1984*, TR8350.2, 3rd ed.
