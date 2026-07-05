/**
 * data.js — reference constants: meat categories, doneness presets,
 * pan/meat material properties. Values are representative figures compiled
 * from food-engineering and public-health literature (Baldwin's "Practical
 * Guide to Sous Vide Cooking"; USDA FSIS time/temperature tables; standard
 * material property tables). They're defaults for planning, not lab
 * measurements of your specific cut — verify core temp with a thermometer.
 */

// Thermal diffusivity, alpha, m^2/s
const MEAT_CATEGORIES = {
  beef: {
    label: 'Beef (steak/roast)',
    alpha: 1.32e-7,
    pasteurize: { dRefMin: 0.204, tRefC: 70, zC: 5.0, logReduction: 5.0, mandatory: false },
    donenessPresets: [
      { key: 'rare', label: 'Rare', tempF: 120 },
      { key: 'medium-rare', label: 'Medium-Rare', tempF: 130 },
      { key: 'medium', label: 'Medium', tempF: 140 },
      { key: 'medium-well', label: 'Medium-Well', tempF: 150 },
      { key: 'well', label: 'Well Done', tempF: 160 },
    ],
  },
  lamb: {
    label: 'Lamb',
    alpha: 1.30e-7,
    pasteurize: { dRefMin: 0.204, tRefC: 70, zC: 5.0, logReduction: 5.0, mandatory: false },
    donenessPresets: [
      { key: 'rare', label: 'Rare', tempF: 120 },
      { key: 'medium-rare', label: 'Medium-Rare', tempF: 130 },
      { key: 'medium', label: 'Medium', tempF: 140 },
      { key: 'well', label: 'Well Done', tempF: 160 },
    ],
  },
  pork: {
    label: 'Pork (chop/loin)',
    alpha: 1.28e-7,
    pasteurize: { dRefMin: 0.204, tRefC: 70, zC: 5.0, logReduction: 5.0, mandatory: false },
    donenessPresets: [
      { key: 'medium-rare', label: 'Medium-Rare (blush)', tempF: 135 },
      { key: 'medium', label: 'Medium', tempF: 140 },
      { key: 'well', label: 'Well Done', tempF: 150 },
    ],
  },
  chicken: {
    label: 'Chicken (breast/thigh)',
    alpha: 1.42e-7,
    pasteurize: { dRefMin: 0.0636, tRefC: 70, zC: 5.5, logReduction: 6.5, mandatory: true },
    donenessPresets: [
      { key: 'tender', label: 'Tender & Juicy', tempF: 140 },
      { key: 'traditional', label: 'Traditional', tempF: 150 },
      { key: 'firm', label: 'Firm / Well Done', tempF: 160 },
    ],
  },
  turkey: {
    label: 'Turkey (breast)',
    alpha: 1.40e-7,
    pasteurize: { dRefMin: 0.0636, tRefC: 70, zC: 5.5, logReduction: 6.5, mandatory: true },
    donenessPresets: [
      { key: 'tender', label: 'Tender & Juicy', tempF: 140 },
      { key: 'traditional', label: 'Traditional', tempF: 150 },
      { key: 'firm', label: 'Firm / Well Done', tempF: 160 },
    ],
  },
  'ground-beef': {
    label: 'Ground Beef (patty)',
    alpha: 1.30e-7,
    pasteurize: { dRefMin: 0.204, tRefC: 70, zC: 5.0, logReduction: 6.5, mandatory: true },
    donenessPresets: [
      { key: 'medium', label: 'Medium', tempF: 140 },
      { key: 'medium-well', label: 'Medium-Well', tempF: 150 },
      { key: 'well', label: 'Well Done', tempF: 160 },
    ],
  },
};

const SHAPES = [
  { key: 'slab', label: 'Slab (steak / chop / patty)' },
  { key: 'cylinder', label: 'Cylindrical (tenderloin / sausage)' },
];

const INITIAL_TEMP_PRESETS = [
  { key: 'fridge', label: 'Refrigerated (3°C / 37°F)', tempC: 3 },
  { key: 'room', label: 'Room Temp (20°C / 68°F)', tempC: 20 },
  { key: 'frozen', label: 'Frozen (-18°C / 0°F)', tempC: -18, frozenBuffer: true },
];

// Meat properties for the sear model
const MEAT_SEAR_PROPS = {
  k: 0.47,      // thermal conductivity, W/m*K (lean muscle, ~70% water)
  rho: 1050,    // density, kg/m^3
  c: 3430,      // specific heat, J/kg*K
};

// Pan materials: k (W/m*K), rho (kg/m^3), c (J/kg*K), preheat presets (°C)
const PAN_MATERIALS = {
  'cast-iron': {
    label: 'Cast Iron',
    k: 50, rho: 7200, c: 450,
    heatPresets: [
      { key: 'medium-high', label: 'Medium-High', tempC: 204 },
      { key: 'high', label: 'High', tempC: 232 },
      { key: 'very-high', label: 'Very High', tempC: 260 },
    ],
    crustSecondsBySide: { 'medium-high': 90, high: 70, 'very-high': 50 },
  },
  copper: {
    label: 'Copper (tin/steel-lined)',
    k: 390, rho: 8960, c: 385,
    heatPresets: [
      { key: 'medium-high', label: 'Medium-High', tempC: 191 },
      { key: 'high', label: 'High', tempC: 218 },
      { key: 'very-high', label: 'Very High', tempC: 246 },
    ],
    crustSecondsBySide: { 'medium-high': 75, high: 55, 'very-high': 40 },
  },
};

const GRAY_BAND_DEFAULT = {
  thresholdF: 158,  // approx temp where myoglobin is fully denatured / tissue reads visually gray
  depthMm: 2,       // acceptable gray-band depth
};

export {
  MEAT_CATEGORIES, SHAPES, INITIAL_TEMP_PRESETS,
  MEAT_SEAR_PROPS, PAN_MATERIALS, GRAY_BAND_DEFAULT,
};
