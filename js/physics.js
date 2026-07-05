/**
 * physics.js — thermodynamic core for the sous vide + sear calculator.
 *
 * All models are 1-D transient heat conduction (Fourier's law) with the
 * classic closed-form approximations used in food-engineering literature
 * (Baldwin, "Practical Guide to Sous Vide Cooking"; Carslaw & Jaeger,
 * "Conduction of Heat in Solids"). Nothing here calls a network or an LLM
 * at runtime — it's plain deterministic math.
 */

/* ---------- error function / inverse (Abramowitz & Stegun 7.1.26) ---------- */

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function erfc(x) {
  return 1 - erf(x);
}

/** Inverse erfc via Newton-Raphson, seeded from a rational approximation. */
function erfcInv(y) {
  // y must be in (0, 2)
  if (y <= 0) return Infinity;
  if (y >= 2) return -Infinity;
  const x0 = 1 - y;
  // Winitzki approximation for erfinv as a starting guess
  const a = 0.147;
  const ln = Math.log(1 - x0 * x0);
  const term1 = 2 / (Math.PI * a) + ln / 2;
  let guess = Math.sign(x0) * Math.sqrt(Math.sqrt(term1 * term1 - ln / a) - term1);
  // Newton refine on f(z) = erfc(z) - y
  for (let i = 0; i < 6; i++) {
    const fz = erfc(guess) - y;
    const dfz = -(2 / Math.sqrt(Math.PI)) * Math.exp(-guess * guess);
    guess = guess - fz / dfz;
  }
  return guess;
}

/* ---------- unit helpers ---------- */

const f2c = (f) => (f - 32) * 5 / 9;
const c2f = (c) => c * 9 / 5 + 32;
const mm2m = (mm) => mm / 1000;

/* ---------- sous-vide come-up-to-temperature time ---------- */

// First-eigenvalue coefficients for the transient conduction series solution
// at the center of the geometry, Biot -> infinity (surface instantly at bath temp).
const GEOMETRY = {
  slab: { lambda1Sq: (Math.PI * Math.PI) / 4, C: 4 / Math.PI },       // steak / chop, flat slab
  cylinder: { lambda1Sq: 5.7831, C: 1.6020 },                          // tenderloin / sausage shape
};

/**
 * Time (seconds) for the geometric center of a piece of meat to come within
 * `toleranceC` degrees of the water bath temperature.
 *
 * @param thicknessMm  full thickness (slab) or diameter (cylinder), mm
 * @param initialTempC starting internal temp of the meat, °C
 * @param bathTempC    water bath temperature, °C (== target core temp)
 * @param alpha        thermal diffusivity, m²/s
 * @param toleranceC   how close to bath temp counts as "done", °C (default 0.5)
 * @param shape        'slab' | 'cylinder'
 */
function sousVideTimeSeconds(thicknessMm, initialTempC, bathTempC, alpha, toleranceC = 0.5, shape = 'slab') {
  const g = GEOMETRY[shape] || GEOMETRY.slab;
  const L = mm2m(thicknessMm) / 2; // half-thickness (slab) or radius (cylinder)
  const driveC = bathTempC - initialTempC;
  if (driveC <= 0) return 0;
  const ratio = (g.C * driveC) / toleranceC;
  if (ratio <= 1) return 0; // already within tolerance
  const Fo = Math.log(ratio) / g.lambda1Sq;
  const t = (Fo * L * L) / alpha;
  return Math.max(0, t);
}

/* ---------- pasteurization hold time (D-value / z-value model) ---------- */

/**
 * Additional hold time (seconds) needed at a constant core temperature to
 * achieve the target log-reduction of the reference pathogen, using the
 * standard log-linear D-value/z-value thermal death time model:
 *   D(T) = Dref * 10^((Tref - T) / z)
 *   hold  = D(T) * logReduction
 *
 * Reference constants are representative values compiled from public-health
 * literature (USDA FSIS time/temperature tables; van Asselt & Zwietering
 * 2006 for Salmonella/E. coli D- and z-values). They are provided for
 * planning purposes only — cross-check against USDA FSIS or your local
 * health authority before relying on this for food safety.
 */
function pasteurizationHoldSeconds(coreTempC, { dRefMin, tRefC, zC, logReduction }) {
  const D = dRefMin * Math.pow(10, (tRefC - coreTempC) / zC);
  const holdMin = Math.max(0, D * logReduction);
  return holdMin * 60;
}

/* ---------- searing: contact temperature via thermal effusivity ---------- */

/** Thermal effusivity e = sqrt(k * rho * c), units W·s^0.5/(m^2·K) */
function effusivity(k, rho, c) {
  return Math.sqrt(k * rho * c);
}

/**
 * Interface (contact) temperature reached when two semi-infinite bodies at
 * different starting temperatures are pressed together (Carslaw & Jaeger).
 * This is why copper (high effusivity) holds its preheated temperature at
 * the meat's surface far better than cast iron (lower effusivity), even
 * when both are "preheated to the same dial setting."
 */
function contactTemp(panTempC, meatTempC, ePan, eMeat) {
  return (ePan * panTempC + eMeat * meatTempC) / (ePan + eMeat);
}

/**
 * Temperature at depth x (m) below the seared surface after time t (s),
 * for a semi-infinite solid suddenly held at a fixed surface temperature
 * `surfaceTempC` (Carslaw & Jaeger's classic solution).
 */
function tempAtDepth(xMeters, tSeconds, meatInitialTempC, surfaceTempC, alphaMeat) {
  if (tSeconds <= 0) return meatInitialTempC;
  const z = xMeters / (2 * Math.sqrt(alphaMeat * tSeconds));
  return meatInitialTempC + (surfaceTempC - meatInitialTempC) * erfc(z);
}

/**
 * Max continuous contact time (seconds) before the tissue at `grayDepthMm`
 * below the surface first crosses `grayThresholdC` — i.e. the gray band
 * has just reached that depth. Returns Infinity if the surface temp can
 * never drive that depth past the threshold (e.g. target doneness already
 * exceeds the gray threshold).
 */
function maxSafeContactSeconds(grayDepthMm, meatInitialTempC, surfaceTempC, grayThresholdC, alphaMeat) {
  if (grayThresholdC <= meatInitialTempC) return 0; // already past threshold at rest
  if (surfaceTempC <= grayThresholdC) return Infinity; // surface can't ever reach threshold at that depth
  const ratio = (grayThresholdC - meatInitialTempC) / (surfaceTempC - meatInitialTempC);
  if (ratio <= 0) return Infinity;
  if (ratio >= 1) return 0;
  const z = erfcInv(ratio);
  if (!isFinite(z) || z <= 0) return Infinity;
  const x = mm2m(grayDepthMm);
  const t = (x * x) / (4 * alphaMeat * z * z);
  return t;
}

export {
  erf, erfc, erfcInv,
  f2c, c2f, mm2m,
  sousVideTimeSeconds,
  pasteurizationHoldSeconds,
  effusivity, contactTemp, tempAtDepth, maxSafeContactSeconds,
  GEOMETRY,
};
