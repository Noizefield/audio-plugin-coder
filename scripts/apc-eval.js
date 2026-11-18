'use strict';

/**
 * apc eval -- deterministic AI eval harness (roadmap idea #10 / D1).
 *
 *   apc eval list [--tag T] [--json]
 *   apc eval run <task> --prepare [--workspace DIR] [--json]
 *   apc eval run <task> --grade --workspace DIR [--json]      (alias: apc eval score)
 *   apc eval score <task> --workspace DIR [--json]
 *   apc eval record <task> (--workspace DIR | --result FILE) --agent A --model M
 *                   [--tokens-in N] [--tokens-out N] [--cost-usd X] [--wall-s S] [--ledger FILE] [--json]
 *   apc eval leaderboard [--ledger FILE] [--task ID] [--out FILE] [--json]
 *   apc eval promote <run_id|result.json> [--known-issues FILE] [--note TEXT] [--allow-failed] [--dry-run]
 *   apc eval selftest [task]       known-good must pass, known-bad and the bare fixture must fail
 *
 * The harness never calls an LLM. The agent run itself happens in whatever
 * host the user prefers: `--prepare` makes a throwaway workspace (an APC root
 * with the task fixture), the agent works there, `--grade` runs the task's
 * deterministic checks against it. `record` appends a row to the ledger; the
 * ledger feeds `leaderboard` and `promote`.
 *
 * Task layout: evals/tasks/<id>/task.json, fixture/ (copied to the workspace),
 * reference/good + reference/bad (overlay dirs used by `selftest`; never copied
 * into the agent workspace). Contract: run(args, ctx) -> exit code.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const APC_CLI = path.join(REPO_ROOT, 'bin', 'apc.js');
const TASK_SCHEMA = 'apc-eval-task/1';
const RESULT_SCHEMA = 'apc-eval-result/1';
const ROW_SCHEMA = 'apc-eval-row/1';
const META_DIR = '.apc-eval';
const MAX_READ = 5 * 1024 * 1024;

const CHECK_TYPES = new Set([
  'file_exists', 'file_absent', 'file_contains', 'file_not_contains', 'file_count',
  'json_path', 'unchanged_from_fixture', 'file_matches_repo', 'apc',
]);

// ------------------------------------------------------------------ helpers
function apcVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version; } catch { return 'unknown'; }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
}

/** Join rel onto base and refuse anything that escapes base. */
function safeJoin(base, rel) {
  if (typeof rel !== 'string' || rel === '') throw new Error('empty path');
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) throw new Error(`absolute path not allowed: ${rel}`);
  const full = path.resolve(base, rel);
  const relBack = path.relative(base, full);
  if (relBack.startsWith('..') || path.isAbsolute(relBack)) throw new Error(`path escapes its root: ${rel}`);
  return full;
}

function readCapped(p) {
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error('not a file');
  if (st.size > MAX_READ) throw new Error(`file larger than ${MAX_READ} bytes`);
  return fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function makeRegex(pattern, flags) {
  const f = String(flags || '').replace(/[^imsuy]/g, '');
  return new RegExp(pattern, f);
}

function median(nums) {
  const xs = nums.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function copyDir(src, dest, skip) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip && skip(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d, skip);
    else if (e.isFile()) { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
  }
}

function rmTree(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
}

// -------------------------------------------------------------------- tasks
function tasksDir(root) { return path.join(root, 'evals', 'tasks'); }

/** Load + validate one task. Throws Error with every problem listed. */
function loadTask(root, id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id || '')) throw new Error(`invalid task id "${id}"`);
  const dir = path.join(tasksDir(root), id);
  const file = path.join(dir, 'task.json');
  if (!fs.existsSync(file)) throw new Error(`task not found: ${id} (expected ${path.relative(root, file)})`);
  let t;
  try { t = readJson(file); } catch (e) { throw new Error(`${id}/task.json is not valid JSON: ${e.message}`); }
  const problems = [];
  if (t.schema !== TASK_SCHEMA) problems.push(`schema must be "${TASK_SCHEMA}"`);
  if (t.id !== id) problems.push(`id "${t.id}" does not match directory "${id}"`);
  if (!t.title) problems.push('title missing');
  if (!t.prompt) problems.push('prompt missing');
  if (!t.fixture || !fs.existsSync(path.join(dir, t.fixture))) problems.push(`fixture dir missing: ${t.fixture}`);
  if (!Array.isArray(t.checks) || t.checks.length === 0) problems.push('checks must be a non-empty array');
  else {
    const seen = new Set();
    t.checks.forEach((c, i) => {
      if (!c.id) problems.push(`checks[${i}] has no id`);
      else if (seen.has(c.id)) problems.push(`duplicate check id "${c.id}"`);
      else seen.add(c.id);
      if (!CHECK_TYPES.has(c.type)) problems.push(`checks[${i}] (${c.id}) unknown type "${c.type}"`);
    });
  }
  if (t.setup !== undefined && !Array.isArray(t.setup)) problems.push('setup must be an array');
  if (problems.length) throw new Error(`task ${id} invalid: ${problems.join('; ')}`);
  t.timeout_s = Number.isFinite(t.timeout_s) ? t.timeout_s : 600;
  t.tags = Array.isArray(t.tags) ? t.tags : [];
  t.setup = t.setup || [];
  t._dir = dir;
  return t;
}

function listTasks(root) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(tasksDir(root), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    try { out.push({ task: loadTask(root, e.name) }); } catch (err) { out.push({ id: e.name, error: err.message }); }
  }
  return out;
}

// ----------------------------------------------------------------- workspace
function runSetupOp(op, ws, repoRoot) {
  switch (op.op) {
    case 'mkdir': fs.mkdirSync(safeJoin(ws, op.path), { recursive: true }); break;
    case 'write': {
      const p = safeJoin(ws, op.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, op.content === undefined ? '' : String(op.content));
      break;
    }
    case 'delete': rmTree(safeJoin(ws, op.path)); break;
    case 'json-set': {
      const p = safeJoin(ws, op.path);
      const doc = readJson(p);
      const keys = Array.isArray(op.key) ? op.key : String(op.key).split('.');
      let cur = doc;
      keys.slice(0, -1).forEach((k) => { if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}; cur = cur[k]; });
      cur[keys[keys.length - 1]] = op.value;
      fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
      break;
    }
    case 'copy-from-repo': {
      const from = safeJoin(repoRoot, op.from);
      const to = safeJoin(ws, op.to);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      break;
    }
    default: throw new Error(`unknown setup op "${op.op}"`);
  }
}

/**
 * Create a workspace (an APC root) for `task`. Returns the absolute path.
 * An existing --workspace must be absent or empty.
 */
function prepare(task, workspace) {
  let ws = workspace ? path.resolve(workspace) : fs.mkdtempSync(path.join(os.tmpdir(), `apc-eval-${task.id}-`));
  if (fs.existsSync(ws)) {
    if (fs.readdirSync(ws).length > 0) throw new Error(`workspace is not empty: ${ws}`);
  } else fs.mkdirSync(ws, { recursive: true });
  copyDir(path.join(task._dir, task.fixture), ws);
  if (!fs.existsSync(path.join(ws, 'apc.config.json'))) {
    fs.writeFileSync(path.join(ws, 'apc.config.json'), JSON.stringify({ version: 1, paths: { plugins_dir: 'plugins', build_dir: 'build', release_dir: 'release' } }, null, 2) + '\n');
  }
  if (!fs.existsSync(path.join(ws, 'package.json'))) {
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'apc-eval-workspace', version: '0.0.0', private: true }, null, 2) + '\n');
  }
  for (const op of task.setup) runSetupOp(op, ws, REPO_ROOT);
  fs.mkdirSync(path.join(ws, META_DIR), { recursive: true });
  fs.writeFileSync(path.join(ws, META_DIR, 'meta.json'), JSON.stringify({ task: task.id, prepared_at: new Date().toISOString(), apc_version: apcVersion() }, null, 2) + '\n');
  fs.writeFileSync(path.join(ws, 'TASK.md'), taskMarkdown(task, ws));
  return ws;
}

function taskMarkdown(task, ws) {
  return [
    `# Eval task: ${task.title}`,
    '',
    `Task id: \`${task.id}\`  -  advisory time limit: ${task.timeout_s}s`,
    '',
    '## Prompt',
    '',
    task.prompt,
    '',
    '## Tooling',
    '',
    `This directory is an APC root. Run the APC CLI against it with:`,
    '',
    '```bash',
    `APC_ROOT="${ws}" node "${APC_CLI}" <command>`,
    '```',
    '',
    'Do not edit `.apc-eval/` or this file. When you are done, stop; grading is deterministic and done by the person running the eval.',
    '',
  ].join('\n');
}

/** Copy an overlay dir over the workspace; `_delete.txt` lists paths to remove. */
function applyOverlay(ws, overlayDir) {
  copyDir(overlayDir, ws, (name) => name === '_delete.txt');
  const del = path.join(overlayDir, '_delete.txt');
  if (fs.existsSync(del)) {
    for (const line of fs.readFileSync(del, 'utf8').split(/\r?\n/)) {
      const rel = line.trim();
      if (rel && !rel.startsWith('#')) rmTree(safeJoin(ws, rel));
    }
  }
}

// ------------------------------------------------------------------- grading
function getPointer(doc, pointer) {
  const keys = Array.isArray(pointer)
    ? pointer
    : String(pointer).replace(/\[(\d+)\]/g, '.$1').split('.').filter((k) => k !== '');
  let cur = doc;
  for (const k of keys) {
    if (cur === null || typeof cur !== 'object' || !(k in Object(cur))) return { found: false };
    cur = cur[k];
  }
  return { found: true, value: cur };
}

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function runCheck(check, ctx) {
  const { ws, task, repoRoot } = ctx;
  const fail = (message) => ({ passed: false, message });
  const pass = (message) => ({ passed: true, message: message || 'ok' });
  try {
    switch (check.type) {
      case 'file_exists': return fs.existsSync(safeJoin(ws, check.path)) ? pass() : fail(`missing: ${check.path}`);
      case 'file_absent': return fs.existsSync(safeJoin(ws, check.path)) ? fail(`should not exist: ${check.path}`) : pass();
      case 'file_contains':
      case 'file_not_contains':
      case 'file_count': {
        const p = safeJoin(ws, check.path);
        if (!fs.existsSync(p)) return fail(`missing: ${check.path}`);
        const text = readCapped(p);
        const re = makeRegex(check.pattern, check.flags);
        const gre = new RegExp(re.source, re.flags + 'g');
        const n = (text.match(gre) || []).length;
        if (check.type === 'file_contains') {
          const min = Number.isFinite(check.min) ? check.min : 1;
          return n >= min ? pass(`${n} match(es)`) : fail(`pattern /${check.pattern}/ matched ${n}x in ${check.path} (need >= ${min})`);
        }
        if (check.type === 'file_not_contains') return n === 0 ? pass() : fail(`forbidden pattern /${check.pattern}/ found ${n}x in ${check.path}`);
        const min = Number.isFinite(check.min) ? check.min : 0;
        const max = Number.isFinite(check.max) ? check.max : Infinity;
        return n >= min && n <= max ? pass(`${n} match(es)`) : fail(`pattern /${check.pattern}/ matched ${n}x in ${check.path} (need ${min}..${max === Infinity ? 'inf' : max})`);
      }
      case 'json_path': {
        const p = safeJoin(ws, check.path);
        if (!fs.existsSync(p)) return fail(`missing: ${check.path}`);
        let doc;
        try { doc = readJson(p); } catch (e) { return fail(`${check.path} is not valid JSON: ${e.message}`); }
        const r = getPointer(doc, check.pointer);
        const label = Array.isArray(check.pointer) ? check.pointer.join(' > ') : check.pointer;
        if ('exists' in check) return r.found === !!check.exists ? pass() : fail(`${label} ${check.exists ? 'missing' : 'present'} in ${check.path}`);
        if (!r.found) return fail(`${label} missing in ${check.path}`);
        if ('equals' in check) return deepEqual(r.value, check.equals) ? pass() : fail(`${label} is ${JSON.stringify(r.value)}, expected ${JSON.stringify(check.equals)}`);
        if ('matches' in check) return makeRegex(check.matches, check.flags).test(String(r.value)) ? pass() : fail(`${label} = ${JSON.stringify(r.value)} does not match /${check.matches}/`);
        if ('contains' in check) {
          const hay = Array.isArray(r.value) ? r.value : String(r.value);
          return hay.includes(check.contains) ? pass() : fail(`${label} does not contain ${JSON.stringify(check.contains)}`);
        }
        return pass('present');
      }
      case 'unchanged_from_fixture': {
        const wsFile = safeJoin(ws, check.path);
        const fxFile = safeJoin(path.join(task._dir, task.fixture), check.path);
        const a = fs.existsSync(wsFile) ? sha256(fs.readFileSync(wsFile)) : null;
        const b = fs.existsSync(fxFile) ? sha256(fs.readFileSync(fxFile)) : null;
        return a === b ? pass() : fail(`${check.path} was ${a === null ? 'deleted' : 'modified'} (must stay identical to the fixture)`);
      }
      case 'file_matches_repo': {
        const wsFile = safeJoin(ws, check.path);
        const repoFile = safeJoin(repoRoot, check.repo_path || check.path);
        if (!fs.existsSync(wsFile)) return fail(`missing: ${check.path}`);
        if (!fs.existsSync(repoFile)) return fail(`repo reference missing: ${check.repo_path || check.path}`);
        return sha256(fs.readFileSync(wsFile)) === sha256(fs.readFileSync(repoFile)) ? pass() : fail(`${check.path} differs from the repo's ${check.repo_path || check.path}`);
      }
      case 'apc': {
        const r = childProcess.spawnSync(process.execPath, [APC_CLI, ...(check.args || [])], {
          cwd: ws,
          env: Object.assign({}, process.env, { APC_ROOT: ws, NO_COLOR: '1' }),
          encoding: 'utf8',
          timeout: (check.timeout_s || 60) * 1000,
        });
        if (r.error) return fail(`could not run apc: ${r.error.message}`);
        const expect = Number.isInteger(check.expect_exit) ? check.expect_exit : 0;
        const out = (r.stdout || '') + (r.stderr || '');
        const shown = `apc ${(check.args || []).join(' ')}`;
        if (r.status !== expect) return fail(`${shown} exited ${r.status}, expected ${expect}: ${out.trim().split(/\r?\n/).filter(Boolean).slice(0, 3).join(' | ').slice(0, 300)}`);
        if (check.stdout_contains && !out.includes(check.stdout_contains)) return fail(`${shown}: output lacks "${check.stdout_contains}"`);
        if (check.stdout_not_contains && out.includes(check.stdout_not_contains)) return fail(`${shown}: output contains forbidden "${check.stdout_not_contains}"`);
        return pass(`exit ${r.status}`);
      }
      default: return fail(`unknown check type ${check.type}`);
    }
  } catch (e) {
    return fail(`check error: ${e.message}`);
  }
}

/** Run every check of `task` against workspace `ws`. Pure with respect to the ledger. */
function grade(task, ws) {
  const absWs = path.resolve(ws);
  if (!fs.existsSync(absWs)) throw new Error(`workspace not found: ${absWs}`);
  const ctx = { ws: absWs, task, repoRoot: REPO_ROOT };
  const checks = task.checks.map((c) => Object.assign({ id: c.id, type: c.type, description: c.description || '' }, runCheck(c, ctx)));
  const passedN = checks.filter((c) => c.passed).length;
  return {
    schema: RESULT_SCHEMA,
    task: task.id,
    workspace: absWs,
    passed: passedN === checks.length,
    score: checks.length ? passedN / checks.length : 0,
    checks_passed: passedN,
    checks_total: checks.length,
    checks,
    graded_at: new Date().toISOString(),
    apc_version: apcVersion(),
  };
}

// -------------------------------------------------------------------- ledger
function defaultLedger(root) { return path.join(root, 'evals', 'results', 'ledger.jsonl'); }

function numOrNull(v, name) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${v}"`);
  return n;
}

function makeRow(result, meta) {
  if (!meta.agent || !meta.model) throw new Error('--agent and --model are required to record a result');
  return {
    schema: ROW_SCHEMA,
    run_id: meta.run_id || crypto.randomBytes(4).toString('hex'),
    task: result.task,
    agent: String(meta.agent),
    model: String(meta.model),
    passed: !!result.passed,
    checks: {
      passed: result.checks_passed,
      total: result.checks_total,
      failed: result.checks.filter((c) => !c.passed).map((c) => c.id),
    },
    tokens_in: numOrNull(meta.tokens_in, 'tokens_in'),
    tokens_out: numOrNull(meta.tokens_out, 'tokens_out'),
    cost_usd: numOrNull(meta.cost_usd, 'cost_usd'),
    wall_s: numOrNull(meta.wall_s, 'wall_s'),
    date: meta.date || new Date().toISOString(),
    apc_version: result.apc_version || apcVersion(),
  };
}

function appendLedger(ledgerPath, row) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify(row) + '\n');
}

function readLedger(ledgerPath) {
  const rows = [];
  let malformed = 0;
  if (!fs.existsSync(ledgerPath)) return { rows, malformed };
  for (const line of fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === 'object' && r.task && r.agent && r.model && typeof r.passed === 'boolean') rows.push(r); else malformed += 1;
    } catch { malformed += 1; }
  }
  return { rows, malformed };
}

// --------------------------------------------------------------- leaderboard
function aggregate(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.agent}\u0000${r.model}`;
    if (!groups.has(key)) groups.set(key, { agent: r.agent, model: r.model, rows: [] });
    groups.get(key).rows.push(r);
  }
  const out = [];
  for (const g of groups.values()) {
    const passed = g.rows.filter((r) => r.passed).length;
    const tokens = g.rows
      .filter((r) => typeof r.tokens_in === 'number' || typeof r.tokens_out === 'number')
      .map((r) => (r.tokens_in || 0) + (r.tokens_out || 0));
    const perTask = {};
    for (const r of g.rows) {
      perTask[r.task] = perTask[r.task] || { runs: 0, passed: 0 };
      perTask[r.task].runs += 1;
      if (r.passed) perTask[r.task].passed += 1;
    }
    out.push({
      agent: g.agent, model: g.model, runs: g.rows.length, passed,
      pass_rate: g.rows.length ? passed / g.rows.length : 0,
      median_tokens: median(tokens),
      median_cost_usd: median(g.rows.map((r) => r.cost_usd)),
      median_wall_s: median(g.rows.map((r) => r.wall_s)),
      per_task: perTask,
    });
  }
  out.sort((a, b) => b.pass_rate - a.pass_rate
    || (a.median_cost_usd === null) - (b.median_cost_usd === null)
    || (a.median_cost_usd || 0) - (b.median_cost_usd || 0)
    || b.runs - a.runs
    || (a.agent + a.model).localeCompare(b.agent + b.model));
  return out;
}

function renderLeaderboard(rows, opts) {
  opts = opts || {};
  const agg = aggregate(rows);
  const tasks = Array.from(new Set(rows.map((r) => r.task))).sort();
  const fmtNum = (n) => (n === null ? '-' : String(Math.round(n)));
  const fmtCost = (n) => (n === null ? '-' : `$${n.toFixed(4)}`);
  const fmtSec = (n) => (n === null ? '-' : n.toFixed(1));
  const latest = rows.map((r) => r.date).filter(Boolean).sort().pop();
  const lines = [];
  lines.push('# APC Eval Leaderboard', '');
  lines.push(`${rows.length} run(s), ${tasks.length} task(s), ${agg.length} agent/model pair(s)${latest ? `; latest run ${latest.slice(0, 10)}` : ''}. Generated by \`apc eval leaderboard\` from the ledger; do not edit by hand.`, '');
  if (rows.length === 0) { lines.push('_No results recorded yet. See .agents/guides/evals.md._', ''); return lines.join('\n'); }
  lines.push('| Rank | Agent | Model | Runs | Pass rate | Median tokens | Median $ | Median wall (s) |');
  lines.push('|-----:|-------|-------|-----:|----------:|--------------:|---------:|----------------:|');
  agg.forEach((a, i) => {
    lines.push(`| ${i + 1} | ${a.agent} | ${a.model} | ${a.runs} | ${(a.pass_rate * 100).toFixed(1)}% (${a.passed}/${a.runs}) | ${fmtNum(a.median_tokens)} | ${fmtCost(a.median_cost_usd)} | ${fmtSec(a.median_wall_s)} |`);
  });
  lines.push('', '## Pass rate per task (passed/runs)', '');
  lines.push(`| Agent / Model | ${tasks.join(' | ')} |`);
  lines.push(`|---|${tasks.map(() => ':---:').join('|')}|`);
  for (const a of agg) {
    lines.push(`| ${a.agent} / ${a.model} | ${tasks.map((t) => (a.per_task[t] ? `${a.per_task[t].passed}/${a.per_task[t].runs}` : '-')).join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ------------------------------------------------------------------- promote
function yamlStr(s) { return JSON.stringify(String(s)); }

function buildProposal(row, task, note) {
  const id = `eval-${row.task}-${row.run_id}`;
  const category = (task && (task.category || task.tags.find((t) => !/^(static|cli|known-issue:)/.test(t)))) || 'eval';
  const firstSentence = task ? task.prompt.split(/\n/)[0].slice(0, 200) : `eval task ${row.task}`;
  const date = (row.date || new Date().toISOString()).slice(0, 10);
  const yaml = [
    `  - id: ${id}`,
    `    title: ${yamlStr(`Eval ${row.passed ? 'win' : 'failure'}: ${task ? task.title : row.task} (${row.agent}/${row.model})`)}`,
    `    category: ${category}`,
    `    severity: medium`,
    `    symptoms:`,
    `      - ${yamlStr(firstSentence)}`,
    `    error_patterns:`,
    `      - "TODO: add the log/error text an agent would search for"`,
    `    root_cause: "TODO: one sentence on the real cause"`,
    `    resolution_status: proposed`,
    `    resolution_file: "TODO: resolutions/<name>.md"`,
    `    frequency: 1`,
    `    last_occurred: ${date}`,
    `    source: ${yamlStr(`apc eval run ${row.run_id}; checks ${row.checks ? `${row.checks.passed}/${row.checks.total}` : 'n/a'}${row.checks && row.checks.failed && row.checks.failed.length ? `; failed: ${row.checks.failed.join(',')}` : ''}`)}`,
    `    prevention: ${yamlStr(note || 'TODO: what stops the next agent hitting this')}`,
  ];
  return [
    `# >>> APC-EVAL PROPOSAL run_id=${row.run_id} (generated by \`apc eval promote\`; this is a COMMENT, not an active entry)`,
    '# To accept: remove the leading "# " from the YAML lines below, replace the TODO fields and the id, then delete the two marker lines.',
    '# To reject: delete everything from the ">>>" line to the "<<<" line. No existing entry above was modified.',
    ...yaml.map((l) => `# ${l}`),
    `# <<< END APC-EVAL PROPOSAL run_id=${row.run_id}`,
    '',
  ].join('\n');
}

function promote(root, source, opts) {
  opts = opts || {};
  let row;
  if (fs.existsSync(source) && fs.statSync(source).isFile()) {
    const j = readJson(source);
    row = j.schema === RESULT_SCHEMA
      ? makeRow(j, { agent: opts.agent || 'unknown', model: opts.model || 'unknown', run_id: opts.run_id })
      : j;
  } else {
    const { rows } = readLedger(opts.ledger || defaultLedger(root));
    row = rows.find((r) => r.run_id === source);
    if (!row) throw new Error(`no ledger row with run_id "${source}" and no such file`);
  }
  if (!row || !row.task) throw new Error('result has no task');
  if (!row.run_id) row.run_id = crypto.randomBytes(4).toString('hex');
  if (!row.passed && !opts.allow_failed) throw new Error(`run ${row.run_id} did not pass; promote records wins (use --allow-failed to propose a failure pattern)`);
  let task = null;
  try { task = loadTask(root, row.task); } catch { /* proposal still works without the task */ }
  const target = opts.known_issues || path.join(root, '.agents', 'troubleshooting', 'known-issues.yaml');
  if (!fs.existsSync(target)) throw new Error(`known-issues file not found: ${target}`);
  const before = fs.readFileSync(target);
  if (before.toString('utf8').includes(`APC-EVAL PROPOSAL run_id=${row.run_id}`)) throw new Error(`run ${row.run_id} is already proposed in ${target}`);
  const block = buildProposal(row, task, opts.note);
  if (opts.dry_run) return { target, block, written: false };
  const prefix = (before.length && before[before.length - 1] !== 0x0a ? '\n' : '') + '\n';
  fs.appendFileSync(target, prefix + block);
  const after = fs.readFileSync(target);
  if (!after.subarray(0, before.length).equals(before)) throw new Error('internal error: existing known-issues content changed');
  return { target, block, written: true };
}

// ---------------------------------------------------------------------- CLI
function parseArgs(argv, valueFlags) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (valueFlags.includes(name)) {
        if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`--${name} needs a value`);
        flags[name] = argv[++i];
      } else flags[name] = true;
    } else pos.push(a);
  }
  return { flags, pos };
}

const VALUE_FLAGS = ['workspace', 'agent', 'model', 'tokens-in', 'tokens-out', 'cost-usd', 'wall-s', 'ledger', 'result', 'task', 'out', 'known-issues', 'note', 'tag', 'date'];

function usage() {
  return [
    'Usage: apc eval <list|run|score|record|leaderboard|promote|selftest> ...',
    '  list [--tag T] [--json]',
    '  run <task> --prepare [--workspace DIR] [--json]     create a workspace for your agent',
    '  run <task> --grade --workspace DIR [--json]         grade it (same as: score)',
    '  score <task> --workspace DIR [--json]',
    '  record <task> (--workspace DIR | --result FILE) --agent A --model M [--tokens-in N --tokens-out N --cost-usd X --wall-s S] [--ledger FILE]',
    '  leaderboard [--ledger FILE] [--task ID] [--out FILE] [--json]',
    '  promote <run_id|result.json> [--known-issues FILE] [--note TEXT] [--allow-failed] [--dry-run] [--ledger FILE]',
    '  selftest [task]',
  ].join('\n');
}

function printResult(result, asJson) {
  if (asJson) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`apc eval score -- ${result.task}: ${result.passed ? 'PASS' : 'FAIL'} (${result.checks_passed}/${result.checks_total} checks)`);
  for (const c of result.checks) console.log(`  ${c.passed ? 'ok  ' : 'FAIL'} ${c.id}${c.passed ? '' : ` -- ${c.message}`}`);
}

function selftest(root, onlyId) {
  const rows = [];
  const tasks = listTasks(root).filter((t) => !onlyId || (t.task ? t.task.id : t.id) === onlyId);
  for (const t of tasks) {
    if (!t.task) { rows.push({ task: t.id, variant: 'load', ok: false, detail: t.error }); continue; }
    const task = t.task;
    const variants = [
      { name: 'fixture (no work)', overlay: null, expectPass: false },
      { name: 'reference/good', overlay: path.join(task._dir, 'reference', 'good'), expectPass: true },
      { name: 'reference/bad', overlay: path.join(task._dir, 'reference', 'bad'), expectPass: false },
    ];
    for (const v of variants) {
      if (v.overlay && !fs.existsSync(v.overlay)) { rows.push({ task: task.id, variant: v.name, ok: false, detail: 'missing reference dir' }); continue; }
      const ws = prepare(task);
      try {
        if (v.overlay) applyOverlay(ws, v.overlay);
        const res = grade(task, ws);
        const ok = res.passed === v.expectPass;
        rows.push({ task: task.id, variant: v.name, ok, detail: `${res.checks_passed}/${res.checks_total} checks passed${ok ? '' : `; failing: ${res.checks.filter((c) => !c.passed).map((c) => c.id).join(',') || 'none'}`}` });
      } finally { rmTree(ws); }
    }
  }
  return rows;
}

function run(args, ctx) {
  const root = (ctx && ctx.root) ? ctx.root : REPO_ROOT;
  const sub = args[0];
  if (!sub || sub === 'help' || sub === '--help') { console.log(usage()); return sub ? 0 : 2; }
  let parsed;
  try { parsed = parseArgs(args.slice(1), VALUE_FLAGS); } catch (e) { console.error(e.message); return 2; }
  const { flags, pos } = parsed;
  const asJson = !!flags.json;
  try {
    switch (sub) {
      case 'list': {
        const all = listTasks(root).filter((t) => !flags.tag || (t.task && t.task.tags.includes(flags.tag)));
        if (asJson) {
          console.log(JSON.stringify(all.map((t) => (t.task ? { id: t.task.id, title: t.task.title, tags: t.task.tags, checks: t.task.checks.length, timeout_s: t.task.timeout_s } : { id: t.id, error: t.error })), null, 2));
        } else {
          console.log(`apc eval -- ${all.length} task(s) in evals/tasks/`);
          for (const t of all) console.log(t.task ? `  ${t.task.id.padEnd(28)} ${String(t.task.checks.length).padStart(2)} checks  [${t.task.tags.join(', ')}]  ${t.task.title}` : `  ${t.id.padEnd(28)} INVALID: ${t.error}`);
        }
        return all.some((t) => t.error) ? 1 : 0;
      }
      case 'run':
      case 'score': {
        const id = pos[0];
        if (!id) { console.error(usage()); return 2; }
        const task = loadTask(root, id);
        const hasMeta = flags.workspace && fs.existsSync(path.join(path.resolve(flags.workspace), META_DIR, 'meta.json'));
        const doGrade = sub === 'score' || flags.grade || (!flags.prepare && hasMeta);
        if (!doGrade) {
          const ws = prepare(task, flags.workspace);
          if (asJson) console.log(JSON.stringify({ task: task.id, workspace: ws, prompt: task.prompt, timeout_s: task.timeout_s, apc_cli: APC_CLI }, null, 2));
          else {
            console.log(`Prepared workspace: ${ws}`);
            console.log(`Task: ${task.id} - ${task.title}   (advisory limit ${task.timeout_s}s)`);
            console.log(`The prompt is in ${path.join(ws, 'TASK.md')}. Point your agent at that directory (cwd + APC_ROOT), then grade with:`);
            console.log(`  apc eval run ${task.id} --grade --workspace "${ws}"`);
          }
          return 0;
        }
        if (!flags.workspace) { console.error('--workspace DIR is required to grade'); return 2; }
        const result = grade(task, flags.workspace);
        printResult(result, asJson);
        return result.passed ? 0 : 1;
      }
      case 'record': {
        const id = pos[0];
        if (!id) { console.error(usage()); return 2; }
        const task = loadTask(root, id);
        let result;
        if (flags.result) {
          result = readJson(flags.result);
          if (result.schema !== RESULT_SCHEMA || result.task !== id) throw new Error(`--result must be \`apc eval score ${id} --json\` output`);
        } else if (flags.workspace) result = grade(task, flags.workspace);
        else { console.error('record needs --workspace DIR or --result FILE'); return 2; }
        const row = makeRow(result, {
          agent: flags.agent, model: flags.model, date: flags.date,
          tokens_in: flags['tokens-in'], tokens_out: flags['tokens-out'], cost_usd: flags['cost-usd'], wall_s: flags['wall-s'],
        });
        const ledger = flags.ledger ? path.resolve(flags.ledger) : defaultLedger(root);
        appendLedger(ledger, row);
        if (asJson) console.log(JSON.stringify({ ledger, row }, null, 2));
        else console.log(`recorded ${row.run_id}: ${row.task} ${row.passed ? 'PASS' : 'FAIL'} (${row.checks.passed}/${row.checks.total}) ${row.agent}/${row.model} -> ${path.relative(root, ledger) || ledger}`);
        return 0;
      }
      case 'leaderboard': {
        const ledger = flags.ledger ? path.resolve(flags.ledger) : defaultLedger(root);
        const { rows, malformed } = readLedger(ledger);
        const filtered = flags.task ? rows.filter((r) => r.task === flags.task) : rows;
        if (malformed) console.error(`warning: ${malformed} malformed ledger line(s) ignored`);
        if (asJson) { console.log(JSON.stringify({ runs: filtered.length, leaderboard: aggregate(filtered) }, null, 2)); return 0; }
        const md = renderLeaderboard(filtered);
        if (flags.out) {
          const out = path.resolve(root, flags.out === true ? 'evals/LEADERBOARD.md' : flags.out);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, md);
          console.log(`wrote ${path.relative(root, out) || out} (${filtered.length} run(s))`);
        } else console.log(md);
        return 0;
      }
      case 'promote': {
        if (!pos[0]) { console.error(usage()); return 2; }
        const res = promote(root, pos[0], {
          ledger: flags.ledger ? path.resolve(flags.ledger) : undefined,
          known_issues: flags['known-issues'] ? path.resolve(flags['known-issues']) : undefined,
          note: flags.note, allow_failed: !!flags['allow-failed'], dry_run: !!flags['dry-run'],
        });
        if (res.written) console.log(`proposal appended to ${res.target} (as a commented block; review and uncomment to accept)`);
        else console.log(res.block);
        return 0;
      }
      case 'selftest': {
        const rows = selftest(root, pos[0]);
        if (asJson) console.log(JSON.stringify(rows, null, 2));
        else for (const r of rows) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.task.padEnd(28)} ${r.variant.padEnd(18)} ${r.detail}`);
        const bad = rows.filter((r) => !r.ok).length;
        if (!asJson) console.log(bad === 0 ? `selftest OK (${rows.length} variants)` : `selftest FAILED: ${bad} of ${rows.length}`);
        return bad === 0 && rows.length > 0 ? 0 : 1;
      }
      default:
        console.error(`Unknown eval subcommand: ${sub}\n${usage()}`);
        return 2;
    }
  } catch (e) {
    console.error(`apc eval ${sub}: ${e.message}`);
    return 1;
  }
}

module.exports = {
  run, listTasks, loadTask, prepare, applyOverlay, grade, makeRow, appendLedger, readLedger,
  aggregate, renderLeaderboard, promote, buildProposal, selftest, median, safeJoin, getPointer,
};
