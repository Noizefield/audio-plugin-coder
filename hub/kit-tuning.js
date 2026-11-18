'use strict';

// APC Minimal element tuning controls. This allowlist is intentionally separate
// from the browser: a Hub client can only change these known numeric properties.
const CONTROL_DEFS = {
  lineThickness: { label: 'Line thickness', target: 'css', cssVars: ['--stroke', '--hair'], unit: 'px', min: 0.5, max: 3, step: 0.25, token: '--stroke' },
  cornerRadius: { label: 'Corner radius', target: 'css', cssVars: ['--r-control', '--r-ctl'], unit: 'px', min: 0, max: 12, step: 0.5, token: '--r-control' },
  controlHeight: { label: 'Control height', target: 'css', cssVars: ['--w-h'], unit: 'rem', min: 1, max: 3, step: 0.125, default: 1.5 },
  elementWidth: { label: 'Element width', target: 'dimension', dimension: 'width', unit: 'rem', min: 0, max: 72, step: 0.25, default: 0, help: '0 keeps the size authored in the kit example.' },
  elementHeight: { label: 'Element height', target: 'dimension', dimension: 'height', unit: 'rem', min: 0, max: 40, step: 0.25, default: 0, help: '0 keeps the size authored in the kit example.' },
  knobDiameter: { label: 'Knob diameter', target: 'css', cssVars: ['--knob-size', '--apc-tune-knob-diameter'], unit: 'rem', min: 2, max: 6, step: 0.125, token: '--knob-size' },
  knobArc: { label: 'Knob arc thickness', target: 'css', cssVars: ['--knob-arc', '--apc-tune-knob-arc'], unit: 'px', min: 0.5, max: 4, step: 0.25, default: 2 },
  sliderLength: { label: 'Slider length', target: 'css', cssVars: ['--slider-len', '--apc-tune-slider-length'], unit: 'rem', min: 4, max: 12, step: 0.25, token: '--slider-len' },
  trackThickness: { label: 'Track thickness', target: 'css', cssVars: ['--track-w', '--apc-tune-track-thickness'], unit: 'px', min: 0.5, max: 8, step: 0.25, default: 2 },
  thumbSize: { label: 'Slider thumb size', target: 'css', cssVars: ['--thumb', '--apc-tune-thumb-size'], unit: 'rem', min: 0.5, max: 1.5, step: 0.025, default: 0.7 },
  nodeSize: { label: 'Visualisation node size', target: 'css', cssVars: ['--apc-viz-node'], unit: 'rem', min: 0.25, max: 1.25, step: 0.025, token: '--apc-viz-node' },
};

const CONTROL_ELEMENTS = new Set(['knob', 'slider', 'selector', 'toggle']);
const WIDGET_ELEMENTS = new Set([
  'button', 'buttons', 'segmented', 'checkbox', 'radio', 'dropdown', 'menu', 'tabs', 'list',
  'textfield', 'numberfield', 'label', 'readout', 'panel', 'divider', 'led', 'progress', 'logo',
  'header', 'footer', 'scale', 'gripper', 'theme-switch', 'help-button', 'infobar', 'preset-chip',
  'context-panel', 'tooltip', 'toast', 'settings', 'license', 'update', 'presets',
]);
const VIZ_ELEMENTS = new Set(['graph', 'envelope', 'spectrum', 'waveform', 'scope', 'meter', 'stepseq', 'xypad', 'picture']);
const TRACK_ELEMENTS = new Set(['slider', 'meter', 'progress']);
const BASIC_ELEMENTS = new Set([...CONTROL_ELEMENTS, ...WIDGET_ELEMENTS, ...VIZ_ELEMENTS]);

function tokenDefaults(css) {
  const text = String(css || '').split(/\[data-theme\s*=\s*["']day["']\s*\]/i)[0];
  const values = {};
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*(-?[\d.]+)\s*(px|rem|em)?\s*;/g;
  let m;
  while ((m = re.exec(text))) values[m[1]] = { value: Number(m[2]), unit: m[3] || '' };
  return values;
}

function controlsFor(name, tokens) {
  if (!BASIC_ELEMENTS.has(name)) return [];
  const keys = ['lineThickness', 'cornerRadius', 'elementWidth', 'elementHeight'];
  if (CONTROL_ELEMENTS.has(name) || WIDGET_ELEMENTS.has(name)) keys.splice(2, 0, 'controlHeight');
  if (name === 'knob') keys.push('knobDiameter', 'knobArc');
  if (name === 'slider') keys.push('sliderLength', 'trackThickness', 'thumbSize');
  if (TRACK_ELEMENTS.has(name) && name !== 'slider') keys.push('trackThickness');
  if (VIZ_ELEMENTS.has(name)) keys.push('nodeSize');
  return keys.map((key) => {
    const def = CONTROL_DEFS[key];
    const tok = def.token && tokens[def.token];
    const value = def.default !== undefined ? def.default : tok ? tok.value : 0;
    const cssVars = key === 'cornerRadius' && name === 'panel' ? ['--r-control', '--r-panel', '--r-ctl', '--r-block'] : (def.cssVars || []);
    return { key, label: def.label, target: def.target, cssVars, dimension: def.dimension || null,
      unit: def.unit, min: def.min, max: def.max, step: def.step, default: value, help: def.help || '' };
  });
}

function schemaFor(elements, css) {
  const tokens = tokenDefaults(css);
  const schema = {};
  for (const name of Object.keys(elements || {})) {
    if (name.charAt(0) === '_' || !elements[name] || typeof elements[name] !== 'object') continue;
    const controls = controlsFor(name, tokens);
    if (controls.length) schema[name] = controls;
  }
  return schema;
}

function validateValues(element, values, schema) {
  if (!schema || !Array.isArray(schema[element])) return { ok: false, error: 'unknown-element' };
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { ok: false, error: 'invalid-values' };
  const defs = new Map(schema[element].map((c) => [c.key, c]));
  const normalized = {};
  for (const key of Object.keys(values)) {
    const def = defs.get(key);
    const n = values[key];
    if (!def) return { ok: false, error: 'unknown-property', property: key };
    if (typeof n !== 'number' || !Number.isFinite(n) || n < def.min || n > def.max) return { ok: false, error: 'value-out-of-range', property: key };
    const steps = (n - def.min) / def.step;
    if (Math.abs(steps - Math.round(steps)) > 0.002) return { ok: false, error: 'invalid-step', property: key };
    const clean = Math.round(n * 10000) / 10000;
    if (clean !== def.default) normalized[key] = clean;
  }
  return { ok: true, values: normalized };
}

module.exports = { schemaFor, validateValues, tokenDefaults };
