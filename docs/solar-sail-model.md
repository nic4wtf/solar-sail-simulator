# Solar sail force model

Full derivation of the force law implemented in
[`src/core/forces/srp.ts`](../src/core/forces/srp.ts).

---

## 1. Radiation pressure

A photon of energy `E` carries momentum `E/c`. The solar irradiance `W(r)` at
heliocentric distance `r` therefore delivers momentum flux — i.e. pressure —

```
P(r) = W(r) / c = (W0 / c) (1 AU / r)^2 = P0 (1 AU / r)^2
```

with `P0 = 4.5633 µN/m²` for `W0 = 1368 W/m²` (see
[`physics.md`](physics.md) §1).

The inverse-square law treats the Sun as a point source, exact to better than
1e-5 anywhere outside the corona.

**Numbers worth carrying:** `P0` is about 4.6 micronewtons per square metre.
A 100 m² sail at 1 AU feels roughly **0.9 millinewtons** — about the weight of
a grain of sand. Everything about solar sailing follows from that number being
small and the exposure time being long.

---

## 2. Geometry and notation

| Symbol | Meaning |
| --- | --- |
| `u` | unit vector from the Sun to the spacecraft (the direction photons travel) |
| `n` | sail normal, oriented so `cos α = u · n ≥ 0` |
| `t` | unit vector in the sail plane, along the component of `u` perpendicular to `n` (the "downstream" transverse direction) |
| `α` | incidence angle between `u` and `n` |
| `A` | sail area |
| `P` | radiation pressure at the spacecraft |

Decomposing the photon direction into the sail frame:

```
u = cos(alpha) n + sin(alpha) t
```

The projected area presented to the Sun is `A cos α`, so the incident momentum
flux is `P A cos α` directed along `u`.

### Optical coefficients

| Symbol | Meaning |
| --- | --- |
| `rho` | reflection coefficient — fraction of photons reflected |
| `s` | specular fraction of the reflected light |
| `tau` | transmission coefficient — fraction passing straight through |
| `a = 1 - rho - tau` | absorptivity |
| `eps_f`, `eps_b` | front / back thermal emissivity |
| `B_f`, `B_b` | front / back non-Lambertian coefficients (2/3 is exactly Lambertian) |

---

## 3. Derivation

Account for each possible fate of an incident photon.

### 3.1 Specular reflection — fraction `rho·s`

Incoming along `u`, outgoing along `u - 2(u·n)n = u - 2cos(α)n`. Momentum
transferred to the sail per unit incident momentum is
`u - (u - 2cos α n) = 2 cos α n`. Contribution:

```
2 P A rho s cos^2(alpha)  along n
```

### 3.2 Absorption — fraction `a`

The photon's full momentum is transferred along `u`:

```
P A a cos(alpha) [ cos(alpha) n + sin(alpha) t ]
```

### 3.3 Diffuse reflection — fraction `rho(1-s)`

The incident momentum is transferred as in absorption, and the diffuse
re-emission from the front face adds a reaction along `n` weighted by the
non-Lambertian coefficient `B_f`:

```
P A rho (1-s) cos(alpha) [ cos(alpha) n + sin(alpha) t + B_f n ]
```

### 3.4 Thermal re-emission of absorbed energy

In thermal equilibrium the absorbed energy is re-radiated from both faces. The
*net* recoil depends on the emissivity imbalance:

```
P A a cos(alpha) (eps_f B_f - eps_b B_b) / (eps_f + eps_b)   along n
```

This is why a real sail is built with a **low-emissivity reflective front** and
a **high-emissivity back**: emitting preferentially from the back produces a
small net forward thrust. With the default coefficients
(`eps_f = 0.05, eps_b = 0.55`) this term is negative — a small penalty at the
default `B_f = 0.79, B_b = 0.55` — and the sign is worth checking against your
own coefficient set rather than assuming.

### 3.5 Transmission — fraction `tau`

Transmitted photons continue along `u` and exert **no force**. They are pure
loss. (This is the extension to the standard McInnes form; opaque sails have
`tau = 0`.)

### 3.6 Collecting terms

Normal component:

```
F_n = P A cos(alpha) [ 2 rho s cos(alpha)
                     + a cos(alpha)
                     + rho (1-s) (cos(alpha) + B_f)
                     + a (eps_f B_f - eps_b B_b)/(eps_f + eps_b) ]
```

The `cos α` coefficients collect as `2ρs + a + ρ − ρs = ρs + ρ + a`, and
substituting `a = 1 − ρ − τ` gives `1 + ρs − τ`:

```
F_n = P A cos(alpha) [ (1 + rho s - tau) cos(alpha)
                     + B_f rho (1 - s)
                     + a (eps_f B_f - eps_b B_b)/(eps_f + eps_b) ]
```

Transverse component:

```
F_t = P A cos(alpha) sin(alpha) [ a + rho(1-s) ]
    = P A cos(alpha) sin(alpha) (1 - rho s - tau)
```

Total:

```
F = F_n n + F_t t
```

With `tau = 0` this is exactly McInnes (1999) eq. 2.51.

---

## 4. The ideal-sail check

Set `rho = 1, s = 1, tau = 0` (hence `a = 0`):

```
F_n = P A cos(alpha) [ 2 cos(alpha) + 0 + 0 ] = 2 P A cos^2(alpha)
F_t = P A cos(alpha) sin(alpha) (1 - 1) = 0
```

so

```
F = 2 P A cos^2(alpha) n
```

and at normal incidence `F = 2 P A` — the familiar result, with the factor 2
coming from the photon reversing direction.

This reduction is checked numerically in
[`src/test/srp.test.ts`](../src/test/srp.test.ts) at nine incidence angles,
including that the transverse component is identically zero.

---

## 5. The alternative ideal model

For first-cut studies the application also offers

```
F = 2 eta P A cos^2(alpha) n
```

with `eta` an overall efficiency (0.85–0.92 for real aluminised sails). This is
what much of the mission-analysis literature uses. Its limitation is
structural, not just quantitative: it produces force **only along the normal**,
so it cannot represent the in-plane force a real partly-diffuse sail generates.

---

## 6. Default coefficients

The standard aluminium-on-Kapton reference sail with a bare back surface, as
used throughout the literature:

| Coefficient | Value |
| --- | --- |
| `rho` | 0.88 |
| `s` | 0.94 |
| `tau` | 0 |
| `eps_f` | 0.05 |
| `eps_b` | 0.55 |
| `B_f` | 0.79 |
| `B_b` | 0.55 |

These give a **normal-incidence force coefficient of 1.816** rather than the
ideal 2.0 — a 9% penalty before any steering or eclipse loss is considered.

---

## 7. Two-sided sail

A sail is a physical sheet: the Sun illuminates whichever face is turned toward
it. If the commanded normal has `u · n < 0` the implementation flips it, so the
force always pushes anti-sunward, and reports a `flipped` flag.

**v1 assumes both faces are optically identical.** That is not true of a real
sail with a bare back surface — the reflectivity and emissivity would swap.
The flag exists so the condition is visible rather than silent; handling it
properly is future work.

At exactly edge-on incidence the projected area is zero and the force is
identically zero, not merely small.

---

## 8. Performance figures

### Characteristic acceleration

The standard figure of merit: the acceleration of a **Sun-facing sail at 1 AU**.

```
a_c = k P0 A / m
```

where `k` is the normal-incidence force coefficient (2 for an ideal sail,
1.816 for the default). For an ideal sail with `A/m = 1 m²/kg`:

```
a_c = 2 x 4.5633e-6 x 1 = 9.13 um/s^2
```

**It is an upper bound, achieved only at normal incidence in full sunlight.**
The Results panel reports the fraction actually realised — typically 19–37% in
LEO — alongside it, and never in place of it.

### Sail loading

`sigma = m/A` [kg/m²], the inverse of the area-to-mass ratio. Sail engineers
usually quote this.

### Lightness number

```
beta = a_c / (mu_sun / AU^2) = a_c / 5.93e-3
```

The ratio of characteristic sail acceleration to solar gravity at 1 AU.
`beta = 1` exactly cancels solar gravity and requires `A/m ≈ 650 m²/kg` for an
ideal sail — far beyond anything built. Chiefly relevant to interplanetary
sailing; shown for context.

### For scale

| Mission | A/m [m²/kg] | Status |
| --- | --- | --- |
| IKAROS (JAXA, 2010) | 0.64 | Flown — first deep-space demonstration |
| LightSail 2 (2019) | 6.4 | Flown — demonstrated LEO orbit raising |
| NEA Scout (2022) | 6.1 | Launched, never contacted after deployment |
| ACS3 (NASA, 2024) | 5.0 | Flown — composite boom demonstrator |
| Typical study "high-performance" sail | 100 | Requires unbuilt areal densities |

The application warns above 50 m²/kg that results are a physics extrapolation
rather than an engineering projection.

---

## 9. What limits a real sail

Not modelled in v1, but the reason real performance falls short of these
numbers:

- **Billow and wrinkling** reduce the effective projected area and tilt the
  local normal away from the commanded direction.
- **Thermal deformation** changes the shape as the incidence angle changes.
- **Degradation** — UV and atomic-oxygen exposure reduce reflectivity over
  months to years.
- **Attitude control authority** — a large sail has a large moment of inertia
  and slews slowly, so a schedule demanding rapid attitude changes (such as
  the feathering schedule at its switch points) may not be achievable.
- **Centre-of-pressure offset** from the centre of mass produces a disturbance
  torque that must be trimmed continuously.

---

## References

1. McInnes, C. R. *Solar Sailing: Technology, Dynamics and Mission
   Applications.* Springer-Praxis, 1999. Chapter 2, eq. 2.51.
2. Wright, J. L. *Space Sailing.* Gordon and Breach, 1992.
3. Rios-Reyes, L. and Scheeres, D. J. "Generalized Model for Solar Sails."
   *Journal of Spacecraft and Rockets*, 42(1), 2005.
4. Vulpetti, G., Johnson, L. and Matloff, G. L. *Solar Sails: A Novel Approach
   to Interplanetary Travel.* Springer, 2008.
