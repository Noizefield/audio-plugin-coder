'use strict';

/**
 * apc-standards — the machine-readable Plugin Product Standards registry.
 *
 * The standards were locked on 2026-10-24 and live in `schemas/apc-standards.json`
 * (registry) + `schemas/apc-settings.schema.json` + `schemas/apc-preset.schema.json`.
 * This module is the single place that knows how to:
 *
 *   - read the registry,
 *   - validate a standards block (global in apc.config.json, per plugin in status.json),
 *   - resolve the effective value for a plugin (plugin override > global > registry default),
 *   - produce the guided question list that /apc-plan asks once.
 *
 * Zero dependencies, Node 18+ — mirrors scripts/ui-lint.js / scripts/ui-compose.js.
 *
 * Decision IDs (P-xx, U-xx, L-xx, X-xx) refer to the locked decision register.
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_REL = path.join('schemas', 'apc-standards.json');

/** Read the registry. Throws with a clear message when it is missing/corrupt. */
function loadRegistry(root) {
  const file = path.join(root, REGISTRY_REL);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    throw new Error(`standards registry not found: ${file}`);
  }
  let registry;
  try {
    registry = JSON.parse(raw);
  } catch (e) {
    throw new Error(`standards registry is not valid JSON: ${file} (${e.message})`);
  }
  if (!Array.isArray(registry.options)) {
    throw new Error(`standards registry has no "options" array: ${file}`);
  }
  return registry;
}

/** Look up one option by id. */
function optionById(registry, id) {
  return registry.options.find((o) => o.id === id) || null;
}

/** Groups in registry order, each with its options. */
function groupedOptions(registry, filter) {
  const groups = registry.groups && registry.groups.length
    ? registry.groups
    : [{ id: 'general', title: 'General' }];
  return groups.map((g) => ({
    ...g,
    options: registry.options.filter((o) => o.group === g.id && (!filter || filter(o))),
  })).filter((g) => g.options.length > 0);
}

const TRUTHY = new Set(['true', 'yes', 'on', '1', 'enabled']);
const FALSY = new Set(['false', 'no', 'off', '0', 'disabled']);

/**
 * Coerce a raw value (string from the CLI, or a parsed JSON value) to the
 * option's type. Returns {ok, value} or {ok:false, error}.
 */
function coerceValue(option, raw) {
  if (raw === null || raw === undefined) {
    if (option.default === null) return { ok: true, value: null };
    return { ok: false, error: 'a value is required' };
  }
  switch (option.type) {
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      const s = String(raw).trim().toLowerCase();
      if (TRUTHY.has(s)) return { ok: true, value: true };
      if (FALSY.has(s)) return { ok: true, value: false };
      return { ok: false, error: `expected a boolean (true/false), got "${raw}"` };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return { ok: false, error: `expected a number, got "${raw}"` };
      if (option.minimum !== undefined && n < option.minimum) {
        return { ok: false, error: `must be >= ${option.minimum}` };
      }
      if (option.maximum !== undefined && n > option.maximum) {
        return { ok: false, error: `must be <= ${option.maximum}` };
      }
      return { ok: true, value: n };
    }
    case 'enum': {
      const s = String(raw).trim();
      const values = option.values || [];
      if (values.includes(s)) return { ok: true, value: s };
      const lower = s.toLowerCase();
      const match = values.find((v) => String(v).toLowerCase() === lower);
      if (match !== undefined) return { ok: true, value: match };
      return { ok: false, error: `expected one of: ${values.join(', ')}` };
    }
    case 'string':
    default: {
      const s = typeof raw === 'string' ? raw : String(raw);
      if (s.trim() === '' && option.default === null) return { ok: true, value: null };
      return { ok: true, value: s };
    }
  }
}

/**
 * Validate a standards block against the registry.
 *
 * opts.scope           - 'global' | 'plugin': which scope the block must hold.
 * opts.requireRequired - report plugin options marked `required` that are absent.
 * opts.warnOpen        - report options whose decision is still OPEN (L-06/L-07).
 */
function validateBlock(registry, block, opts = {}) {
  const issues = [];
  const warnings = [];
  const unknown = [];
  const entries = (block && typeof block === 'object') ? block : {};
  const scope = opts.scope || null;

  for (const [id, raw] of Object.entries(entries)) {
    const option = optionById(registry, id);
    if (!option) {
      unknown.push(id);
      issues.push({ id, message: `unknown standard option "${id}"` });
      continue;
    }
    if (scope && option.scope !== scope) {
      issues.push({
        id,
        message: `"${id}" is a ${option.scope}-scope option and does not belong in a ${scope} block`,
      });
      continue;
    }
    const res = coerceValue(option, raw);
    if (!res.ok) {
      issues.push({ id, message: `"${id}": ${res.error}` });
      continue;
    }
    if (opts.warnOpen && option.status === 'open') {
      warnings.push({
        id,
        message: `"${id}" follows decision ${option.decision}, which is still OPEN — the value is a placeholder`,
      });
    }
  }

  if (opts.requireRequired) {
    for (const option of registry.options) {
      if (option.scope !== 'plugin' || !option.required) continue;
      if (!(option.id in entries)) {
        issues.push({
          id: option.id,
          message: `"${option.id}" (${option.decision}) is required at plan time and has no value`,
        });
      }
    }
  }

  return { issues, warnings, unknown };
}

/**
 * Resolve the effective value of every option for one plugin.
 * Plugin answers beat global defaults, which beat the registry default.
 */
function resolveEffective(registry, globalBlock, pluginBlock) {
  const global = globalBlock || {};
  const plugin = pluginBlock || {};
  const out = {};
  for (const option of registry.options) {
    let value = option.default;
    let source = 'default';
    if (Object.prototype.hasOwnProperty.call(global, option.id)) {
      const res = coerceValue(option, global[option.id]);
      if (res.ok) { value = res.value; source = 'global'; }
    }
    if (Object.prototype.hasOwnProperty.call(plugin, option.id)) {
      const res = coerceValue(option, plugin[option.id]);
      if (res.ok) { value = res.value; source = 'plugin'; }
    }
    out[option.id] = { value, source, option };
  }
  return out;
}

/**
 * The guided configuration list /apc-plan asks once and never re-asks.
 * Only plugin-scope options are asked; global options come from Advanced Setup.
 */
function planQuestions(registry, pluginBlock) {
  const answered = (pluginBlock && typeof pluginBlock === 'object') ? pluginBlock : {};
  return registry.options
    .filter((o) => o.scope === 'plugin')
    .filter((o) => !Object.prototype.hasOwnProperty.call(answered, o.id))
    .map((o) => ({
      id: o.id,
      question: o.question || o.id,
      type: o.type,
      values: o.values || null,
      default: o.default,
      required: !!o.required,
      decision: o.decision,
      group: o.group,
      summary: o.summary || '',
      status: o.status || 'locked',
    }));
}

/** Human-readable one-liner for a value. */
function formatValue(option, value) {
  if (value === null || value === undefined) return '(unset)';
  if (option.type === 'boolean') return value ? 'on' : 'off';
  return String(value);
}

/** Display label for an option, e.g. "ux.theme (U-07, global)". */
function optionLabel(option) {
  return `${option.id} (${option.decision}, ${option.scope})`;
}

module.exports = {
  REGISTRY_REL,
  loadRegistry,
  optionById,
  groupedOptions,
  coerceValue,
  validateBlock,
  resolveEffective,
  planQuestions,
  formatValue,
  optionLabel,
};

