# Orbital mechanics

Element definitions, conversions and reference frames.

Implementation: [`src/core/orbital/`](../src/core/orbital/).

---

## 1. Classical elements

| Element | Symbol | Meaning |
| --- | --- | --- |
| Semi-major axis | `a` | Size. Negative for hyperbolic orbits. |
| Eccentricity | `e` | Shape. 0 circular, <1 elliptic, 1 parabolic, >1 hyperbolic. |
| Inclination | `i` | Tilt of the orbit plane from the equator, 0 to pi. |
| RAAN | `Omega` | Right ascension of the ascending node - where the orbit crosses the equator going north. |
| Argument of periapsis | `omega` | Angle from the ascending node to periapsis, in the orbit plane. |
| True anomaly | `nu` | Position along the orbit, from periapsis. |

Derived and also reported:

| Quantity | Definition |
| --- | --- |
| Argument of latitude | `u = omega + nu` |
| Periapsis radius | `r_p = a(1 - e)` |
| Apoapsis radius | `r_a = a(1 + e)` |
| Period | `T = 2 pi sqrt(a^3 / mu)` |
| Specific energy | `E = v^2/2 - mu/r` |
| Specific angular momentum | `h = |r x v|` |
| Semi-latus rectum | `p = h^2 / mu` |

## 2. Osculating elements

The propagator records **osculating** elements: the instantaneous two-body
elements of the current state vector. They are the elements the orbit *would*
have if all perturbations vanished at that instant.

Under perturbations they change continuously, which is exactly what the plots
show. But they also **oscillate** within each revolution far more than they
drift, which is why every feasibility figure uses revolution-averaged (mean)
elements instead. See [`validation.md`](validation.md) section 4.

## 3. State to elements

Vallado Algorithm 9 (RV2COE):

```
h    = r x v
n    = k_hat x h                    node vector
e    = ((v^2 - mu/r) r - (r.v) v) / mu
E    = v^2/2 - mu/r
a    = -mu / (2E)
i    = acos(h_z / |h|)
```

Then `Omega` from `n`, `omega` from the angle between `n` and `e`, and `nu`
from the angle between `e` and `r`, each with a quadrant check.

### Degenerate cases

Three configurations make some elements undefined, and each has a standard
substitute angle. All three are handled explicitly:

| Case | Undefined | Substitute |
| --- | --- | --- |
| Circular, inclined (`e ~ 0`) | `omega` | Argument of latitude used directly |
| Elliptical, equatorial (`i ~ 0`) | `Omega` | True longitude of periapsis |
| Circular and equatorial | both | True longitude from the x-axis |

Because of this, `argLat` is **always** usable as an orbital phase variable,
including for a perfectly circular equatorial orbit. That is why it is the safe
default for the orbit-fraction attitude rule.

Note that the round-trip test in the validation suite compares only `a`, `e`
and `i` for the degenerate cases: `Omega` and `omega` are legitimately
reassigned to substitute angles there, so demanding they round-trip would be
testing the wrong thing.

## 4. Elements to state

Vallado Algorithm 10 (COE2RV). Build the state in the perifocal (PQW) frame:

```
r_pqw = [ r cos(nu), r sin(nu), 0 ]
v_pqw = sqrt(mu/p) [ -sin(nu), e + cos(nu), 0 ]
```

then rotate PQW to IJK by `R_z(-Omega) R_x(-i) R_z(-omega)`, applied as a
single precomputed 3x3 matrix.

## 5. Anomaly conversions

True to eccentric:

```
E = 2 atan2( sqrt(1-e) sin(nu/2), sqrt(1+e) cos(nu/2) )
```

The half-angle `atan2` form is used rather than `acos`, because it is
quadrant-correct and numerically well behaved near `nu = 0` and `nu = pi`.

Kepler's equation:

```
M = E - e sin(E)
```

Solved for `E` by Newton-Raphson with a starting guess of `M + e sin M` for
`e < 0.8` and `pi sign(M)` above, converging to 1e-12 in a handful of
iterations up to `e ~ 0.99`.

## 6. Reference frames

### Integration frame

A central-body-centred **inertial** frame:

- **ECI** - Earth-centred, J2000 equatorial. X toward the J2000 vernal equinox,
  Z along the Earth mean rotation axis, Y completing the right-handed set.
- **MCI** - Moon-centred, axes **parallel to ECI**, origin at the Moon.

Both are treated as non-rotating for force evaluation. The centre is
configurable per scenario, and is the seam where a heliocentric frame would be
added for interplanetary work.

### Attitude frames

RSW, VNB, Sun-relative and inertial. All four are built by one shared function
returning an explicit orthonormal **right-handed** triad in inertial
coordinates. See [`attitude-rules.md`](attitude-rules.md) section 1.

### Frames deliberately NOT used

- **ECEF / body-fixed.** No Earth-rotation-dependent effect is modelled (no
  drag, no albedo, no ground tracks), so an Earth-fixed frame would be dead
  weight.
- **Ecliptic.** Used internally by the ephemerides and immediately rotated to
  equatorial. Never exposed.
- **Barycentric.** The Earth is the ECI origin, not the Earth-Moon barycentre
  (a ~4670 km difference). Consistent within the model, but relevant when
  comparing against barycentric ephemerides.

## 7. Useful relations

Vis-viva:

```
v^2 = mu (2/r - 1/a)
```

Circular and escape speed:

```
v_circ = sqrt(mu/r)          v_esc = sqrt(2 mu/r)
```

Two-burn Hohmann transfer between circular orbits, used **only** as a yardstick
in the Feasibility panel and never as a simulated result:

```
a_t = (r0 + r1)/2
dv  = |sqrt(mu(2/r0 - 1/a_t)) - sqrt(mu/r0)|
    + |sqrt(mu/r1) - sqrt(mu(2/r1 - 1/a_t))|
```

Angular rate at periapsis relative to the mean motion - the quantity that sets
the required timestep for an eccentric orbit:

```
(dtheta/dt)_p / n = sqrt(1 + e) / (1 - e)^(3/2)
```

At `e = 0.74` this is a factor of 10, which is why one fixed step cannot serve
both ends of a Molniya-like orbit.

## References

1. Vallado, D. A. *Fundamentals of Astrodynamics and Applications*, 4th ed.
   Microcosm Press, 2013. Algorithms 9 and 10.
2. Battin, R. H. *An Introduction to the Mathematics and Methods of
   Astrodynamics*, revised ed. AIAA, 1999.
3. Montenbruck, O. and Gill, E. *Satellite Orbits.* Springer, 2000.
