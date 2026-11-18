# Changelog

All notable changes to Audio Plugin Coder (APC) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [2.0.0] - 2026-11-19

APC 2.0 turns the framework from "AI scaffolds a plugin" into "AI ships a product": presets, licensing,
updates, a complete themeable WebView UI kit with one designed look (APC Minimal), a DSP library,
audio/realtime/accessibility validators, an eval harness, and a Hub that can preview and tune the design.
**Breaking:** the shipped design libraries `rams60`, `amber-signal` and `neogrid-minimal` are removed
(see *Removed*).

### Added

- **Plugin Product Standards (`apc-standards/1.0`)** - machine-readable registry (`schemas/apc-standards.json`), `apc standards list|set|validate|plan`, Advanced Setup in `/apc-setup`, guided configuration in `/apc-plan`, and a Hub **STANDARDS** page (`GET /api/v1/standards`; global options editable through the existing `POST /api/v1/config`, plugin options read-only). New options `preset.factory_install` (P-14) and `engine.state_scope` (X-08, default: engine/quality state lives in the DAW chunk). Rules: `.agents/rules/product-standards.md`.
- **Preset backend** - `apc presets validate|index|promote|init|paths|check-manifest`, `schemas/pmx1-vocabulary.json` (slugs + appended effect categories), extended `apc-preset/1.0` (engine section, `state_version`, content-hashed sample refs), header-only `common/apc/ApcAtomicFile.h`, `ApcPaths.h`, `ApcDefaultsFirst.h` (kill-mid-save fault injection tested).
- **Updater / license seam / settings store** (std-only C++17 in `common/apc/`: `ApcSemVer`, `ApcCanonicalJson`, `ApcUpdateFlow`, `ApcLicense`, `ApcSettingsStore`) plus `apc release keygen|manifest|sign|verify` (`apc-update/1.0`, Ed25519, own key separate from the license key; flow ends in `ReadyToInstall`). Licensing L-06/L-07 stay OPEN - seam only.
- **`common/dsp/` (`APC::dsp`)** - header-only DSP kit (smoother, denormal guard, SPSC FIFO, biquad, SVF, soft clipper, dry/wet, half-band oversampler) with self-tests; `apc validate rt --plugin <Name>` static realtime-safety scanner.
- **Audio validation pipeline** - `apc audio <Plugin>` (pluginval strictness 10, clap-validator, null/block-size invariance, NaN/denormal, tail, CPU bench; unrunnable gates report *skipped*, never pass), `templates/audio-test-harness`, `cmake/apc-sanitizers.cmake`, `apc sbom <Plugin>` (CycloneDX 1.5 + provenance), env-driven signing/packaging scripts in `scripts/installer/` (dry-run verified only; real signing not exercised).
- **Preview loop and a11y** - `apc watch`, `apc screenshot` (deterministic headless Edge/Chrome, pure-JS PNG diff), `apc validate a11y`. Hub writes now require loopback peer/Host/Origin.
- **Docs CI, evals, onboarding** - `apc docs check` (+ `.github/workflows/docs.yml`), `apc eval` harness with four golden tasks, `.devcontainer/`, `scripts/lib/juce-shallow-clone.{sh,ps1}` (used by `apc doctor --fix` as a fallback when the JUCE submodule is missing).
- **Licensing for developers who sell plugins (decisions L-06/L-07 closed).** `apc license keygen|issue|verify|inspect|serial|serve|request-code`: **Method A `signed-file`** (offline Ed25519-signed `apc-license/1.0` files, no server) and **Method B `online-activation`** (activation API spec `schemas/apc-activation-api.schema.json` + zero-dependency reference issuer with seat limits, hashed serials and offline request-code/file exchange). `license.method` / `license.protection` (`minimal` default) replace the old OPEN options; iLok/dongles and third-party SDKs are documented pointers only. C++ cross-check proves `ApcLicense.h` canonicalises Node-issued licenses to the exact signed bytes. Guides: `licensing-methods.md`, `licensing-seam.md`.
- **WebView UI kit (style-neutral, themeable)** in `templates/webview/apc-ui/`: gesture controls (`knob`, `slider`, `selector`, `toggle`), right-click context panel, help system (tooltip, info bar, F1 + visible Help button), window chrome (brand header, always-visible version footer, 5 %-snapping gripper, scale steps, theme switch), settings overlay, preset browser, activation and update dialogs, in-memory mock backend with 7 scenarios, and `CONTRACT.md`. `apc kit test` runs 381 DOM assertions in headless Edge/Chrome (skips cleanly without a browser).
- **Native side of the kit** (`common/apc/juce/`, JUCE 9 `juce_core`): `ApcPresetStore.h` (rows identical to `apc presets index`), `ApcWebBridge.h`, `ApcApvtsParams.h`, `ApcPendingSwap.h`, plus `apc-bridge.js` and opt-in `APC_UI_KIT` blocks in the WebView templates (member order preserved). 1 142 C++ checks pass with MSVC; the WebBrowserComponent wiring is compile/link-checked only.
- **Hub `09c KIT` page** - live gallery of every kit component under each design-library theme, scenario, scale and day/night, with docs, markup, gesture maps and a standards coverage table (`/api/v1/kit`, `/kit/*`, `/kit-demo/*`).
- **UI kit widgets** (`apc-widgets.js` + `apc-widgets.css`): `button`, `buttons`, `segmented`, `checkbox`, `radio`, `dropdown`, `menu`, `tabs`, `textfield`, `numberfield`, `label`, `readout`, `panel`, `divider`, `led`, `progress`, `list`, `logo`, the `APC.widgets` API, common options (`data-label`, `data-aria-label`, `data-title`, `data-size`, `data-disabled`, `data-orient`, `data-param`) and the `apc:change` / `widget:change` events. Guide `.agents/guides/ui-kit-widgets.md`, self-test `tests/kit-widgets.html`.
- **UI kit visualisation elements** (`apc-viz.js` + `apc-viz.css`, demo data `apc-mock-viz.js`): `graph`, `envelope`, `spectrum`, `waveform`, `scope`, `meter`, `stepseq`, `xypad`, `picture`; the `viz` bridge event (native `apc.viz`), array parameters for `stepseq`, canvas elements that re-read the theme tokens at draw time. Guide `.agents/guides/ui-kit-viz.md`, self-test `tests/kit-viz.html` (`?demo=1[&theme=day]` showcase). `apc-mock*.js` is demo/test data: vendored for previews, never bundled into a plugin (CMake template filter).
- **Element spec** in `design_library/apc-minimal/design-system.json`: `elements` defines all 46 kit elements (43 registered names + context panel, tooltip, toast) by parts, states, sizes, options and accessibility, every value a token; plus `groups`, `tokenGroups` (every token once, with kind and description), `fontsets` (system-safe stacks only) and `scales` (the `--t-*` rem + px-floor ladder). `scripts/design-tokens-check.js` / `test/design-tokens.test.js` verify that referenced tokens exist, that every `APC.register` name has an entry and that the token groups are complete.
- **Tokens:** `--accent-text` (accent-coloured text: night #FF7B64, day #A6331F, >= 4.5:1 on `--plate`, `--plate-2`, `--inset`, `--surface`), `--ok-text` and `--apc-danger-text` (success / error text; equal to `--ok` / `--apc-danger` at night, darker in day mode), `--r-radio`, `--r-led`, `--apc-viz-node`, `--apc-logo-h`.
- **Hub 09c KIT: theme editor and element tuning.** THEME EDITOR with a pinned live component preview, auto-match, token search, collapsible groups and a changed-only filter (drafts in `localStorage`, export as `tokens.css` / `changes.json`). ELEMENT SPEC tuning of line thickness, radius, dimensions, knob / slider geometry and visualisation node size, saved to `elementTuning` in `design-system.json` through the guarded, revision-checked `POST /api/v1/design/<id>/tuning` (allow-list in `hub/kit-tuning.js`, `.bak` backup). The canonical APC Minimal face `hub/_design/apc_filter_f30_annotate_v006.html` is served byte-for-byte at `/kit-demo/_reference`.
- **Design-language documentation** for APC Minimal ("Zeichnung 2030": five colours with one job each, type, grid, control and colour-role rules) in `design_library/apc-minimal/README.md`.
- **`patches/visage/`**: the local `_tools/visage` fixes (resize framebuffer/read-back thrash and leak, DPI re-bake, clip bounds scaled twice below 1.0 dpi) as a patch file with an upstream status table.
- Hub KIT catalog lists the 27 new elements (markup, options, events, gestures, demo scene each); demo pages load `apc-widgets.css` / `apc-viz.css`. New test: every kit file is vendored or deliberately excluded.
- Agent guides under `.agents/guides/` for each of the above; `/apc-test`, `/apc-ship`, `/apc-impl`, `/apc-design` workflows list the new gates and tooling.

### Removed

- **Shipped designs `rams60`, `amber-signal` and `neogrid-minimal`** are removed from `design_library/`, replaced by one designed look: **`apc-minimal`** ("Zeichnung 2030": deep teal plate, coral signal, cyan energy, night + day) (`tokens.css` token contract, `design-system.json`, `preview.html`). The framework now delivers bare-bones only; copy `design_library/apc-minimal/` to start your own design. `design_library/manifest.json` is version 2.0.0 and entries gain `tokens` / `spec` fields. `/kit-theme/<id>.css` serves a design's `tokens.css` (only its bundled font URLs are pointed at the Hub; designs without one keep the derived fallback); `templates/webview/apc-ui/apc-core.css` defaults equal the APC Minimal night tokens.

### Fixed

- **Fix: APC Minimal failed WCAG 4.5:1 text contrast in 27 places** (found by `apc validate a11y`). Night `--ink-3` #7A9AA5 -> #80A1AC, day `--ink-3` #567380 -> #506C79, day `--accent` / `--apc-danger` #D9482F -> #D0442C (white button text now 4.62:1; the old waiver is gone), error and success text use the new `--apc-danger-text` / `--ok-text`. All 441 kit text pairs pass; the lowest is 4.58:1.
- **Fix: Hub token list for APC Minimal was wrong** - the `tokens.css` parser read the first `{...}` block, which is now `@font-face`; it now reads the first plain rule that declares custom properties.
- **Fix: Hub 09c demo iframe had lost its `sandbox` attribute** (restored to `allow-scripts allow-same-origin`, as documented).
- **Fix: element-tuning save rejected JSON with a UTF-8 BOM** (mis-encoded BOM literal); the handler now sits with the other guarded writes, outside the read-only KIT block.
- Popup / context-sheet shadows are tokenised (`--apc-shadow-sheet`, same default value).
- Tests updated for the APC Minimal palette (no amber), the same-origin font-URL rewrite on `/kit-theme/`, and the removed reference-scenario state.
- **Fix: `apc-fit.js` native calls never reached JUCE 9** - it used `window.__juce__.invoke`, which does not exist (JUCE 9 injects `window.__JUCE__`). Grip resize / scale / prefs calls now use the `__juce__invoke` event protocol.
- **Fix: Hub server crash** on a malformed percent-escape in a request path (now HTTP 400).
- **Fix: `ui-compose` / `apc watch`** failed when the kit folder contained subfolders (copies files only).
- **Fix: reference plugin (APC FILTER) looked unprofessional.** Header controls had five different heights (A/B 1.25 rem, preset chip 1.4 rem, help/scale/gear 1.1 rem ...) and uneven gaps. Now every header box (A/B, preset prev/name/next/Save, MENU, help, day/night, scale -/value/+, gear) is exactly `--ctl-h` high on one centre line with one type style and one border; boxes in a group sit `--ctl-gap` apart, groups `2 x --ctl-gap` (kit CSS: control-row block in `apc-components.css`; header and footer padding is `--pad`). The plate was re-laid out on a half-cell (`--pad`) grid: panel gutter, plate margin and panel padding are all `--pad` (was 1 cell and more), panels align to one column/row grid, and the freed space went to bigger knobs (4.5 rem), graph, spectrum, envelope and sequencer; captions and controls share baselines (the selector caption sits above its control like every other labelled control). `test/hub-reference.test.js` now measures this in a real browser (night/day, two window sizes): equal control heights and gaps, equal gutters, grid-aligned panels, no clipped text, nothing outside its panel or overlapping.
- **Fix: the kit did not stick to its own design (APC Minimal).** Controls rendered with the browser/OS look: the modulation **amount sliders in the context panel** were native `<input type=range>` (grey OS track and thumb), plus native checkboxes (settings, preset save/filters), selects, number spinners, the search clear button, textarea resize grips, `<details>` triangles, scrollbars, `title=""` tooltip bubbles, placeholder colours, round list bullets and UA button fonts. Fixed in `apc-components.css` (a zero-specificity "design conformance" base block: `appearance:none`, token borders/fills/fonts, flat square checkbox/radio, flat range slider with a zero-origin fill via `.apc-range`, flat arrowless token scrollbar, themed `<option>`s, `accent-color`, `::selection`, focus ring, square bullets), `apc-context.js` (slider wrapper), `apc-help.js` (a `title` is shown by the kit tooltip while hovered; the OS bubble is suppressed) and `apc-viz.css` (a `:focus` rule that beat the focus ring of `.apc-viz-clip` / `.apc-viz-step`). Kit-B buttons, tabs and chips are now UPPERCASE mono labels like the rest of the kit, field and chip borders use `--rule` (the 3:1 control border) instead of `--rule-2`, and raw font sizes / spacings / strokes in the kit-B CSS use the `--t-*`, `--label-spacing`, `--stroke`, `--disabled-opacity` tokens. **Guard:** `templates/webview/apc-ui/tests/kit-conformance.html` (run by `apc kit test`) opens every element and every overlay (context panel, value entry, menus, dropdown popups, tooltip, toasts, help mode and manual, all settings tabs, preset browser with filters / Save As / Import, licence and update dialogs) in night and day, walks the DOM and fails on any UA appearance, UA font, non-token colour, radius or shadow outside the shape tokens, gradient, UA scrollbar, text below the legibility floor (also at a tiny rem) or missing focus ring; a deliberately offending fixture proves the walker fires. `design-system.json` `elements` gained the context-panel slider parts and the settings select / checkbox / scrollbar parts.

### Changed
- UI kit: modulated knobs/sliders show ONE summed modulation arc/band (all active routes added, clamped) instead of one arc per source; sources are listed in the context panel only. The visible `⋯` options button is gone by default (right-click, long-press and Shift+F10 / ContextMenu already open the panel; `data-more="show"` opts in). Hub pages use the full width of the content section.

- `bin/apc.js` gains a pluggable module router (`scripts/apc-*.js`, `scripts/validators/<kind>.js`); `npm test` now runs `scripts/run-tests.js` (works on Node 18-24).
- **Flat re-skin of `knob`, `slider`, `selector`, `toggle`** (behaviour unchanged): hairline dial with a `--knob-arc` accent arc and a pointer line, a `--track-w` slider with a flat cap, a joined `[<] value [>]` selector, a square sliding toggle; new options `data-size`, `data-disabled`, `data-readout`, `data-unit`, `data-ticks`, `data-bipolar`, `data-steppers`, `data-variant="button"`. Night `--rule` raised to #6B675C (3:1 control borders). Accent-coloured text in the kit CSS now uses `--accent-text` (the day `--accent` is not 4.5:1 on `--plate-2` / `--inset`). The kit ships ONE design (APC Minimal); `CONTRACT.md` and the design/hub guides say so and point to the element spec.
- Docs repair: broken relative links and stale strings fixed; remaining known debt is tracked in `docs/.stale-allowlist.json`.

### Known limits

- The UI kit exists for WebView only; the Visage equivalent is not built. Kit verified in headless Edge only (not WebView2 in a DAW, WKWebView or WebKitGTK).
- Not provided: Ed25519 verify adapter and plugin-side HTTPS client (injected via `ISignatureVerifier` / `IHttp`), machine-id readers, a production license issuer (the reference issuer is dev/test, loopback HTTP).
- C++ headers verified with MSVC only; macOS/Linux compilers, real signing/notarization, Ed25519 verify and HTTP adapters are unverified/not provided.
- Factory packs install to the installing user's folder (P-14); other accounts need *Restore Factory Layout*.

## [1.8.0] - 2026-10-10

### Added

- **CLAP plugin format — beta (opt-in per plugin).** New `_tools/clap-juce-extensions` submodule (nested `clap`/`clap-helpers` deps — `git submodule update --init --recursive`) bridges JUCE plugins to CLAP since JUCE 9 has no native CLAP wrapper. Plugins opt in during `/apc-plan` (`status.json` -> `formats.clap`, `clap_id` from `clap.id_prefix` in `apc.config.json`, `clap_features`); the impl templates emit a guarded `clap_juce_extensions_plugin(...)` block producing a `<Name>_CLAP` target (`<Name>.clap` artefact). `build-and-install.{ps1,sh}` build + install it (Windows: `%LOCALAPPDATA%\Programs\Common\CLAP`, no admin; macOS: `~/Library/Audio/Plug-Ins/CLAP`; Linux: `~/.clap`) and run `clap-validator` (`scripts/clap-validator-integration.*`, `Install-ClapValidator` downloads a release binary) — pluginval cannot read CLAP. The Inno installer gains a conditional "CLAP Plugin" component (`{commoncf}\CLAP`), the macOS DMG a `CLAP/` folder, CI a status.json-gated `<Name>_CLAP` build step + `.clap` artifact collection (plugin CI lives in the apc-plugins repo — port the documented pattern from `docs/github-actions.md` there), and `apc.config.json` gains `clap.id_prefix` + `paths.clap_install_dir`. Root CMake gate: `APC_ENABLE_CLAP` (ON; a missing submodule never breaks configure). `plugins/ClapSmokeTest/` is the canonical opt-in example and smoke test. **Beta disclaimer:** CLAP support could not be fully tested yet — a basic plugin configures, builds, validates and loads, but it is not battle-tested across DAWs. Known issue `clap-001`: upstream wrapper skips `paramsRescan` after `state.load`, so `clap-validator`'s `state-reproducibility-*` tests fail on all APVTS plugins until free-audio/clap-juce-extensions PR #189 merges (non-fatal, harmless in real hosts).

## [1.7.0] - 2026-10-09

### Added

- **Host-agnostic subagent orchestration (`/apc-orchestrate`).** Canonical worker profiles in `.agents/agents/*.md` (`cheap-worker` / `standard-worker` / `deep-worker` / `expert-worker`, mirroring the Codex TOML tiers) are read natively by Devin and synced to `.claude/agents/` + `.opencode/agent/` by `scripts/sync-agents.ps1` / `.sh` (tool-name normalization, `mode: subagent`, write/patch hard-deny on restricted profiles, `-Check`/`--check` CI mode). New `orchestrate` skill + `apc-orchestrate` workflow/command decompose a goal into disjoint-file subtasks, run workers in bounded parallel waves, verify objectively, and integrate — with sequential/`codex exec` fallback on hosts without native subagents. Docs: `docs/orchestration.md`.

## [1.6.0] - 2026-09-29

### Added

- **UI layout contract — rem-grid system, `ui-map` as-built manifest, lint gate, Hub review tool** (`schemas/ui-map.schema.json`, `scripts/ui-compose.js`, `scripts/ui-lint.js`, `tools/ui-preview/`). Plugin UIs declare geometry against a shared contract; `ui-lint` runs as a gate.
- **Visage adaptive raster recovery + Windows crash minidumps** (known-issue docs visage-001/002); crash handler gated to the Standalone wrapper.
- **`.devin/skills/apc-*` — first-class Devin command adapters** pointing at `.agents/workflows/apc-*.md`; namespaced as `/devin:apc-*` where same-named skills exist in multiple imported dirs.
- **Cross-platform plugin build CI** with selectors; plugin sources live under `plugins/` and the plugin build workflows moved to the apc-plugins repo.

### Fixed

- YAML frontmatter for APC skills (names/descriptions no longer broken or empty in host skill loaders).
- Hub tools check resolves the pluginval binary per OS instead of a single hardcoded path.
- **`build-and-install.ps1`: stale version in Windows File Properties after a `VERSION` bump (known issue `build-006`).** JUCE generates `<Name>_resources.rc` once and its build rule depends only on the icon, so the DLL/EXE kept the old version number. After configure, the script now compares the `.rc` with the `VERSION` in `Info.txt` and deletes the `.rc` only when they differ, so it is regenerated then and only then (no extra relink on ordinary builds).
- **`build-and-install.ps1` + `pluginval-integration.ps1`: plugins whose `PRODUCT_NAME` differs from the folder name.** The VST3 bundle and Standalone `.exe` are named after `PRODUCT_NAME` (`My Plugin.vst3` for `plugins/MyPlugin`), so the name-based lookup found nothing and pluginval, the install and the icon step were skipped. They are now found by location in the plugin's own `Release` output. pluginval gets the path quoted: `Start-Process` joins `-ArgumentList` without quoting, so a path with a space was split.
- **`state-management.ps1` + `lib/Get-ApcPaths.ps1`: read `status.json` and `apc.config.json` as UTF-8.** Windows PowerShell 5.1 decodes `Get-Content` without `-Encoding` as ANSI, so a file saved without a BOM (by an agent, a text editor, the `.sh` scripts, or `apc doctor --fix`) had its non-ASCII text (an em dash, a publisher name with an accent) garbled on the next read-modify-write.
- **`backup.ps1` and the ship skill: zips with forward-slash entry names.** `Compress-Archive` in Windows PowerShell 5.1 stores entry names with backslashes (`Windows\VST3\...`), which macOS and Linux unzip as flat files with backslashes in their names. New `scripts/lib/New-ReleaseZip.ps1` writes `/` separators with the .NET zip classes that ship with PowerShell 5.1 and 7 (nothing to install); the zip layout is unchanged.
- Known issue `build-006` (stale version resource) with resolution doc.

## [1.5.1] - 2026-09-14

### Fixed

- **`scripts/terminal-monitoring.ps1`: failed native commands were reported as success.** A PowerShell job "completes" even when `cmake`/`msbuild` exit non-zero, so `Invoke-MonitoredCommand` returned exit code 0 for broken builds. The wrapped command now throws on a non-zero `$LASTEXITCODE`. Native stderr (CMake warnings) is collected as text instead of surfacing from `Receive-Job` as a terminating `NativeCommandError` under `$ErrorActionPreference = "Stop"`.
- **`scripts/lib/Get-ApcPaths.ps1` + `build-and-install.ps1`: resolve a *working* cmake.** New `Resolve-ApcCMakeExe` / `Initialize-ApcCMakePath` / `Test-ApcCMakeExe` check PATH, then vswhere, then the VS 2022 and standalone install locations, and verify each candidate with `cmake --version`. A stale pip/py `cmake` shim on PATH (exits 1, prints nothing) no longer breaks the build; `system-check.ps1` shares the same resolver.
- **`scripts/pluginval-integration.ps1`: `--strict` is not a pluginval flag.** Strictness is passed as `--strictness-level <1..10>` (default 5, `-Strict` = 10) with a 120 s per-test timeout. The binary is resolved from `_tools/pluginval-bin/`, the source submodule, a submodule build, or PATH instead of one hardcoded path.
- **`scripts/state-management.{ps1,sh}`: accept the `*_complete` phase labels.** `agent.md`, the phase gates and every `status.json` use `ideation_complete` / `plan_complete` / ... but the schema only listed the bare names, so `Update-PluginState` rejected them and `Test-PluginState` could not order them.
- **`scripts/validate-webview-setup.ps1`: don't require `js/index.js` for an inline UI.** Per webview-008 the preferred layout is a single `index.html` with the JUCE frontend library inlined; external `js/` files are only required when `index.html` actually references a `<script src>`.
- `scripts/system-check.ps1`: Python probe no longer errors when neither `py` nor `python` is installed; new `webview2_sdk` check reports whether the Microsoft.Web.WebView2 NuGet package JUCE's `FindWebView2.cmake` needs is present (with the install command as a hint).
- **`build-and-install.ps1`: stale version in Windows File Properties after a `VERSION` bump (known issue `build-006`).** JUCE generates `<Name>_resources.rc` once and its build rule depends only on the icon, so the DLL/EXE kept the old version number. After configure, the script now compares the `.rc` with the `VERSION` in `Info.txt` and deletes the `.rc` only when they differ, so it is regenerated then and only then (no extra relink on ordinary builds).
- **`build-and-install.ps1` + `pluginval-integration.ps1`: plugins whose `PRODUCT_NAME` differs from the folder name.** The VST3 bundle and Standalone `.exe` are named after `PRODUCT_NAME` (`My Plugin.vst3` for `plugins/MyPlugin`), so the name-based lookup found nothing and pluginval, the install and the icon step were skipped. They are now found by location in the plugin's own `Release` output. pluginval gets the path quoted: `Start-Process` joins `-ArgumentList` without quoting, so a path with a space was split.
- **`state-management.ps1` + `lib/Get-ApcPaths.ps1`: read `status.json` and `apc.config.json` as UTF-8.** Windows PowerShell 5.1 decodes `Get-Content` without `-Encoding` as ANSI, so a file saved without a BOM (by an agent, a text editor, the `.sh` scripts, or `apc doctor --fix`) had its non-ASCII text (an em dash, a publisher name with an accent) garbled on the next read-modify-write.
- **`backup.ps1` and the ship skill: zips with forward-slash entry names.** `Compress-Archive` in Windows PowerShell 5.1 stores entry names with backslashes (`Windows\VST3\...`), which macOS and Linux unzip as flat files with backslashes in their names. New `scripts/lib/New-ReleaseZip.ps1` writes `/` separators with the .NET zip classes that ship with PowerShell 5.1 and 7 (nothing to install); the zip layout is unchanged.

### Added

- **`build-and-install.ps1` caps compiler parallelism** at half the logical cores via `$env:_CL_=/MP<n>` (override with `APC_BUILD_JOBS`), and selects the 64-bit-hosted compiler (`$env:PreferredToolArchitecture=x64`; the 32-bit-hosted `cl.exe` stops at about 4 GB). JUCE's recommended flags add `/MP` + `/GL`, and 16+ concurrent LTO compiles of the JUCE unity files exhaust RAM with `C1060: compiler is out of heap space`. `_CL_`, not `CL`: `cl.exe` reads `CL` before its command line, where JUCE's own `/MP` comes later and wins, so the first version of this cap had no effect.
- Known issue `build-004` (C1060 out of heap space) with resolution doc.

## [1.5.0] - 2026-09-13

### Added

- **APC Hub — live local dashboard (`/apc-hub`).** Vanilla, zero-dependency web command center served by `hub/server.js` (Node stdlib, loopback, read-only `/api/v1/*` plus a validated Settings save and design previews): projects, skills, commands, designs, scripts, templates, tools, settings, documentation center with chapters/search/bookmarks, GitHub update check, and consistency radar. Approved design language in `hub/_design/` (APC RASTER: rectangles only, ASCII-first, dark default, amber/phosphor signals).

- **`bin/apc.js` — single cross-platform CLI** (Idea 1, phase 1+2; `node bin/apc.js …`, also exposed as the `apc` npm bin). Zero deps, Node 18+. Commands: `version [--json]`, `version sync [--fix]`, `paths [--json] [--plugin N]`, `doctor [--fix]`, `build <Plugin> [--no-install] [--skip-tests] [--strict]`, `validate <webview|webview-order|visage|plugin|state> [--plugin N] [--json]`, `backup` / `rollback`. `version`/`paths` and 4 of 5 validators (`webview`, `webview-order`, `visage`, `plugin`) run natively in Node — same checks as the `.ps1` originals (PowerShell `-match` is case-insensitive, so all ported patterns use `/i`), with `--json` machine output for agents. `validate state` stays shell-bound: it functionally tests the PowerShell state-management module itself and can only migrate with it.
- **`doctor --fix`**: safe mechanical auto-fixes only (create `apc.config.json` from example, create missing plugins/build/release dirs, init missing JUCE submodule). Toolchain installs are never run unsupervised — exact per-OS install commands are printed instead.
- **Post-ship iteration (Idea 13): `/apc-patch` + `/apc-evolve` (generations model).** A shipped generation is read-only; new work opens a generation first. `apc patch` (bugfix: patch-digit bump, phase → `code`, design flags kept) and `apc evolve` (feature: minor bump, phase → `plan`, `.ideas/{version}-brief.md` stub, optional codename) verify shipped state, backfill the frozen prior-generation record on first use (zero migration), snapshot `status.json`, and bump the version. `apc freeze` (called by the ship flow) records tag + timestamp and returns the machine to rest; `apc status [--json]` renders the generation timeline with a frozen flag. Closed states redirect instead of dead-ending: `/apc-resume` suggests patch/evolve on shipped plugins, `/apc-impl` blocks on frozen generations with a redirect, and `agent.md` carries the one-sentence rule. Workflows `apc-patch.md` / `apc-evolve.md` added with host mirrors (`.claude`, `.kilocode`, `.agent`, `.opencode`) and Codex `patch`/`evolve` actions.
- **`npm test` — 15-test suite** (`test/apc.test.js`, `node:test`, zero deps): version/paths/validators/version-sync/arg-translation against isolated temp fixtures via `APC_ROOT`. All green on Windows; `.ps1`-dispatch test runs on Windows, native checks everywhere.
- **Framework versioning, single source of truth: `package.json` (`1.4.0`).** `apc version` / `apc --version`, version header in `apc doctor`, README version badge (shields `github/package-json/v`, tracks `package.json` on main — no manual updates), and generated `hub/version.js` (`window.APC_VERSION`, for the Hub web UI over `file://`). Bump rule: change `package.json`, then run `node bin/apc.js version sync` (regenerates `hub/version.js`, verifies the CMake pin).
- HOL Plugin Scanner GitHub Action, `SECURITY.md`, and Dependabot for the awesome-ai-plugins listing requirements.

### Changed

- **Root `CMakeLists.txt` reads the framework version from `package.json`** at configure time (`APC_VERSION`, reported as `APC version: X (from package.json)`). Fixes drift where CMake said `1.0.0` while `package.json` said `1.4.0`.
- **`bin/setup.js` banner reads the version from `package.json`** instead of a hardcoded string.
- `AGENTS.md` build rule prefers `node bin/apc.js build <Name>`; `docs/command-reference.md` documents the CLI surface (`validate` native kinds + `--json`, `doctor --fix`, `npm test`).
- `docs/PROJECT_STRUCTURE.md` documents `hub/` (Hub dashboard → control app), `hub/version.js`, and `test/`.
- `docs/PROJECT_STRUCTURE.md` documents `hub/` (Hub dashboard → control app) and `hub/version.js`.
- **Docs-as-truth pass (12 files):** platform tables now show local build ✅ on Windows/macOS/Linux (`FAQ`, `docs/README`, lifecycle); `CONTRIBUTING.md` updated to JUCE 9 + current Visage status + docs-drift checklist; all command refs use primary `/apc-*` names; `.agent/` → `.agents/` paths fixed; `build-system.md` CMake example uses `APC_PLUGINS_DIR` + correct Linux EGL deps; `webview-framework.md` rewritten for the JUCE 9 interop path (`@juce-framework/webview`, inline bundle) instead of the deleted JUCE 8 `native/javascript` path.

### Fixed

- `webview-framework.md` attachment-order guidance: attachments must be created **BEFORE** `addAndMakeVisible()` (the old text described the webview-004 crash recipe).
- `CMakeLists.txt` project version `1.0.0` → dynamic from `package.json` (`1.4.0`).
- `bin/apc.js` config reader strips UTF-8 BOM (`apc.config.json` is PowerShell-written and may carry one).
- Root `CMakeLists.txt` config reader uses `utf-8-sig`: a BOM-carrying `apc.config.json` previously failed silently (`ERROR_QUIET`) and fell back to `./plugins`, ignoring a custom `paths.plugins_dir`.
- Legacy skill tidy-up: the 6 `skill_*` alias stubs stay as permanent redirects (verified content-free — each is a 2-line pointer), and all internal references now resolve to canonical skills. Dropped the redundant alias mirror dirs from `.kilocode/skills/` + `.agent/skills/` (matching `.claude/`), repointed `apc-ship.md` (7 refs), `apc-debug.md`, the `agent.md` phase table, both guides, `plan` skill routing, and the canonical `debug`/`design` frontmatter names. Hub no longer flags them: `aliasStub` detection with `[ALIAS]` display, consistency check `ok` (verified against the live server).

### Changed

- **Ship output is `release/`** (`paths.release_dir`), not `dist/`. Installer scripts, Inno Setup, GitHub Actions artifact collection, skills, and docs now honor the configured release directory. Existing `dist/` leftovers are gitignored.
- Known-issue "automated fix" snippets are printed for review instead of being executed.
- **Custom `paths.plugins_dir` / `build_dir` / `release_dir` are honored end-to-end.** Utility scripts, APC workflows/skills (`.claude` / `.agent` / `.kilocode`), and guides resolve plugins via `Get-ApcPluginPath` / `apc_plugin_path` instead of hardcoded `plugins/`. Relative sibling layouts (e.g. `../apc_plugins`) work without a `./plugins` junction. `/apc-setup` documents junction as optional.

### Fixed

- Backup, rollback, preview-design, WebView/Visage validators, pluginval status updates, and related helpers no longer assume the default in-repo `plugins/` folder when config overrides paths.

### Removed

- `notes/PLAN1-macos.md` and `notes/PLAN1-results.md` (obsolete macOS port planning; behavior lives in `scripts/*.sh` and agent rules).

---

## [1.4.0] - 2026-08-14

### Added

- **`/apc-setup`** guided first-run wizard (toolchain, relocatable paths, UI defaults, per-phase model preferences)
- **`apc.config.example.json`** + path helpers (`scripts/lib/Get-ApcPaths.ps1`, `scripts/lib/apc-paths.sh`)
- Relocatable **`plugins` / `build` / `release`** directories via config and CMake `APC_PLUGINS_DIR`
- Primary **`/apc-*` slash commands** (`/apc-dream`, `/apc-plan`, `/apc-design`, `/apc-impl`, …) with deprecated short aliases
- **`docs/model-routing.md`** for global per-phase AI model preferences
- Expanded **system-check** (Git, Node, WebView2, JUCE major ≥ 9, Linux EGL/WebKit notes)

### Changed

- **JUCE submodule upgraded to 9.0.1**
- WebView templates/docs updated for `native/typescript/webview-interop` and `@juce-framework/webview`
- Build scripts honor `apc.config.json` paths
- README rewritten for setup-first workflow and `/apc-*` commands
- Softened “development only” disclaimer; APC is ready for real plugin work while still evolving

### Fixed

- `system-check.ps1` CMake detection (multi-line `--version` no longer false-negative)

---

## [0.3.0] - 2026-03-23

### Added

- **macOS Support** (PR #6 by vjcharles)
  - `scripts/build-and-install.sh` — macOS build script (Xcode generator, matches PS1 feature parity)
  - `scripts/state-management.sh` — Bash port of the state management module
  - `scripts/error-detection.sh` — Bash port of the error detection and known-issues lookup
  - `scripts/backup.sh` / `scripts/rollback.sh` — Backup and rollback for macOS
  - `scripts/preview-design.sh` — Design preview script for macOS
  - `scripts/system-check.sh` — System dependency checker for macOS (Xcode, CMake, JUCE)
  - `scripts/installer/create-macos-installer.sh` — DMG installer creation script for macOS
  - `notes/PLAN1-macos.md` / `notes/PLAN1-results.md` — Contributor's porting notes

- **npx Installer** (`npx audio-plugin-coder@latest`)
  - One-command setup: clones the repo and guides through initial configuration
  - Platform-aware: detects Windows, macOS, and Linux and shows relevant next steps
  - Checks for required tools (Git, Node.js, VS Code, CMake, VS Build Tools / Xcode / GCC)
  - Zero dependencies — pure Node.js stdlib
  - Works direct from GitHub: `npx github:Noizefield/audio-plugin-coder`

- **Versioning**
  - Added `package.json` with semantic versioning
  - Git tags now used to mark releases (e.g., `v0.3.0`)

### Changed

- **Agent rules updated for cross-platform awareness** (PR #6)
  - `agent.md`: OS detection logic — uses PowerShell on Windows, Bash on macOS; never mixes shells
  - `juce-build-protocols.md`: Platform notes for macOS Xcode generator and macOS CI requirements
  - `file-naming-conventions.md`: Script extension guidance (`.ps1` on Windows, `.sh` on macOS)

### Security

- **Tightened Claude Code permissions** (PR #6, prompt injection audit by vjcharles)
  - Removed overly broad wildcards: `powershell:*`, `powershell -Command:*`, `python:*`
  - Added explicit deny list:
    - `curl`, `wget`, `Invoke-WebRequest` — blocks external network calls by agent
    - PowerShell expression-invocation aliases — blocks eval-style command execution
    - Piping to `bash` / `sh` — blocks shell injection
    - `~/.ssh`, `~/.aws` — blocks credential file access
    - `base64 -d` — blocks common exfiltration encoding
    - `python -c`, `python3 -c`, `node -e` — blocks inline code execution

---

## [0.2.0] - 2026-02-15

### Added

- **FFGL Bridge Template** (PR #2 by 12Matt3r)
  - FreeFrameGL 2.0 plugin template for VJ software (Resolume, VDMX, TouchDesigner)
  - JUCE 8 integration with parameter handling via `AudioProcessorValueTreeState`
  - OpenGL rendering with host-provided context
  - Thread-safe parameter caching for real-time performance
  - One-click setup scripts (`scripts/setup_bridges.ps1`, `scripts/setup_bridges.bat`)

- **Max/MSP External Template** (PR #2 by 12Matt3r)
  - Max/MSP external template using Cycling '74 Min-API
  - JUCE 8 DSP and UI integration
  - Double-precision audio processing support
  - Native window handle extraction for UI embedding
  - Floating window fallback for UI display

- **Consolidated Templates Folder**
  - All templates moved to single root `templates/` folder
  - `templates/visage/` — Visage (C++) UI templates
  - `templates/webview/` — WebView (HTML5) UI templates
  - `templates/ffgl/` — FFGL visual plugin templates
  - `templates/max-external/` — Max/MSP external templates
  - `templates/status-template.json` — Plugin state tracking template

- **Visage Integration**
  - `APC_ENABLE_VISAGE` CMake option and optional subdirectory wiring
  - `scripts/validate-visage-setup.ps1` validation script
  - Visage gnarly3 pilot UI (experimental): knob interaction, live filter graph
  - Windowless preview rendering path for stability

- **CloudWash Plugin** — granular texture processor (Mutable Instruments Clouds adaptation)
  - 4 processing modes: Granular, Pitch Shifter, Looping Delay, Spectral
  - WebView-based UI with real-time visualization
  - 13 parameters with JUCE backend integration
  - Noizefield branding with clickable logo (opens external browser)
  - 300+ line `USER_MANUAL.md`

- **Automatic Documentation System**
  - `Documentation/` folder auto-created per plugin; all files auto-included in installer
  - Start Menu shortcuts to User Manual and Documentation folder
  - New guide: `.claude/guides/documentation-system.md`

- **WebView External URL Support**
  - Plugins can open URLs in the system's default browser
  - Implemented via `window.__JUCE__.backend.emitEvent()` and `juce::URL::launchInDefaultBrowser()`

- **GitHub Actions CI/CD**
  - `.github/workflows/build-release.yml` — release builds for Windows, macOS, Linux
  - `.github/workflows/build-pr.yml` — PR validation with automatic plugin detection
  - Platform selection via workflow_dispatch
  - Automatic GitHub Release creation on git tags

- **CMake Cross-Platform Support**
  - Platform detection in root `CMakeLists.txt`
  - Windows: VST3 + Standalone, macOS: VST3 + AU + Standalone (Universal), Linux: VST3 + LV2 + Standalone
  - WebView2 (Windows), WKWebView (macOS), WebKitGTK (Linux)

- **Windows Installer**
  - Inno Setup template (`scripts/installer/installer-template.iss`)
  - PowerShell generator (`scripts/installer/create-windows-installer.ps1`)
  - EULA, component selection (VST3, Standalone, Presets, Docs), shortcuts, uninstaller

- **Troubleshooting Auto-Capture System**
  - Known issues database (`.claude/troubleshooting/known-issues.yaml`)
  - Auto-documents solutions after 3 failed attempts

- **State Management System**
  - `status.json` tracking for all plugins
  - Phase gating, validation, backup, and rollback

### Changed

- Design phase branches by framework: WebView → HTML preview; Visage → C++ scaffold (no HTML)
- Implementation phase routes templates by framework and runs Visage validation
- Build/preview scripts auto-enable `APC_ENABLE_VISAGE` when `ui_framework == visage`
- Agent folders (`.kilocode`, `.claude`, `.agent`) synchronized with consistent content
- Windows installer now 64-bit only (`ArchitecturesAllowed=x64compatible`)
- Documentation placed inside plugin bundle (keeps VST3 root clean)

### Fixed

- WebView UI integration and parameter binding for CloudWash
- Visage preview input routing (knobs receive mouse events)
- Desktop shortcuts now display correct plugin icon
- VST3 plugins install to 64-bit Program Files (not x86)
- Linux CI: added `NEEDS_WEB_BROWSER`, JACK deps, and C language requirement
- macOS CI: removed per-target `XCODE_ATTRIBUTE_ARCHS` (conflicts with global `CMAKE_OSX_ARCHITECTURES`)
- LV2/Standalone CI: wrapped builds with `xvfb-run` for headless display

---

## [0.1.0-beta] - 2026-01-31

### Added

- Initial public beta release
- Five-phase workflow system (Dream → Plan → Design → Implement → Ship)
- Dual UI framework support: Visage (pure C++) and WebView (HTML5/JS)
- JUCE 8 integration with CMake build system
- PowerShell automation scripts for Windows
- Agent-agnostic design: works with Claude Code, Antigravity, and Kilo
- Comprehensive skill system (ideation, architecture, design, DSP, packaging)
- Workflow orchestration with slash commands (`/dream`, `/plan`, `/design`, `/impl`, `/ship`)
- File naming conventions and project structure standards
- Windows 11 support with Visual Studio 2022

### Known Limitations at Release
- Visage UI framework scaffolding only (full implementation planned)
- macOS and Linux support pending
- VST2, Audio Unit (AU), and CLAP formats not supported

---

## Release Notes

### Version Numbering
- **Major.Minor.Patch** format following [Semantic Versioning](https://semver.org/)
- **Beta suffix** during pre-1.0 development (e.g., `0.1.0-beta`)
- Git tags mark each release (`v0.3.0`, `v0.2.0`, etc.)

### Support
For issues, feature requests, or questions:
- GitHub Issues: https://github.com/Noizefield/audio-plugin-coder/issues
- Discussions: https://github.com/Noizefield/audio-plugin-coder/discussions

---

**Built with love for the audio development community**
