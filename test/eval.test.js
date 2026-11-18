'use strict';
// Tests for scripts/apc-eval.js (apc eval ...). Zero deps: node:test + node:assert.
// Run: node --test test/eval.test.js   (also part of `npm test`)
// Nothing here touches the real evals/results ledger or the real known-issues.yaml:
// ledgers are temp files and promote runs on a COPY.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'apc.js');
const ev = require(path.join(REPO_ROOT, 'scripts', 'apc-eval.js'));

const tmpDirs = [];
function tmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `apc-evaltest-${prefix}-`));
  tmpDirs.push(d);
  return d;
}
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

function apc(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

function graded(taskId, variant) {
  const task = ev.loadTask(REPO_ROOT, taskId);
  const ws = ev.prepare(task, path.join(tmp(taskId), 'ws'));
  if (variant) ev.applyOverlay(ws, path.join(task._dir, 'reference', variant));
  return { task, ws, result: ev.grade(task, ws) };
}

const failedIds = (res) => res.checks.filter((c) => !c.passed).map((c) => c.id);

// ---------------------------------------------------------------- tasks
test('four golden tasks load and validate', () => {
  const all = ev.listTasks(REPO_ROOT);
  const ids = all.map((t) => (t.task ? t.task.id : t.id)).sort();
  assert.deepEqual(ids, ['add-parameter', 'fix-webview-member-order', 'port-visage-to-webview', 'respect-standards-flow']);
  for (const t of all) assert.ok(t.task, `${t.id}: ${t.error}`);
  for (const { task } of all) {
    assert.ok(task.prompt.length > 50, `${task.id} prompt`);
    assert.ok(task.checks.length >= 6, `${task.id} has real checks`);
  }
});

for (const id of ['add-parameter', 'fix-webview-member-order', 'port-visage-to-webview', 'respect-standards-flow']) {
  test(`${id}: known-good passes, known-bad fails, untouched fixture fails`, () => {
    const good = graded(id, 'good');
    assert.equal(good.result.passed, true, `good should pass; failing: ${failedIds(good.result)}`);
    assert.equal(good.result.score, 1);
    const bad = graded(id, 'bad');
    assert.equal(bad.result.passed, false, 'bad must fail');
    assert.ok(bad.result.checks_passed < bad.result.checks_total);
    const bare = graded(id, null);
    assert.equal(bare.result.passed, false, 'a task the bare fixture already passes is vacuous');
  });
}

test('bad variants fail for the intended reason', () => {
  assert.ok(failedIds(graded('add-parameter', 'bad').result).includes('drive-range'));
  assert.ok(failedIds(graded('add-parameter', 'bad').result).includes('drive-read'));
  assert.ok(failedIds(graded('add-parameter', 'bad').result).includes('spec-documented'));
  assert.deepEqual(failedIds(graded('fix-webview-member-order', 'bad').result), ['order-validator']);
  const v = failedIds(graded('port-visage-to-webview', 'bad').result);
  for (const id of ['webview-validator', 'framework-flag', 'visagecontrols-removed', 'no-visage-link']) assert.ok(v.includes(id), id);
  const s = failedIds(graded('respect-standards-flow', 'bad').result);
  assert.ok(s.includes('standards-validate'));
  assert.ok(s.includes('license-free'));
});

test('the unfixed member-order fixture is rejected by the real validator', () => {
  const { result } = graded('fix-webview-member-order', null);
  assert.deepEqual(failedIds(result).sort(), ['order-regex', 'order-validator']);
});

test('standards registry tampering is caught', () => {
  const { task, ws } = graded('respect-standards-flow', 'good');
  fs.appendFileSync(path.join(ws, 'schemas', 'apc-standards.json'), ' ');
  const res = ev.grade(task, ws);
  assert.equal(res.passed, false);
  assert.ok(failedIds(res).includes('registry-locked'));
});

test('editing a protected file fails unchanged_from_fixture', () => {
  const { task, ws } = graded('fix-webview-member-order', 'good');
  fs.appendFileSync(path.join(ws, 'plugins', 'TinyWeb', 'Source', 'PluginEditor.cpp'), '// touched\n');
  assert.ok(failedIds(ev.grade(task, ws)).includes('cpp-untouched'));
});

test('deleting members to satisfy the validator is caught by the count guards', () => {
  const { task, ws } = graded('fix-webview-member-order', 'good');
  const h = path.join(ws, 'plugins', 'TinyWeb', 'Source', 'PluginEditor.h');
  fs.writeFileSync(h, fs.readFileSync(h, 'utf8').replace(/.*mixAttachment;\n/, '').replace(/.*mixRelay \{ "mix" \};\n/, ''));
  const failed = failedIds(ev.grade(task, ws));
  assert.ok(failed.includes('relays-kept'));
  assert.ok(failed.includes('attachments-kept'));
});

test('safeJoin refuses paths that escape the workspace', () => {
  const base = tmp('join');
  assert.throws(() => ev.safeJoin(base, '../x'), /escapes/);
  assert.throws(() => ev.safeJoin(base, path.resolve('/etc/passwd')), /absolute/);
  assert.throws(() => ev.safeJoin(base, 'a/../../x'), /escapes/);
  assert.equal(ev.safeJoin(base, 'a/b.txt'), path.join(base, 'a', 'b.txt'));
});

test('loadTask reports every schema problem', () => {
  const root = tmp('badtask');
  const dir = path.join(root, 'evals', 'tasks', 'broken');
  fs.mkdirSync(path.join(dir, 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ schema: 'wrong', id: 'other', checks: [{ id: 'a', type: 'nope' }, { id: 'a', type: 'file_exists' }] }));
  assert.throws(() => ev.loadTask(root, 'broken'), (e) => /schema must be/.test(e.message) && /does not match directory/.test(e.message) && /title missing/.test(e.message) && /unknown type/.test(e.message) && /duplicate check id/.test(e.message));
  assert.throws(() => ev.loadTask(root, 'missing-task'), /not found/);
});

// ------------------------------------------------------------------ CLI
test('cli: list, prepare, score round trip with exit codes', () => {
  const l = apc(['eval', 'list', '--json']);
  assert.equal(l.status, 0);
  assert.equal(JSON.parse(l.stdout).length, 4);

  const ws = path.join(tmp('cli'), 'ws');
  const p = apc(['eval', 'run', 'add-parameter', '--prepare', '--workspace', ws, '--json']);
  assert.equal(p.status, 0, p.stderr);
  const prep = JSON.parse(p.stdout);
  assert.equal(path.resolve(prep.workspace), path.resolve(ws));
  assert.ok(fs.existsSync(path.join(ws, 'TASK.md')));
  assert.ok(fs.existsSync(path.join(ws, 'plugins', 'TinyGain', 'Source', 'PluginProcessor.cpp')));
  // reference solutions must never leak into the agent workspace
  assert.ok(!fs.existsSync(path.join(ws, 'reference')));
  assert.match(fs.readFileSync(path.join(ws, 'TASK.md'), 'utf8'), /drive/);

  assert.notEqual(apc(['eval', 'run', 'add-parameter', '--prepare', '--workspace', ws]).status, 0, 'non-empty workspace refused');

  const bare = apc(['eval', 'score', 'add-parameter', '--workspace', ws, '--json']);
  assert.equal(bare.status, 1);
  assert.equal(JSON.parse(bare.stdout).passed, false);

  ev.applyOverlay(ws, path.join(REPO_ROOT, 'evals', 'tasks', 'add-parameter', 'reference', 'good'));
  const graded2 = apc(['eval', 'run', 'add-parameter', '--workspace', ws, '--json']); // prepared dir => grade
  assert.equal(graded2.status, 0, graded2.stdout);
  assert.equal(JSON.parse(graded2.stdout).passed, true);

  assert.equal(apc(['eval', 'score', 'no-such-task', '--workspace', ws]).status, 1);
  assert.equal(apc(['eval', 'bogus']).status, 2);
  assert.equal(apc(['eval', 'score']).status, 2);
});

test('cli: selftest passes on the shipped tasks', () => {
  const r = apc(['eval', 'selftest']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /selftest OK \(12 variants\)/);
});

// --------------------------------------------------------------- ledger
test('record appends rows and preserves earlier ones', () => {
  const ledger = path.join(tmp('ledger'), 'results', 'ledger.jsonl');
  const { ws } = graded('add-parameter', 'good');
  const r1 = apc(['eval', 'record', 'add-parameter', '--workspace', ws, '--agent', 'claude-code', '--model', 'opus', '--tokens-in', '1200', '--tokens-out', '300', '--cost-usd', '0.42', '--wall-s', '95', '--ledger', ledger, '--json']);
  assert.equal(r1.status, 0, r1.stderr);
  const bad = graded('add-parameter', 'bad');
  const r2 = apc(['eval', 'record', 'add-parameter', '--workspace', bad.ws, '--agent', 'codex', '--model', 'gpt-x', '--ledger', ledger]);
  assert.equal(r2.status, 0, r2.stderr);

  const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const row1 = JSON.parse(lines[0]);
  assert.equal(row1.schema, 'apc-eval-row/1');
  assert.equal(row1.task, 'add-parameter');
  assert.equal(row1.agent, 'claude-code');
  assert.equal(row1.model, 'opus');
  assert.equal(row1.passed, true);
  assert.deepEqual(row1.checks, { passed: 7, total: 7, failed: [] });
  assert.equal(row1.tokens_in, 1200);
  assert.equal(row1.tokens_out, 300);
  assert.equal(row1.cost_usd, 0.42);
  assert.equal(row1.wall_s, 95);
  assert.match(row1.run_id, /^[0-9a-f]{8}$/);
  assert.ok(!Number.isNaN(Date.parse(row1.date)));
  assert.equal(row1.apc_version, JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version);
  const row2 = JSON.parse(lines[1]);
  assert.equal(row2.passed, false);
  assert.equal(row2.tokens_in, null);
  assert.ok(row2.checks.failed.includes('drive-range'));
  assert.equal(lines[0], JSON.stringify(row1), 'first row byte-stable after second append');
});

test('record validates agent/model and numbers, and accepts --result files', () => {
  const ledger = path.join(tmp('ledger2'), 'l.jsonl');
  const { ws } = graded('add-parameter', 'good');
  assert.equal(apc(['eval', 'record', 'add-parameter', '--workspace', ws, '--model', 'm', '--ledger', ledger]).status, 1);
  assert.equal(apc(['eval', 'record', 'add-parameter', '--workspace', ws, '--agent', 'a', '--model', 'm', '--cost-usd', '-3', '--ledger', ledger]).status, 1);
  assert.equal(apc(['eval', 'record', 'add-parameter', '--workspace', ws, '--agent', 'a', '--model', 'm', '--tokens-in', 'abc', '--ledger', ledger]).status, 1);
  assert.ok(!fs.existsSync(ledger), 'rejected records write nothing');

  const result = apc(['eval', 'score', 'add-parameter', '--workspace', ws, '--json']);
  const resFile = path.join(tmp('res'), 'result.json');
  fs.writeFileSync(resFile, result.stdout);
  assert.equal(apc(['eval', 'record', 'add-parameter', '--result', resFile, '--agent', 'a', '--model', 'm', '--ledger', ledger]).status, 0);
  assert.equal(fs.readFileSync(ledger, 'utf8').trim().split('\n').length, 1);
  // a result for another task is refused
  assert.equal(apc(['eval', 'record', 'fix-webview-member-order', '--result', resFile, '--agent', 'a', '--model', 'm', '--ledger', ledger]).status, 1);
});

// ---------------------------------------------------------- leaderboard
function row(over) {
  return Object.assign({ schema: 'apc-eval-row/1', run_id: crypto.randomBytes(4).toString('hex'), task: 't1', agent: 'A', model: 'm', passed: true, checks: { passed: 1, total: 1, failed: [] }, tokens_in: null, tokens_out: null, cost_usd: null, wall_s: null, date: '2026-10-01T00:00:00Z', apc_version: '1.8.0' }, over);
}

test('median handles odd, even, empty and nulls', () => {
  assert.equal(ev.median([3, 1, 2]), 2);
  assert.equal(ev.median([4, 1, 3, 2]), 2.5);
  assert.equal(ev.median([null, 5, undefined]), 5);
  assert.equal(ev.median([]), null);
  assert.equal(ev.median([null]), null);
});

test('leaderboard maths: pass-rate, median tokens, median cost, ordering', () => {
  const rows = [
    // A/m: 4 runs, 3 pass. tokens: 150, 200, 400, (none)  -> median 200. cost 0.1,0.2,0.3 (+null) -> 0.2. wall 10,20,30,40 -> 25
    row({ agent: 'A', model: 'm', task: 't1', passed: true, tokens_in: 100, tokens_out: 50, cost_usd: 0.1, wall_s: 10 }),
    row({ agent: 'A', model: 'm', task: 't1', passed: true, tokens_in: 200, tokens_out: 0, cost_usd: 0.3, wall_s: 20 }),
    row({ agent: 'A', model: 'm', task: 't2', passed: false, tokens_in: 300, tokens_out: 100, cost_usd: 0.2, wall_s: 30 }),
    row({ agent: 'A', model: 'm', task: 't2', passed: true, wall_s: 40 }),
    // B/n: 2 runs, 2 pass, cheaper -> ranks above A (100% vs 75%)
    row({ agent: 'B', model: 'n', task: 't1', passed: true, tokens_in: 10, tokens_out: 10, cost_usd: 0.01, wall_s: 5 }),
    row({ agent: 'B', model: 'n', task: 't2', passed: true, tokens_in: 30, tokens_out: 10, cost_usd: 0.03, wall_s: 7 }),
    // C/o: 1 run, 100%, more expensive than B -> ranks after B, before A
    row({ agent: 'C', model: 'o', task: 't1', passed: true, tokens_in: 1000, tokens_out: 0, cost_usd: 1.5, wall_s: 1 }),
  ];
  const agg = ev.aggregate(rows);
  assert.deepEqual(agg.map((a) => `${a.agent}/${a.model}`), ['B/n', 'C/o', 'A/m']);
  const a = agg.find((x) => x.agent === 'A');
  assert.equal(a.runs, 4);
  assert.equal(a.passed, 3);
  assert.equal(a.pass_rate, 0.75);
  assert.equal(a.median_tokens, 200);
  assert.ok(Math.abs(a.median_cost_usd - 0.2) < 1e-12);
  assert.equal(a.median_wall_s, 25);
  assert.deepEqual(a.per_task, { t1: { runs: 2, passed: 2 }, t2: { runs: 2, passed: 1 } });
  const b = agg.find((x) => x.agent === 'B');
  assert.equal(b.median_tokens, 30);
  assert.ok(Math.abs(b.median_cost_usd - 0.02) < 1e-12);

  const md = ev.renderLeaderboard(rows);
  assert.match(md, /^# APC Eval Leaderboard/);
  assert.match(md, /\| 1 \| B \| n \| 2 \| 100\.0% \(2\/2\) \| 30 \| \$0\.0200 \| 6\.0 \|/);
  assert.match(md, /\| 3 \| A \| m \| 4 \| 75\.0% \(3\/4\) \| 200 \| \$0\.2000 \| 25\.0 \|/);
  assert.match(md, /\| A \/ m \| 2\/2 \| 1\/2 \|/);
  assert.match(md, /7 run\(s\), 2 task\(s\), 3 agent\/model pair\(s\)/);
});

test('leaderboard shows "-" when no tokens/cost were recorded and handles an empty ledger', () => {
  const md = ev.renderLeaderboard([row({})]);
  assert.match(md, /\| 1 \| A \| m \| 1 \| 100\.0% \(1\/1\) \| - \| - \| - \|/);
  assert.match(ev.renderLeaderboard([]), /No results recorded yet/);
});

test('cli leaderboard: --out writes the file, --json is machine readable, malformed lines are skipped', () => {
  const dir = tmp('lb');
  const ledger = path.join(dir, 'l.jsonl');
  fs.writeFileSync(ledger, [JSON.stringify(row({ agent: 'X', model: 'y', tokens_in: 5, tokens_out: 5 })), 'not json', '', JSON.stringify({ task: 'x' })].join('\n') + '\n');
  const out = path.join(dir, 'LB.md');
  const r = apc(['eval', 'leaderboard', '--ledger', ledger, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /2 malformed/);
  assert.match(fs.readFileSync(out, 'utf8'), /\| 1 \| X \| y \| 1 \| 100\.0% \(1\/1\) \| 10 \|/);
  const j = JSON.parse(apc(['eval', 'leaderboard', '--ledger', ledger, '--json']).stdout);
  assert.equal(j.runs, 1);
  assert.equal(j.leaderboard[0].median_tokens, 10);
  const filtered = JSON.parse(apc(['eval', 'leaderboard', '--ledger', ledger, '--task', 'nothing', '--json']).stdout);
  assert.equal(filtered.runs, 0);
});

// -------------------------------------------------------------- promote
test('promote appends a clearly marked, commented proposal to a COPY of known-issues.yaml', () => {
  const real = path.join(REPO_ROOT, '.agents', 'troubleshooting', 'known-issues.yaml');
  const realHash = sha(real);
  const dir = tmp('promote');
  const copy = path.join(dir, 'known-issues.yaml');
  fs.copyFileSync(real, copy);
  const before = fs.readFileSync(copy);

  const ledger = path.join(dir, 'l.jsonl');
  const { ws } = graded('fix-webview-member-order', 'good');
  const rec = JSON.parse(apc(['eval', 'record', 'fix-webview-member-order', '--workspace', ws, '--agent', 'claude-code', '--model', 'opus', '--ledger', ledger, '--json']).stdout);
  const id = rec.row.run_id;

  const dry = apc(['eval', 'promote', id, '--ledger', ledger, '--known-issues', copy, '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(fs.readFileSync(copy).equals(before), 'dry-run writes nothing');
  assert.match(dry.stdout, /APC-EVAL PROPOSAL/);

  const r = apc(['eval', 'promote', id, '--ledger', ledger, '--known-issues', copy, '--note', 'Declare relays first']);
  assert.equal(r.status, 0, r.stderr);
  const after = fs.readFileSync(copy);
  assert.ok(after.subarray(0, before.length).equals(before), 'existing content is byte-identical (append-only)');

  const added = after.subarray(before.length).toString('utf8');
  assert.ok(added.includes(`# >>> APC-EVAL PROPOSAL run_id=${id}`));
  assert.ok(added.includes(`# <<< END APC-EVAL PROPOSAL run_id=${id}`));
  const nonEmpty = added.split('\n').filter((l) => l.trim() !== '');
  assert.ok(nonEmpty.every((l) => l.startsWith('#')), 'every appended line is a YAML comment -> file stays valid and inert');
  assert.ok(added.includes('Declare relays first'));
  assert.ok(added.includes('resolution_status: proposed'));
  assert.ok(added.includes('category: webview'));

  // accepting = stripping "# " from the YAML lines gives entries shaped like the existing ones
  const yamlLines = nonEmpty.filter((l) => l.startsWith('#   ')).map((l) => l.slice(2));
  assert.match(yamlLines[0], new RegExp(`^  - id: eval-fix-webview-member-order-${id}$`));
  assert.ok(yamlLines.some((l) => /^    title: "/.test(l)));

  // idempotent
  const again = apc(['eval', 'promote', id, '--ledger', ledger, '--known-issues', copy]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already proposed/);
  assert.ok(fs.readFileSync(copy).equals(after));

  assert.equal(sha(real), realHash, 'the real known-issues.yaml was never touched');
});

test('promote refuses failed runs unless --allow-failed, and unknown ids', () => {
  const dir = tmp('promote2');
  const copy = path.join(dir, 'ki.yaml');
  fs.writeFileSync(copy, 'issues:\n  - id: x-001\n    title: "t"'); // no trailing newline on purpose
  const ledger = path.join(dir, 'l.jsonl');
  const { ws } = graded('add-parameter', 'bad');
  const id = JSON.parse(apc(['eval', 'record', 'add-parameter', '--workspace', ws, '--agent', 'a', '--model', 'm', '--ledger', ledger, '--json']).stdout).row.run_id;
  const refused = apc(['eval', 'promote', id, '--ledger', ledger, '--known-issues', copy]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /did not pass/);
  assert.equal(apc(['eval', 'promote', 'deadbeef', '--ledger', ledger, '--known-issues', copy]).status, 1);
  assert.equal(fs.readFileSync(copy, 'utf8'), 'issues:\n  - id: x-001\n    title: "t"');

  const ok = apc(['eval', 'promote', id, '--ledger', ledger, '--known-issues', copy, '--allow-failed']);
  assert.equal(ok.status, 0, ok.stderr);
  const text = fs.readFileSync(copy, 'utf8');
  assert.ok(text.startsWith('issues:\n  - id: x-001\n    title: "t"\n'), 'a missing trailing newline is added before the block, original bytes preserved');
  assert.ok(text.includes('# >>> APC-EVAL PROPOSAL'));
  assert.ok(text.includes('Eval failure:'));
});
