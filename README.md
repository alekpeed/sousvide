# sous_vide — precise sear & sous vide timing calculator

A static, dependency-free web app that calculates:

1. **Sous vide bath time/temperature** — how long a cut of a given
   thickness takes to reach a target core temperature, plus the
   pathogen-reduction hold time needed at that temperature.
2. **Post-sous-vide sear countdown** — the maximum time per side on a
   hot pan/cast-iron/copper surface before the "gray band" (overcooked
   ring just under the crust) exceeds a chosen depth.

Open `index.html` directly in a browser — no build step, no server,
no dependencies.

## The physics

### Come-up time (sous vide)

The meat is modeled as a symmetric slab of thickness `L`, heated from
both faces by a convective water bath (Biot number from the chosen
circulation strength). The core temperature trajectory is computed with
an **explicit 1-D finite-difference solve of the transient heat
conduction equation** (25 nodes across the half-thickness, ghost-node
symmetry at the center, half-control-volume convective boundary at the
surface), stepped until the center comes within a configurable
tolerance of the bath temperature. Stability follows the standard
Fourier-number criteria for explicit schemes (`Fo ≤ 0.5` interior,
`Fo·(1+Bi_Δx) ≤ 0.5` at the convective boundary), with a safety margin.

The water bath temperature is set equal to the desired core doneness
temperature — standard sous vide practice, since the bath asymptotically
approaches but never exceeds that temperature, making overcooking by
time essentially impossible (only pasteurization sets a *minimum* time).

### Pasteurization hold time

Uses the classic **Bigelow (D/z) thermal death-time model**:

```
D_T = D_ref * 10 ^ ((T_ref - T) / z)
hold_time = log_reduction * D_T
```

with `D_ref = 1.0 min @ 60°C` and `z = 5.5°C` as a Salmonella-kinetics
proxy applied across categories, and a default log-reduction target of
6.5-log for poultry and 5.0-log for whole-muscle red meat/pork/fish
(USDA-style conventions). These constants are **approximations for
planning purposes** — cross-check against official USDA/FDA tables
before relying on this for critical food-safety decisions, especially
for immunocompromised diners, ground/mechanically-tenderized meat, or
non-whole-muscle cuts.

### Sear timing / gray-band control

The sear is modeled as 1-D transient conduction into a semi-infinite
slab of meat (valid since sear times are short relative to full-thickness
diffusion), using the **same explicit finite-difference scheme** as the
sous vide solver, but with a *convective* boundary at the seared face —
not an idealized instant jump to the pan's dial temperature.

This matters physically: most of a ripping-hot pan's heat goes into
flash-evaporating surface moisture rather than conducting straight into
the meat, so the effective heat-transfer coefficient through that
fat/moisture film is modest (here, ~28–45 W/m²K depending on
pan/surface choice) even though the pan itself reads 200°C+. An
idealized fixed-surface-temperature model was tried first and produced
single-digit-second sear windows — implausible against real searing
practice — which is the tell that the fixed-temperature assumption
was wrong; the convective-contact version reproduces the commonly
cited 30–90 second per-side range.

The simulation tracks the temperature at the exact depth equal to the
user's max gray-band depth, and reports the elapsed time at which that
point first crosses each meat category's approximate **gray-onset
temperature** (the absolute core temp at which meat visibly turns
"gray"/well-done at that spot — e.g. ~68°C for red meat/pork, ~62°C for
fish). If the target doneness is already at or past that onset point
(e.g. a well-done steak), there's no gray band left to protect and the
sear is treated as crust-only.

## Known simplifications

- Thermal properties (`alpha`, `k`) are category-typical constants, not
  measured per-cut — real values shift with fat/moisture content.
- The slab geometry assumes a roughly flat steak/chop/fillet; very
  round roasts diffuse heat faster (cylindrical/spherical geometry) than
  this model predicts, so come-up times will run slightly long for those.
- Pasteurization lethality accumulated *during* the come-up ramp is
  ignored (conservative — the hold timer only starts once core temp is
  reached), matching common sous vide guide practice.
- The sear model ignores contact-resistance/searing-surface cooling on
  contact; use a thermometer to confirm in practice.
