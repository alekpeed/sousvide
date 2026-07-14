"use strict";

/* ---------------------------------------------------------------------
 * Reference data
 *
 * alpha  : thermal diffusivity of the meat, m^2/s (k / (rho * cp))
 * k      : thermal conductivity, W/(m*K)  -- used for the Biot number
 * category drives which pasteurization log-reduction target is used.
 *
 * Values are typical-of-category approximations compiled from published
 * food-engineering references (they vary with fat/moisture content in
 * real cuts). Good enough for planning a cook; not a lab measurement.
 * ------------------------------------------------------------------- */
const MEATS = {
  beef: {
    label: "Beef steak/roast",
    alpha: 1.32e-7,
    k: 0.48,
    category: "redmeat",
    doneness: [
      { id: "rare", label: "Rare", tempC: 49 },
      { id: "mediumrare", label: "Medium-rare", tempC: 54 },
      { id: "medium", label: "Medium", tempC: 60 },
      { id: "mediumwell", label: "Medium-well", tempC: 65 },
      { id: "welldone", label: "Well-done", tempC: 71 },
    ],
  },
  pork: {
    label: "Pork chop/loin",
    alpha: 1.28e-7,
    k: 0.47,
    category: "pork",
    doneness: [
      { id: "medium", label: "Medium, juicy", tempC: 60 },
      { id: "mediumwell", label: "Medium-well", tempC: 65 },
      { id: "welldone", label: "Well-done", tempC: 71 },
    ],
  },
  chicken: {
    label: "Chicken breast",
    alpha: 1.20e-7,
    k: 0.45,
    category: "poultry",
    doneness: [
      { id: "juicy", label: "Juicy & tender", tempC: 65 },
      { id: "firm", label: "Firm, traditional texture", tempC: 74 },
    ],
  },
  fish: {
    label: "Fish (salmon / firm white)",
    alpha: 1.40e-7,
    k: 0.50,
    category: "fish",
    doneness: [
      { id: "rare", label: "Rare / silky", tempC: 45 },
      { id: "medium", label: "Medium", tempC: 50 },
      { id: "welldone", label: "Well-done, flaky", tempC: 60 },
    ],
  },
};

// USDA-style default log-reduction targets per category (whole-muscle cuts assumed).
const DEFAULT_LOG_REDUCTION = {
  redmeat: 5.0,
  pork: 5.0,
  fish: 5.0,
  poultry: 6.5,
};

// Approximate absolute core temperature (degC) at which meat visibly turns
// "gray"/fully well-done at that spot -- used to size the sear's allowable
// temperature excursion above the target doneness. Whole-muscle references.
const GRAY_ONSET_C = {
  redmeat: 68,
  pork: 68,
  poultry: 82,
  fish: 62,
};

// Searing surface presets. h is an *effective contact* heat-transfer
// coefficient (W/m^2K) through the thin fat/moisture film between pan and
// meat -- much lower than the pan's own thermometer reading would suggest,
// since most of a ripping-hot pan's heat goes into surface evaporation
// rather than conducting straight into the meat. panTempC is the
// contact-adjusted effective surface driving temperature, not the pan dial.
const PAN_PRESETS = {
  castiron: { label: "Cast iron, ripping hot (~500°F/260°C pan)", h: 45, panTempC: 204 },
  carbon: { label: "Carbon steel / copper (~450°F/230°C pan)", h: 38, panTempC: 190 },
  stainless: { label: "Stainless, moderate (~390°F/200°C pan)", h: 28, panTempC: 175 },
};

// Bigelow (D/z) pasteurization kinetics, Salmonella proxy used across categories.
// D_ref: minutes to achieve 1-log reduction at T_ref. z: degC rise for 10x speedup.
const D_REF_MIN = 1.0;
const T_REF_C = 60.0;
const Z_C = 5.5;

/* ---------------------------------------------------------------------
 * Sous vide come-up time: 1-D explicit finite-difference transient
 * conduction, symmetric slab (insulated center, convective surface).
 * Returns seconds for the center node to come within tolC of the
 * (equal-to-target) water bath temperature.
 * ------------------------------------------------------------------- */
function comeUpTimeSeconds({ halfThicknessM, alpha, k, h, initialTempC, waterTempC, tolC }) {
  const N = 25; // nodes across the half-thickness, node 0 = center
  const dx = halfThicknessM / (N - 1);
  const BiDx = (h * dx) / k;

  // Stability: interior Fo <= 0.5, boundary Fo*(1+BiDx) <= 0.5. Take the tighter, with margin.
  const FoMax = Math.min(0.5, 0.5 / (1 + BiDx));
  const Fo = 0.9 * FoMax;
  const dt = (Fo * dx * dx) / alpha;

  const T = new Array(N).fill(initialTempC);
  const Tnext = new Array(N).fill(initialTempC);

  const targetReached = waterTempC - tolC; // core rising toward waterTempC
  const maxSteps = 5_000_000;
  let step = 0;

  if (T[0] >= targetReached) return 0;

  while (step < maxSteps) {
    // center (symmetry, ghost node reflection)
    Tnext[0] = T[0] + 2 * Fo * (T[1] - T[0]);
    // interior
    for (let i = 1; i < N - 1; i++) {
      Tnext[i] = T[i] + Fo * (T[i + 1] - 2 * T[i] + T[i - 1]);
    }
    // surface, convective boundary (half control-volume energy balance)
    const last = N - 1;
    Tnext[last] = T[last] + 2 * Fo * (T[last - 1] - T[last]) + 2 * Fo * BiDx * (waterTempC - T[last]);

    for (let i = 0; i < N; i++) T[i] = Tnext[i];
    step++;

    if (T[0] >= targetReached) break;
  }

  return step * dt;
}

/* ---------------------------------------------------------------------
 * Pasteurization hold time at the target core temperature (Bigelow model).
 * ------------------------------------------------------------------- */
function pasteurizationHoldSeconds(coreTempC, logReduction) {
  const D_T = D_REF_MIN * Math.pow(10, (T_REF_C - coreTempC) / Z_C);
  const minutes = logReduction * D_T;
  return Math.max(0, minutes * 60);
}

/* ---------------------------------------------------------------------
 * Sear timing: 1-D transient conduction into a semi-infinite slab of
 * meat, with a *convective* (finite heat-transfer coefficient) boundary
 * at the seared face rather than an idealized instant jump to pan
 * temperature -- real contact through a fat/moisture film limits the
 * heat flux far below what the pan's own temperature would imply.
 *
 * Simulated explicitly (same scheme as the sous vide solver) with an
 * insulated far boundary placed well beyond the depth of interest.
 * Returns the elapsed time at which the temperature at depth xMaxM
 * first reaches the gray-band onset temperature -- i.e. the longest a
 * side can sear before the gray zone exceeds that depth.
 * ------------------------------------------------------------------- */
function maxSearSecondsPerSide({ alpha, k, h, panTempC, coreTempC, grayOnsetC, xMaxM }) {
  const M = 10; // grid subdivisions across xMaxM, so a node lands exactly at depth xMaxM
  const dx = xMaxM / M;
  const domainLen = Math.max(0.02, 4 * xMaxM); // far beyond xMaxM so the insulated end doesn't taint the reading
  const N = Math.round(domainLen / dx) + 1;

  const BiDx = (h * dx) / k;
  const FoMax = Math.min(0.5, 0.5 / (1 + BiDx));
  const Fo = 0.9 * FoMax;
  const dt = (Fo * dx * dx) / alpha;

  let T = new Array(N).fill(coreTempC);
  let Tn = new Array(N).fill(coreTempC);

  const maxSeconds = 20 * 60;
  const maxSteps = Math.ceil(maxSeconds / dt);

  for (let step = 1; step <= maxSteps; step++) {
    // surface node (convective boundary to the pan's effective contact temp)
    Tn[0] = T[0] + 2 * Fo * (T[1] - T[0]) + 2 * Fo * BiDx * (panTempC - T[0]);
    for (let i = 1; i < N - 1; i++) {
      Tn[i] = T[i] + Fo * (T[i + 1] - 2 * T[i] + T[i - 1]);
    }
    Tn[N - 1] = T[N - 1] + 2 * Fo * (T[N - 2] - T[N - 1]); // insulated far end

    [T, Tn] = [Tn, T];

    if (T[M] >= grayOnsetC) {
      return step * dt;
    }
  }
  return maxSeconds; // gray onset not reached within 20 min -- effectively unconstrained
}

/* ---------------------------------------------------------------------
 * Unit helpers
 * ------------------------------------------------------------------- */
const toC = (f) => ((f - 32) * 5) / 9;
const toM = (mm) => mm / 1000;
const inToMm = (inches) => inches * 25.4;

function fmtHMS(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

function fmtMMSS(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------------
 * UI wiring
 * ------------------------------------------------------------------- */
const els = {
  meat: document.getElementById("meat"),
  doneness: document.getElementById("doneness"),
  thickness: document.getElementById("thickness"),
  initTemp: document.getElementById("initTemp"),
  agitation: document.getElementById("agitation"),
  panMaterial: document.getElementById("panMaterial"),
  grayBand: document.getElementById("grayBand"),
  tolC: document.getElementById("tolC"),
  logReduction: document.getElementById("logReduction"),
  calcBtn: document.getElementById("calcBtn"),
  resultsPanel: document.getElementById("results-panel"),
  waterTemp: document.getElementById("waterTemp"),
  comeUpTime: document.getElementById("comeUpTime"),
  holdTime: document.getElementById("holdTime"),
  totalTime: document.getElementById("totalTime"),
  windowNote: document.getElementById("windowNote"),
  searSurfaceTemp: document.getElementById("searSurfaceTemp"),
  searTimePerSide: document.getElementById("searTimePerSide"),
  searNote: document.getElementById("searNote"),
  timerDisplay: document.getElementById("timerDisplay"),
  timerSideLabel: document.getElementById("timerSideLabel"),
  timerStart: document.getElementById("timerStart"),
  timerFlip: document.getElementById("timerFlip"),
  timerReset: document.getElementById("timerReset"),
};

let thicknessUnit = "mm";
let tempUnit = "c";

function populateMeats() {
  els.meat.innerHTML = "";
  for (const [id, m] of Object.entries(MEATS)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = m.label;
    els.meat.appendChild(opt);
  }
  populateDoneness();
}

function populatePanPresets() {
  els.panMaterial.innerHTML = "";
  for (const [id, p] of Object.entries(PAN_PRESETS)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = p.label;
    els.panMaterial.appendChild(opt);
  }
}

function populateDoneness() {
  const meat = MEATS[els.meat.value];
  els.doneness.innerHTML = "";
  for (const d of meat.doneness) {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = `${d.label} (${d.tempC}°C / ${Math.round((d.tempC * 9) / 5 + 32)}°F)`;
    els.doneness.appendChild(opt);
  }
}

document.querySelectorAll(".unit-btn[data-unit]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".unit-btn[data-unit]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const newUnit = btn.dataset.unit;
    if (newUnit !== thicknessUnit) {
      const val = parseFloat(els.thickness.value) || 0;
      els.thickness.value = newUnit === "in" ? +(val / 25.4).toFixed(2) : Math.round(inToMm(val) || val);
      if (thicknessUnit === "mm" && newUnit === "in") els.thickness.value = +(val / 25.4).toFixed(2);
      if (thicknessUnit === "in" && newUnit === "mm") els.thickness.value = Math.round(val * 25.4);
      thicknessUnit = newUnit;
    }
  });
});

document.querySelectorAll(".unit-btn[data-tunit]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".unit-btn[data-tunit]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const newUnit = btn.dataset.tunit;
    if (newUnit !== tempUnit) {
      const val = parseFloat(els.initTemp.value) || 0;
      els.initTemp.value = newUnit === "f" ? Math.round((val * 9) / 5 + 32) : +(((val - 32) * 5) / 9).toFixed(1);
      tempUnit = newUnit;
    }
  });
});

els.meat.addEventListener("change", populateDoneness);

function runCalculation() {
  const meat = MEATS[els.meat.value];
  const doneness = meat.doneness.find((d) => d.id === els.doneness.value);

  const thicknessRaw = parseFloat(els.thickness.value);
  const thicknessMm = thicknessUnit === "in" ? inToMm(thicknessRaw) : thicknessRaw;
  const thicknessM = toM(thicknessMm);
  const halfThicknessM = thicknessM / 2;

  const initTempRaw = parseFloat(els.initTemp.value);
  const initialTempC = tempUnit === "f" ? toC(initTempRaw) : initTempRaw;

  const h = parseFloat(els.agitation.value);
  const tolC = parseFloat(els.tolC.value);
  const targetTempC = doneness.tempC;
  const waterTempC = targetTempC; // standard practice: bath temp == target core temp

  const comeUpS = comeUpTimeSeconds({
    halfThicknessM,
    alpha: meat.alpha,
    k: meat.k,
    h,
    initialTempC,
    waterTempC,
    tolC,
  });

  const logReductionSetting = els.logReduction.value;
  const logReduction = logReductionSetting === "auto" ? DEFAULT_LOG_REDUCTION[meat.category] : parseFloat(logReductionSetting);
  const holdS = pasteurizationHoldSeconds(targetTempC - tolC, logReduction);

  const totalS = comeUpS + holdS;

  els.waterTemp.textContent = `${waterTempC.toFixed(1)}°C / ${((waterTempC * 9) / 5 + 32).toFixed(1)}°F`;
  els.comeUpTime.textContent = fmtHMS(comeUpS);
  els.holdTime.textContent = fmtHMS(holdS);
  els.totalTime.textContent = fmtHMS(totalS);
  els.windowNote.textContent =
    `Safe minimum bath time using a ${logReduction.toFixed(1)}-log pathogen reduction target ` +
    `(D=${D_REF_MIN}min @ ${T_REF_C}°C, z=${Z_C}°C). Sous vide is forgiving on the high side — ` +
    `holding another 1–2h generally improves tenderness on tougher cuts without overcooking, since the ` +
    `bath never exceeds the target temperature.`;

  const pan = PAN_PRESETS[els.panMaterial.value];
  const xMaxM = toM(parseFloat(els.grayBand.value));
  const grayOnsetC = GRAY_ONSET_C[meat.category];
  const marginC = grayOnsetC - targetTempC;

  els.searSurfaceTemp.textContent = pan.label;

  let searS;
  if (marginC <= 2) {
    searS = 90; // no gray-band constraint left; default to a generic crust-searing window
    els.searTimePerSide.textContent = "n/a (crust only)";
    els.searNote.textContent =
      `Target doneness (${targetTempC}°C) is already at or past the ~${grayOnsetC}°C gray-onset point for this ` +
      `category, so there's no meaningful gray band left to protect — sear is purely for crust. Go as long as ` +
      `you like for color; timer defaults to 90s as a starting point.`;
  } else {
    searS = maxSearSecondsPerSide({
      alpha: meat.alpha,
      k: meat.k,
      h: pan.h,
      panTempC: pan.panTempC,
      coreTempC: targetTempC,
      grayOnsetC,
      xMaxM,
    });
    els.searTimePerSide.textContent = searS >= 20 * 60 ? "20+ min" : `${searS.toFixed(0)}s`;
    els.searNote.textContent =
      `Convective-contact conduction model (effective h=${pan.h} W/m²K through the fat/moisture film): keeps ` +
      `meat at depth ${(xMaxM * 1000).toFixed(1)}mm below ${grayOnsetC}°C (this category's approximate gray-onset ` +
      `temperature, ${marginC.toFixed(0)}°C above your target). Sear both sides plus edges as needed; re-check ` +
      `core temp with a thermometer, since real contact varies with pan flatness and moisture.`;
  }

  els.resultsPanel.hidden = false;
  resetTimer(Math.min(searS, 20 * 60));
  els.resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

els.calcBtn.addEventListener("click", runCalculation);

/* ---------------------------------------------------------------------
 * Sear countdown timer (second-by-second, two sides)
 * ------------------------------------------------------------------- */
let timerState = {
  perSideSeconds: 60,
  remaining: 60,
  side: 1,
  intervalId: null,
  running: false,
};

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    /* audio not available; ignore */
  }
}

function renderTimer() {
  els.timerDisplay.textContent = fmtMMSS(timerState.remaining);
  els.timerDisplay.classList.toggle("warn", timerState.remaining <= 5);
  els.timerSideLabel.textContent = `side ${timerState.side} of 2`;
}

function resetTimer(perSideSeconds) {
  clearInterval(timerState.intervalId);
  timerState = {
    perSideSeconds,
    remaining: perSideSeconds,
    side: 1,
    intervalId: null,
    running: false,
  };
  els.timerStart.textContent = "start";
  els.timerStart.disabled = false;
  els.timerFlip.disabled = true;
  renderTimer();
}

function tick() {
  timerState.remaining -= 1;
  if (timerState.remaining <= 0) {
    beep();
    clearInterval(timerState.intervalId);
    timerState.running = false;
    timerState.remaining = 0;
    if (timerState.side === 1) {
      els.timerFlip.disabled = false;
      els.timerStart.disabled = true;
    } else {
      els.timerStart.textContent = "done";
      els.timerStart.disabled = true;
    }
  }
  renderTimer();
}

els.timerStart.addEventListener("click", () => {
  if (timerState.running) return;
  timerState.running = true;
  els.timerStart.disabled = true;
  timerState.intervalId = setInterval(tick, 1000);
});

els.timerFlip.addEventListener("click", () => {
  clearInterval(timerState.intervalId);
  timerState.side = 2;
  timerState.remaining = timerState.perSideSeconds;
  timerState.running = false;
  els.timerFlip.disabled = true;
  els.timerStart.disabled = false;
  els.timerStart.textContent = "start side 2";
  renderTimer();
});

els.timerReset.addEventListener("click", () => resetTimer(timerState.perSideSeconds));

populateMeats();
populatePanPresets();
