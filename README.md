# Sous Vide + Sear Timing Calculator

A no-frills, terminal-styled PWA that calculates:

1. **Sous vide bath time & temperature** — from cut, thickness, starting temp, and target doneness, using the transient-conduction (Fourier) heat-transfer solution for a slab or cylinder, plus an optional pasteurization hold (D-value/z-value model).
2. **Post-bath sear countdown** — a second-by-second timer that limits each side's contact time so the "gray band" beneath the crust stays within a depth you set, using the semi-infinite-solid conduction solution and the thermal-effusivity contact temperature between the meat and your cast-iron or copper pan.

No backend, no accounts, no network calls at runtime — it's pure client-side math.

## Install on your phone (Pixel 10 Pro XL or any Android)

Once this repo's GitHub Pages deploy finishes (Settings → Pages → set source to "GitHub Actions" once, after that every push to `main` redeploys automatically):

1. Open the Pages URL in Chrome on the phone.
2. Tap the menu (⋮) → **Add to Home screen** → **Install**.
3. It launches full-screen like a native app and works offline after the first load (service worker caches all assets).

## Run locally

No build step. Any static file server works:

```
npx http-server -p 8080
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## How the numbers are calculated

- **Bath come-up time**: `t = (λ₁² )⁻¹ · L²/α · ln[C·(T_bath − T_initial)/tolerance]`, the first-term eigenfunction solution for a slab (`C = 4/π`) or cylinder (`C = 1.602`), where `L` is half-thickness (or radius) and `α` is the meat's thermal diffusivity.
- **Pasteurization hold**: `D(T) = D_ref · 10^((T_ref − T)/z)`, hold time `= D(T) × log-reduction`, using representative D/z values compiled from public-health literature (USDA FSIS time/temperature tables; van Asselt & Zwietering 2006). These are planning defaults — cross-check against USDA FSIS or your local health authority for anything safety-critical.
- **Sear contact temperature**: when two semi-infinite bodies (pan, meat) are pressed together, the interface settles at `T_c = (e_pan·T_pan + e_meat·T_meat) / (e_pan + e_meat)`, where `e = √(k·ρ·c)` is thermal effusivity. This is why copper (much higher effusivity) holds its preheated temperature at the surface far better than cast iron.
- **Gray-band-limited sear time**: solves the semi-infinite-solid conduction solution `T(x,t) = T_i + (T_c − T_i)·erfc(x / (2√(αt)))` for the time at which your chosen depth first crosses your chosen gray-band threshold temperature, then splits the total crust-development time into that many flips per side (matching the well-documented "frequent flipping reduces the gray band" result).

All constants (thermal diffusivity/conductivity/density/specific heat for meat, cast iron, and copper) are typical literature values — real cuts vary with fat content and hydration. Always verify core temperature with a probe thermometer.

## Project layout

```
index.html          markup / views (setup, results, timer)
css/style.css        terminal-dark mobile-first styling
js/physics.js         heat-transfer math (no UI, no dependencies)
js/data.js            meat/pan/doneness reference constants
js/app.js              wires the form to physics.js and drives the timers
manifest.webmanifest   PWA metadata
sw.js                  offline cache (service worker)
icons/                 app icons
.github/workflows/deploy.yml   GitHub Pages auto-deploy
```
