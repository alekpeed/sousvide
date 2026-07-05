import {
  f2c, c2f,
  sousVideTimeSeconds, pasteurizationHoldSeconds,
  effusivity, contactTemp, maxSafeContactSeconds,
} from './physics.js';
import {
  MEAT_CATEGORIES, SHAPES, INITIAL_TEMP_PRESETS,
  MEAT_SEAR_PROPS, PAN_MATERIALS, GRAY_BAND_DEFAULT,
} from './data.js';

/* ---------- helpers ---------- */

const $ = (id) => document.getElementById(id);

function fmtHMS(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fillSelect(el, items, valueKey, labelKey) {
  el.innerHTML = '';
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item[valueKey];
    opt.textContent = item[labelKey];
    el.appendChild(opt);
  }
}

/* ---------- populate static selects ---------- */

function populateForm() {
  fillSelect($('meatCategory'), Object.entries(MEAT_CATEGORIES).map(([key, v]) => ({ key, label: v.label })), 'key', 'label');
  fillSelect($('shape'), SHAPES, 'key', 'label');
  fillSelect($('initialTemp'), INITIAL_TEMP_PRESETS, 'key', 'label');
  fillSelect($('panMaterial'), Object.entries(PAN_MATERIALS).map(([key, v]) => ({ key, label: v.label })), 'key', 'label');
  updateDonenessOptions();
  updateHeatLevelOptions();
}

function updateDonenessOptions() {
  const cat = MEAT_CATEGORIES[$('meatCategory').value];
  fillSelect($('doneness'), cat.donenessPresets.map(d => ({ key: d.key, label: `${d.label} (${d.tempF}°F / ${Math.round(f2c(d.tempF))}°C)` })), 'key', 'label');
  const pasteurizeToggle = $('pasteurize');
  if (cat.pasteurize.mandatory) {
    pasteurizeToggle.checked = true;
    pasteurizeToggle.disabled = true;
    $('pasteurizeNote').textContent = 'Required for this category (pathogens can be distributed throughout, not just on the surface).';
  } else {
    pasteurizeToggle.disabled = false;
    $('pasteurizeNote').textContent = 'Optional safety margin for whole-muscle cuts — your call.';
  }
}

function updateHeatLevelOptions() {
  const pan = PAN_MATERIALS[$('panMaterial').value];
  fillSelect($('heatLevel'), pan.heatPresets.map(h => ({ key: h.key, label: `${h.label} (${h.tempC}°C / ${Math.round(c2f(h.tempC))}°F)` })), 'key', 'label');
}

/* ---------- core calculation ---------- */

function getDonenessTempF(catKey, donenessKey) {
  const preset = MEAT_CATEGORIES[catKey].donenessPresets.find(d => d.key === donenessKey);
  return preset.tempF;
}

function calculate() {
  const catKey = $('meatCategory').value;
  const cat = MEAT_CATEGORIES[catKey];
  const shape = $('shape').value;
  const thicknessMm = parseFloat($('thickness').value);
  const initPreset = INITIAL_TEMP_PRESETS.find(p => p.key === $('initialTemp').value);
  const donenessTempF = getDonenessTempF(catKey, $('doneness').value);
  const bathTempC = f2c(donenessTempF);
  const doPasteurize = $('pasteurize').checked;
  const panKey = $('panMaterial').value;
  const pan = PAN_MATERIALS[panKey];
  const heatKey = $('heatLevel').value;
  const heatPreset = pan.heatPresets.find(h => h.key === heatKey);
  const grayDepthMm = parseFloat($('grayDepth').value) || GRAY_BAND_DEFAULT.depthMm;
  const grayThresholdF = parseFloat($('grayThreshold').value) || GRAY_BAND_DEFAULT.thresholdF;

  if (!thicknessMm || thicknessMm <= 0) {
    alert('Enter a valid thickness in mm.');
    return null;
  }

  // Sous vide come-up time
  let sousVideSeconds = sousVideTimeSeconds(thicknessMm, initPreset.tempC, bathTempC, cat.alpha, 0.5, shape);
  if (initPreset.frozenBuffer) {
    // Frozen start involves a latent-heat plateau this slab model doesn't capture directly.
    // Empirical buffer per Baldwin's guidance: roughly +50% for a frozen start.
    sousVideSeconds *= 1.5;
  }

  let pasteurizeSeconds = 0;
  if (doPasteurize) {
    pasteurizeSeconds = pasteurizationHoldSeconds(bathTempC, cat.pasteurize);
  }
  const totalSousVideSeconds = sousVideSeconds + pasteurizeSeconds;

  // Sear model
  const meatInitialC = bathTempC; // assume equilibrated when pulled from bath
  const ePan = effusivity(pan.k, pan.rho, pan.c);
  const eMeat = effusivity(MEAT_SEAR_PROPS.k, MEAT_SEAR_PROPS.rho, MEAT_SEAR_PROPS.c);
  const surfaceTempC = contactTemp(heatPreset.tempC, meatInitialC, ePan, eMeat);
  const grayThresholdC = f2c(grayThresholdF);

  const maxSafeSeconds = maxSafeContactSeconds(grayDepthMm, meatInitialC, surfaceTempC, grayThresholdC, cat.alpha);
  const crustTargetSeconds = pan.crustSecondsBySide[heatKey];
  const MIN_PRACTICAL_REP_SECONDS = 3; // flipping faster than this isn't practical by hand

  let reps; // [{side:'A'|'B', seconds}]
  let warning = null;
  const alreadyPastThreshold = grayThresholdC <= meatInitialC;
  if (alreadyPastThreshold) {
    // Target doneness already at/above the gray threshold — no gray band to protect against.
    reps = [
      { side: 'Side 1', seconds: crustTargetSeconds },
      { side: 'Side 2', seconds: crustTargetSeconds },
    ];
  } else if (!isFinite(maxSafeSeconds) || maxSafeSeconds >= crustTargetSeconds) {
    reps = [
      { side: 'Side 1', seconds: crustTargetSeconds },
      { side: 'Side 2', seconds: crustTargetSeconds },
    ];
  } else {
    const effectiveMax = Math.max(maxSafeSeconds, MIN_PRACTICAL_REP_SECONDS);
    const numRepsPerSide = Math.ceil(crustTargetSeconds / effectiveMax);
    const repSeconds = crustTargetSeconds / numRepsPerSide;
    reps = [];
    for (let i = 0; i < numRepsPerSide; i++) {
      reps.push({ side: 'Side 1', seconds: repSeconds });
      reps.push({ side: 'Side 2', seconds: repSeconds });
    }
    if (maxSafeSeconds < MIN_PRACTICAL_REP_SECONDS) {
      warning = `physics wants ~${maxSafeSeconds.toFixed(1)}s flips to hold a ${grayDepthMm}mm band — faster than practical by hand. Using ${MIN_PRACTICAL_REP_SECONDS}s reps instead; expect a slightly thicker gray band. Loosen the gray-band depth/threshold or drop the heat level for a tighter match.`;
    }
  }

  return {
    catKey, cat, shape, thicknessMm, initPreset, donenessTempF, bathTempC,
    doPasteurize, sousVideSeconds, pasteurizeSeconds, totalSousVideSeconds,
    panKey, pan, heatKey, heatPreset, grayDepthMm, grayThresholdF, grayThresholdC,
    surfaceTempC, maxSafeSeconds, crustTargetSeconds, reps, alreadyPastThreshold, warning,
  };
}

/* ---------- render results ---------- */

let lastResult = null;

function renderResults(r) {
  lastResult = r;
  $('resBathTemp').textContent = `${r.donenessTempF}°F / ${r.bathTempC.toFixed(1)}°C`;
  $('resSousVideTime').textContent = fmtHMS(r.sousVideSeconds);
  if (r.doPasteurize) {
    $('resPasteurizeRow').style.display = '';
    $('resPasteurizeTime').textContent = fmtHMS(r.pasteurizeSeconds);
  } else {
    $('resPasteurizeRow').style.display = 'none';
  }
  $('resTotalSousVideTime').textContent = fmtHMS(r.totalSousVideSeconds);

  $('resContactTemp').textContent = `${Math.round(c2f(r.surfaceTempC))}°F / ${r.surfaceTempC.toFixed(0)}°C`;
  $('resMaxSafe').textContent = r.alreadyPastThreshold
    ? 'n/a (target already exceeds gray threshold)'
    : (isFinite(r.maxSafeSeconds) ? `${r.maxSafeSeconds.toFixed(1)}s per contact` : 'no limit at this heat');
  $('resFlipPlan').textContent = r.reps.length > 2
    ? `${r.reps.length / 2}x flip per side, ${r.reps[0].seconds.toFixed(1)}s each`
    : `single sear per side, ${r.reps[0].seconds.toFixed(0)}s each`;

  const totalSearSeconds = r.reps.reduce((a, b) => a + b.seconds, 0);
  $('resTotalSearTime').textContent = fmtHMS(totalSearSeconds);

  $('resWarning').textContent = r.warning || '';
  $('resWarning').style.display = r.warning ? '' : 'none';

  $('setupView').classList.add('hidden');
  $('resultsView').classList.remove('hidden');
}

/* ---------- timers ---------- */

let timerHandle = null;

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function startSousVideTimer() {
  stopTimer();
  $('resultsView').classList.add('hidden');
  $('timerView').classList.remove('hidden');
  $('timerPhaseLabel').textContent = 'SOUS VIDE';
  $('timerSideLabel').textContent = `bath @ ${lastResult.donenessTempF}°F`;

  let remaining = Math.round(lastResult.totalSousVideSeconds);
  const total = remaining;
  render();
  timerHandle = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      remaining = 0;
      render();
      stopTimer();
      vibrate([300, 100, 300, 100, 300]);
      $('timerPhaseLabel').textContent = 'SOUS VIDE DONE';
      $('timerSideLabel').textContent = 'pull, pat dry, rest briefly, then sear';
      return;
    }
    render();
  }, 1000);

  function render() {
    $('timerDisplay').textContent = fmtHMS(remaining);
    $('timerProgress').style.width = `${100 * (1 - remaining / total)}%`;
  }
}

function startSearTimer() {
  stopTimer();
  $('resultsView').classList.add('hidden');
  $('timerView').classList.remove('hidden');
  $('timerPhaseLabel').textContent = 'SEAR';

  const reps = lastResult.reps;
  let repIndex = 0;
  let remaining = Math.round(reps[0].seconds * 10) / 10;

  function render() {
    $('timerSideLabel').textContent = `${reps[repIndex].side} — rep ${repIndex + 1}/${reps.length}`;
    $('timerDisplay').textContent = remaining.toFixed(1) + 's';
    const repTotal = reps[repIndex].seconds;
    $('timerProgress').style.width = `${100 * (1 - remaining / repTotal)}%`;
  }

  render();
  timerHandle = setInterval(() => {
    remaining -= 0.1;
    if (remaining <= 0) {
      repIndex += 1;
      if (repIndex >= reps.length) {
        stopTimer();
        vibrate([400, 100, 400, 100, 400]);
        $('timerPhaseLabel').textContent = 'SEAR DONE';
        $('timerSideLabel').textContent = 'rest 3-5 min, slice, serve';
        $('timerDisplay').textContent = '0:00';
        $('timerProgress').style.width = '100%';
        return;
      }
      vibrate(150);
      remaining = Math.round(reps[repIndex].seconds * 10) / 10;
    }
    render();
  }, 100);
}

/* ---------- wiring ---------- */

function init() {
  populateForm();
  $('meatCategory').addEventListener('change', updateDonenessOptions);
  $('panMaterial').addEventListener('change', updateHeatLevelOptions);

  $('calculateBtn').addEventListener('click', () => {
    const r = calculate();
    if (r) renderResults(r);
  });

  $('backToSetup').addEventListener('click', () => {
    $('resultsView').classList.add('hidden');
    $('setupView').classList.remove('hidden');
  });

  $('startSousVide').addEventListener('click', startSousVideTimer);
  $('startSear').addEventListener('click', startSearTimer);

  $('timerBack').addEventListener('click', () => {
    stopTimer();
    $('timerView').classList.add('hidden');
    $('resultsView').classList.remove('hidden');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
