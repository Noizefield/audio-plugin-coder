'use strict';
// Design-pass guard: the Zeichnung-2030 restyles live as appended blocks at the END of the
// kit stylesheets, which makes them easy to delete by accident (a trim at an anchor comment
// once took the knob + fader block with it, and the knobs silently reverted to the first
// flat styling). These assertions only need the text, so they run in milliseconds.
// Zero deps: node:test + node:assert.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const KIT = path.join(ROOT, 'templates', 'webview', 'apc-ui');
const read = (f) => fs.readFileSync(path.join(KIT, f), 'utf8');
const tokensCss = fs.readFileSync(path.join(ROOT, 'design_library', 'apc-minimal', 'tokens.css'), 'utf8');

const components = read('apc-components.css');
const viz = read('apc-viz.css');
const vizJs = read('apc-viz.js');

test('knob: quiet track, 2px arc, no tick ring, rim pointer', () => {
  assert.match(components, /\.apc-ring__track \{ stroke: var\(--rule-2\); stroke-width: 2; stroke-linecap: round; \}/,
    'knob track must be the quiet --rule-2 guide (--rule made the ring shout)');
  assert.match(components, /\.apc-ring__value \{ stroke: var\(--accent\); stroke-width: 2;/,
    'value arc must ride the track in the accent colour');
  assert.match(components, /\.apc-ring__tick \{ display: none; \}/, 'the plate has no tick ring');
  assert.match(components, /\.apc-knob-pointer::before \{/, 'pointer is the ::before bar');
  assert.match(components, /top: 10%;/, 'pointer bar starts at 10% of the dial (the plate value)');
  assert.match(components, /height: 19%;/, 'pointer bar is 19% long (the plate value)');
});

test('knob: modulation band is warm and thin, not a white halo', () => {
  assert.match(components, /\.apc-ring__sum \{ stroke: var\(--memory\); stroke-width: 1\.5;/,
    'the modulation band must be warm (--memory), 1.5px - it was a --ink band at r=49');
  assert.match(components, /\.apc-ring__marker \{ fill: var\(--memory\);/, 'the modulated-value dot is warm too');
  assert.match(read('apc-controls.js'), /R_MOD = 42/, 'the band sits between dial (38) and track (46), not at the edge');
});

test('knob ring is a path, not a dash on a non-scaling-stroke circle', () => {
  const controls = read('apc-controls.js');
  assert.match(controls, /ui\.ringTrack = svgEl\("path", \{ "class": "apc-ring__track", d: arcPath\(/,
    'dash lengths are screen px under vector-effect:non-scaling-stroke, so the 270deg dash painted closed');
  assert.doesNotMatch(controls, /stroke-dasharray.*ringC/, 'no dash-based track');
});

test('fader: 2px quiet rail, thin tall cap, label above the value', () => {
  assert.match(components, /\.apc-fader \{ --track-w: 2px; \}/, 'rail is 2px, not the 4px :root default');
  assert.match(components, /\.apc-fader-track \{ background: var\(--rule-2\);/, 'rail must be the quiet colour');
  assert.match(components, /\.apc-fader > \.apc-ctl-label \{ order: -1; \}/, 'name above the value');
  assert.match(components, /\.apc-fader-cap::after \{ display: none; \}/, 'no centre line on the cap');
  assert.match(components, /\.apc-fader-ticks \{ display: none; \}/, 'no ticks');
});

test('toggle: 2px-radius track with a square cam (not a pill)', () => {
  assert.match(components, /\.apc-psw-track \{[\s\S]*?border-radius: var\(--r-control, 2px\);/,
    'the plate switch has a small radius; 999px was a pill');
  assert.match(components, /\.apc-psw-cap \{[\s\S]*?border-radius: 1px;/, 'the cam is square');
  assert.match(components, /\.apc-psw\[aria-checked="true"\] \.apc-psw-track \{ border-color: var\(--accent\); background: var\(--accent\); \}/,
    'on = the whole track fills with the signal colour');
});

test('graph / envelope nodes are ring-dots without a floating number', () => {
  assert.match(viz, /:where\(\.apc-viz-node\) \{[\s\S]*?border-radius: 50%;/, 'node is a circle');
  assert.match(viz, /:where\(\.apc-viz-node\)::after \{ display: none; \}/, 'no band number over the plot');
});

test('viz: the grid is the plate 10% cyan hairline, the spectrum is energy cyan', () => {
  assert.match(tokensCss, /--viz-grid:\s+rgba\(91, 199, 210, \.10\)/, 'night grid = plate hairline');
  assert.match(tokensCss, /--viz-grid:\s+rgba\(18, 41, 53, \.06\)/, 'day grid = ink hairline');
  assert.match(read('apc-core.css'), /--viz-grid:\s+rgba\(91, 199, 210, \.10\)/, 'core mirror carries it too');
  assert.match(vizJs, /ctx\.fillStyle = th\.ok;/, 'spectrum bars are energy cyan, not the limit red');
});
