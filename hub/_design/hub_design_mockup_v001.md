# APC Hub - Mockup v001 (review record)

Spec: `hub_design_spec_v001.md` · Status: DRAFT · Snapshot baked: 2026-09-13
Twin runnable file: `hub_design_mockup_v001.html` (same folder - open via
`file://`, zero deps, zero JS, system fonts, no images).

## How to review

1. Open `hub_design_mockup_v001.html` in a browser (double-click is enough).
2. Check against the spec: rectangles only, 1px rules, mono-first, amber
   (`#FF9500`) only on the logo arrow line, current-phase chips, `[!!]` flags.
3. Reply with what to change → next iteration becomes `_v002` (+ CHANGELOG).

## Section map (anchors = bookmarks)

`01 OVERVIEW · 02 PROJECTS · 03 SKILLS · 04 COMMANDS · 05 DESIGNS ·
06 SCRIPTS · 07 TEMPLATES · 08 TOOLS · 09 SETTINGS · 10 DOCS · ++ CONSISTENCY`

## Snapshot provenance (all values verified against live tree)

| Shown | Source |
|---|---|
| 4 plugins, phases, versions, complexity, validation | `plugins/*/status.json` (CloudWash, gnarly2, gnarly3, nf_gnarly) |
| setup completed 2026-08-14/windows, profile balanced, codex enabled | `apc.config.json` |
| `../apc_plugins|builds|releases` all exist | `Test-Path` 2026-09-13 |
| 3 designs + hex values | `design_library/manifest.json` |
| 18 skill dirs, 23 workflows (12+11), 33 scripts, 27 template files | tree listings |
| 16 docs, 696 headings | `^#{1,3}` counts per file |
| node v24.0.2 · python 3.12.10 · cmake 4.1.1 | sampled 2026-09-13 |
| JUCE 9.0.1 / pluginval.exe / visage present | `Test-Path` 2026-09-13 |

## Known mockup simplifications (phase-2 resolves)

- Only repo-local `plugins/` shown; live `../apc_plugins` listed as note.
- One plugin detail expanded (CloudWash); others collapse in live `ui/`.
- Docs appear as counts table; full reader with anchors comes with `ui/`.
- No JS: copy-buttons, search, bookmarks arrive with the live app.

## Full HTML (authoritative - twin of `.html` file)

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>APC HUB v001 // mockup - snapshot 2026-09-13</title>
<style>
/* == tokens.css (future split) == */
:root{
  --paper:#FAFAF7; --ink:#141414; --muted:#6B6B6B;
  --rule:#1A1A1A; --amber:#FF9500; --amber-ink:#000;
}
/* == base.css == */
*{box-sizing:border-box; border-radius:0 !important; box-shadow:none !important;}
body{background:var(--paper); color:var(--ink);
  font-family:system-ui,"Segoe UI",Roboto,Arial,sans-serif;
  font-size:15px; line-height:1.5; margin:0;}
.mono,pre,table,code,.kicker,.nav{font-family:Consolas,"Cascadia Mono",Menlo,monospace;}
.wrap{max-width:1120px; margin:0 auto; padding:0 24px;}
a{color:var(--ink);}
/* == layout.css == */
header.top{border-bottom:2px solid var(--rule); padding:24px 0 16px;}
header.top pre.logo{font-size:13px; line-height:1.25; margin:0 0 8px; overflow-x:auto;}
header.top pre.logo .amber{color:var(--amber); font-weight:bold;}
.titleline{font-size:20px; font-weight:700; margin:0;}
.badge{display:inline-block; border:1px solid var(--rule); padding:1px 8px; font-size:12px;}
.badge.ok{background:var(--ink); color:var(--paper);}
nav.index{border-bottom:1px solid var(--rule); padding:10px 0;}
nav.index a{display:inline-block; margin:0 14px 6px 0; font-size:13px; text-decoration:none;
  border-bottom:2px solid transparent;}
nav.index a:hover{border-bottom-color:var(--amber);}
section{padding:20px 0 8px; border-bottom:1px solid var(--rule);}
.kicker{font-size:12px; text-transform:uppercase; letter-spacing:.12em; margin:0 0 10px;}
.kicker .n{display:inline-block; background:var(--ink); color:var(--paper); padding:0 6px; margin-right:8px;}
footer{padding:20px 0 40px; color:var(--muted); font-size:13px;}
/* == components.css == */
table{border-collapse:collapse; width:100%; margin:0 0 16px; font-size:13.5px;}
th{font-size:12px; text-transform:uppercase; letter-spacing:.1em; text-align:left;
  border-bottom:2px solid var(--rule); padding:6px 12px 6px 0;}
td{border-bottom:1px solid var(--rule); padding:6px 12px 6px 0; vertical-align:top;}
table.grid{border:1px solid var(--rule);}
.chip{display:inline-block; border:1px solid var(--rule); padding:0 6px; font-size:11.5px;
  white-space:nowrap;}
.chip.cur{background:var(--amber); border-color:var(--amber); color:var(--amber-ink); font-weight:bold;}
.tok-ok{font-weight:bold;}
.tok-warn{display:inline-block; background:var(--amber); color:var(--amber-ink);
  font-weight:bold; padding:0 6px;}
.mut{color:var(--muted);}
.pipe{font-size:14px; margin:8px 0 12px;}
.banner{border:1px solid var(--rule); border-left:4px solid var(--amber);
  padding:8px 12px; margin:0 0 16px; font-size:13.5px;}
.sw{display:inline-block; width:14px; height:14px; border:1px solid var(--rule);
  vertical-align:-2px; margin-right:6px;}
.check{white-space:nowrap;}
.scrollx{overflow-x:auto;}
h3{font-size:15px; margin:18px 0 6px;}
pre.screen{border:1px solid var(--rule); padding:10px 12px; font-size:13px;
  overflow-x:auto; background:transparent;}
@media(max-width:760px){
  header.top pre.logo{font-size:2.2vw; min-width:560px;}
  .logoscr{overflow-x:auto;}
  nav.index a{margin-right:10px;}
}
</style>
</head>
<body>
<div class="wrap">

<header class="top">
<div class="logoscr"><pre class="logo">          ▄████████▄   ██████████▄    ▄████████▄
        ███▀    ▀███  ███     ▀███  ███▀    ▀███
       ███      ███  ███     ▄███  ███
      ████████████  ██████████▀   ███
     ███      ███  ███           ███▄▄▄▄▄▄███
    ███      ███  ███            ▀████████▀
<span class="amber">   --------------------------&gt; AudioPluginCoder</span></pre></div>
<p class="titleline">APC HUB <span class="mut">// v001 mockup - read-only command center</span></p>
<p class="mono" style="font-size:13px">
<span class="badge ok">[OK] SETUP 2026-08-14 / WINDOWS</span>
<span class="badge">PROFILE: BALANCED</span>
<span class="badge">SNAPSHOT: 2026-09-13 (BAKED, STATIC)</span>
</p>
</header>

<nav class="index mono">
<a href="#01-overview">01 OVERVIEW</a><a href="#02-projects">02 PROJECTS</a><a href="#03-skills">03 SKILLS</a><a href="#04-commands">04 COMMANDS</a><a href="#05-designs">05 DESIGNS</a><a href="#06-scripts">06 SCRIPTS</a><a href="#07-templates">07 TEMPLATES</a><a href="#08-tools">08 TOOLS</a><a href="#09-settings">09 SETTINGS</a><a href="#10-docs">10 DOCS</a><a href="#11-consistency">++ CONSISTENCY</a>
</nav>

<main>
<section id="01-overview">
<p class="kicker"><span class="n">01</span>// OVERVIEW - src: apc.config.json</p>
<div class="scrollx"><table class="grid">
<tr><th>Metric</th><th>Value</th><th>Status</th></tr>
<tr><td>Plugins tracked</td><td>4 (1 SHIP / 2 DESIGN / 1 PLAN)</td><td class="tok-ok">[OK]</td></tr>
<tr><td>UI default</td><td>webview · visage disabled</td><td class="tok-ok">[OK]</td></tr>
<tr><td>JUCE pin</td><td>9.0.1 - <span class="mono">_tools/JUCE</span> present</td><td class="tok-ok">[OK]</td></tr>
<tr><td>pluginval</td><td><span class="mono">_tools/pluginval/pluginval.exe</span> present</td><td class="tok-ok">[OK]</td></tr>
<tr><td>Configured dirs</td><td class="mono">../apc_plugins · ../apc_builds · ../apc_releases - all exist</td><td class="tok-ok">[OK]</td></tr>
</table></div>
</section>

<section id="02-projects">
<p class="kicker"><span class="n">02</span>// PROJECTS - src: &lt;plugins_dir&gt;/*/status.json</p>
<div class="scrollx"><table class="grid">
<tr><th>Plugin</th><th>Ver</th><th>Phase</th><th>UI</th><th>Cx</th><th>Validation</th><th>Next</th></tr>
<tr><td><b>CloudWash</b></td><td>v1.0.0</td><td><span class="chip cur">[ SHIP_COMPLETE ]</span></td><td>WEBVIEW</td><td>5/5</td><td class="check">[x] 11/11</td><td class="mut">complete</td></tr>
<tr><td><b>gnarly2</b></td><td>v0.1.0</td><td><span class="chip cur">[ DESIGN_COMPLETE ]</span></td><td>WEBVIEW</td><td>2/5</td><td class="check">[x] 5 · [ ] 2</td><td class="mono">/apc-impl gnarly2</td></tr>
<tr><td><b>nf_gnarly</b></td><td>v0.0.0</td><td><span class="chip cur">[ DESIGN_COMPLETE ]</span></td><td>WEBVIEW</td><td>2/5</td><td class="check">[x] 5 · [ ] 2</td><td class="mono">/apc-impl nf_gnarly</td></tr>
<tr><td><b>gnarly3</b></td><td>v0.1.0</td><td><span class="chip cur">[ PLAN_COMPLETE ]</span></td><td>VISAGE</td><td>2/5</td><td class="check">[x] 4 · [ ] 3</td><td class="mono">/apc-design gnarly3</td></tr>
</table></div>
<h3>CloudWash - detail (7 phase_history entries, last 2026-01-31)</h3>
<p class="pipe mono">DREAM -&gt; PLAN -&gt; DESIGN -&gt; IMPL -&gt; <span class="chip cur">[ SHIP ]</span></p>
<pre class="screen">[x] creative brief  [x] parameter spec  [x] architecture  [x] ui framework
[x] design  [x] code (4.1.1/4.1.2/4.1.3)  [x] tests  [x] ship ready</pre>
<p class="mut mono" style="font-size:13px">NOTE: repo-local plugins/ shown. Configured live dir ../apc_plugins exists - phase-2 lists both, labelled.</p>
</section>

<section id="03-skills">
<p class="kicker"><span class="n">03</span>// SKILLS - src: .agents/skills/ (18 dirs, single source of truth)</p>
<div class="scrollx"><table class="grid">
<tr><th>Skill dir</th><th>Kind</th><th>Flag</th></tr>
<tr><td class="mono">apc-setup</td><td>phase</td><td class="tok-ok">[OK]</td></tr>
<tr><td class="mono">audio-plugin-coder</td><td>Codex package (SKILL.md)</td><td class="tok-ok">[OK]</td></tr>
<tr><td class="mono">dream · plan · design · impl · ship · test · debug</td><td>phase ×7</td><td class="tok-ok">[OK]</td></tr>
<tr><td class="mono">skill_design_webview · skill_testing · skill_troubleshooting</td><td>domain ×3</td><td class="tok-ok">[OK]</td></tr>
<tr><td class="mono">skill_ideation · skill_planning · skill_design · skill_implementation · skill_packaging · skill_debug</td><td>legacy ×6</td><td><span class="tok-warn">[LEGACY?]</span> confirm in tidy-up</td></tr>
</table></div>
</section>

<section id="04-commands">
<p class="kicker"><span class="n">04</span>// COMMANDS - src: .agents/workflows/ (12 primary + 11 aliases)</p>
<div class="scrollx"><table class="grid">
<tr><th>Primary</th><th>Alias</th><th>Codex form</th></tr>
<tr><td class="mono">/apc-setup · /apc-dream · /apc-plan</td><td class="mono">/setup · /dream · /plan</td><td class="mono" rowspan="4">$audio-plugin-coder:audio-plugin-coder &lt;action&gt; [Name]<br><span class="mut">action = setup|dream|plan|design|impl|test|debug|status|resume|ship|new</span></td></tr>
<tr><td class="mono">/apc-design · /apc-impl(+implement) · /apc-test</td><td class="mono">/design · /impl · /test</td></tr>
<tr><td class="mono">/apc-debug · /apc-ship · /apc-status</td><td class="mono">/debug · /ship · /status</td></tr>
<tr><td class="mono">/apc-resume · /apc-new · <b>/apc-hub (this, proposed)</b></td><td class="mono">/resume · /new · -</td></tr>
</table></div>
</section>

<section id="05-designs">
<p class="kicker"><span class="n">05</span>// DESIGNS - src: design_library/manifest.json (v1.1.0, 3 designs)</p>
<div class="scrollx"><table class="grid">
<tr><th>Design</th><th>Category</th><th>Colors</th><th>UI</th><th>Best for</th></tr>
<tr><td><b>rams60</b> - Rams 60</td><td>vintage-hardware</td><td><span class="sw" style="background:#1F7A3D"></span><span class="mono">#1F7A3D</span> · <span class="sw" style="background:#D9531E"></span><span class="mono">#D9531E</span> · <span class="sw" style="background:#EFE8D8"></span><span class="mono">#EFE8D8</span></td><td>WEBVIEW</td><td>lo-fi, hardware emulation</td></tr>
<tr><td><b>amber-signal</b> - Amber Signal</td><td>modern</td><td><span class="sw" style="background:#FF9500"></span><span class="mono">#FF9500</span> · <span class="sw" style="background:#FFB946"></span><span class="mono">#FFB946</span> · <span class="sw" style="background:#1C1C1E"></span><span class="mono">#1C1C1E</span></td><td>WEBVIEW</td><td>dynamics, effects, metering</td></tr>
<tr><td><b>neogrid-minimal</b> - NeoGrid Minimal</td><td>minimal</td><td><span class="sw" style="background:#00F5FF"></span><span class="mono">#00F5FF</span> · <span class="sw" style="background:#7B68EE"></span><span class="mono">#7B68EE</span> · <span class="sw" style="background:#0A0A0F"></span><span class="mono">#0A0A0F</span></td><td>WEBVIEW</td><td>synths, modulators</td></tr>
</table></div>
</section>

<section id="06-scripts">
<p class="kicker"><span class="n">06</span>// SCRIPTS - src: scripts/ (33 entries)</p>
<div class="scrollx"><table class="grid">
<tr><th>Group</th><th>Members</th></tr>
<tr><td>build / state</td><td class="mono">build-and-install · state-management · backup · rollback · lib/Get-ApcPaths (ps1+sh)</td></tr>
<tr><td>validate ×5</td><td class="mono">plugin-status · state-management · visage-setup · webview-setup · webview-member-order</td></tr>
<tr><td>utility</td><td class="mono">setup · system-check · error-detection · pluginval-integration · preview-design · copy-agent-folders · add-icon-to-exe · terminal-monitoring · list-folder-structure · apc-write-config · rcedit-x64.exe · setup_bridges.bat</td></tr>
<tr><td>installer / codex</td><td class="mono">installer/ ×3 (win/mac/iss) · codex/ ×10 (run, smoke-proof, routing-schema, install-profiles, luna/terra/sol/astra)</td></tr>
</table></div>
</section>

<section id="07-templates">
<p class="kicker"><span class="n">07</span>// TEMPLATES - src: templates/ (27 files)</p>
<div class="scrollx"><table class="grid">
<tr><th>Template</th><th>Files</th><th>Notes</th></tr>
<tr><td class="mono">webview/</td><td>4</td><td>CMakeLists, PluginEditor.{cpp,h}, README</td></tr>
<tr><td class="mono">visage/</td><td>5</td><td>+ VisageControls.h</td></tr>
<tr><td class="mono">ffgl/</td><td>6</td><td>visual plugins (Resolume/VDMX)</td></tr>
<tr><td class="mono">max-external/</td><td>7</td><td>Max/MSP externals</td></tr>
<tr><td class="mono">root</td><td>5</td><td>2× CMakeLists templates, LICENSE, status-template.json, IMPROVEMENTS.md</td></tr>
</table></div>
</section>

<section id="08-tools">
<p class="kicker"><span class="n">08</span>// TOOLS - src: _tools/ + sampled 2026-09-13</p>
<div class="scrollx"><table class="grid">
<tr><th>Tool</th><th>State</th><th>Status</th></tr>
<tr><td class="mono">JUCE 9.0.1 (_tools/JUCE)</td><td>present, matches pin</td><td class="tok-ok">[OK]</td></tr>
<tr><td class="mono">pluginval.exe</td><td>prebuilt binary present</td><td class="tok-ok">[OK]</td></tr>
<tr><td class="mono">visage (_tools/visage)</td><td>source present, enable_visage=false</td><td class="tok-ok">[OK]</td></tr>
<tr><td class="mono">node v24.0.2 · python 3.12.10 · cmake 4.1.1</td><td>sampled at snapshot</td><td class="tok-ok">[OK]</td></tr>
</table></div>
</section>

<section id="09-settings">
<p class="kicker"><span class="n">09</span>// SETTINGS - src: apc.config.json (live) vs .example.json</p>
<div class="scrollx"><table class="grid">
<tr><th>Key</th><th>Live</th><th>Example</th></tr>
<tr><td class="mono">paths.plugins_dir</td><td class="mono">../apc_plugins [OK]</td><td class="mono">plugins</td></tr>
<tr><td class="mono">paths.build_dir</td><td class="mono">../apc_builds [OK]</td><td class="mono">build</td></tr>
<tr><td class="mono">paths.release_dir</td><td class="mono">../apc_releases [OK]</td><td class="mono">release</td></tr>
<tr><td class="mono">defaults</td><td class="mono">webview · visage off</td><td class="mono">same</td></tr>
<tr><td class="mono">models.profile</td><td class="mono">balanced · 10 phases (auto; strong/strongest/economy)</td><td class="mono">same</td></tr>
<tr><td class="mono">models.codex</td><td class="mono">enabled · terra default · luna/terra/sol/astra · escalation on</td><td class="mono">disabled</td></tr>
<tr><td class="mono">setup</td><td class="mono">completed 2026-08-14 · windows</td><td class="mono">false</td></tr>
</table></div>
</section>

<section id="10-docs">
<p class="kicker"><span class="n">10</span>// DOCS - src: docs/ (16 files, 696 headings)</p>
<div class="scrollx"><table class="grid">
<tr><th>Doc</th><th>#</th><th>Doc</th><th>#</th></tr>
<tr><td class="mono">README.md (index)</td><td>25</td><td class="mono">PROJECT_STRUCTURE.md</td><td>34</td></tr>
<tr><td class="mono">plugin-development-lifecycle.md</td><td>87</td><td class="mono">build-system.md</td><td>85</td></tr>
<tr><td class="mono">command-reference.md</td><td>54</td><td class="mono">FAQ.md</td><td>58</td></tr>
<tr><td class="mono">state-management-deep-dive.md</td><td>65</td><td class="mono">ship-workflow.md</td><td>61</td></tr>
<tr><td class="mono">troubleshooting-guide.md</td><td>48</td><td class="mono">webview-framework.md</td><td>48</td></tr>
<tr><td class="mono">github-actions.md</td><td>40</td><td class="mono">icon-management-guide.md</td><td>38</td></tr>
<tr><td class="mono">installer-creation.md</td><td>30</td><td class="mono">codex-orchestration.md</td><td>9</td></tr>
<tr><td class="mono">codex-compatibility.md</td><td>7</td><td class="mono">model-routing.md</td><td>7</td></tr>
</table></div>
<p class="mut mono" style="font-size:13px">Phase-2: in-app reader with per-heading anchors + bookmarks. Counts = ^#{1,3} lines.</p>
</section>

<section id="11-consistency">
<p class="kicker"><span class="n">++</span>// CONSISTENCY - tidy-up radar (display only)</p>
<div class="banner mono"><span class="tok-warn">[!!]</span> 6 legacy <span class="mono">skill_*</span> dirs beside new-style phase skills - confirm redundant (§6.1 spec)</div>
<div class="banner mono"><span class="tok-warn">[!!]</span> gnarly3 uses VISAGE while <span class="mono">enable_visage=false</span> - intent or leftover?</div>
<pre class="screen">[ -- ] root commands/ empty            -&gt; pointer: use .agents/workflows
[ -- ] root skills/ = Codex package only -&gt; labelled, not a source
[OK] alias pointers resolve              -&gt; spot-checked (status.md chain)
[OK] ../apc_plugins|builds|releases      -&gt; all exist on disk</pre>
</section>
</main>

<footer class="mono">
=== APC HUB v001 ============================================================<br>
snapshot baked 2026-09-13 · sources: apc.config.json, plugins/*/status.json, design_library/manifest.json, .agents/, scripts/, templates/, docs/, _tools/ · zero JS, system fonts, no images
</footer>

</div>
</body>
</html>
```

## Review checklist (reply with numbers)

1. Amber density OK, or more/less?
2. Dark theme now or defer?
3. Pipeline: 5 coarse stages, or full `status.json` phase strings?
4. Any section missing / any value wrong?
