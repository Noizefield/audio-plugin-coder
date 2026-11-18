# UI kit panels (kit-B): settings, presets, license, update, mock backend

Part B of the WebView UI kit in `templates/webview/apc-ui/`. Binding contract: `templates/webview/apc-ui/CONTRACT.md`
(bridge function names win over anything here). Controls, context panel, help and chrome are part A
(`ui-kit-controls.md`). Standards: `.agents/rules/product-standards.md` (U-05, U-10, U-13, U-16, X-08, X-09, P-15, L-xx).

| File | Role |
|---|---|
| `apc-mock.js` | in-memory fake backend; `APC.mock`, and `APC.bridge = APC.bridge \|\| APC.mock` when there is no native bridge |
| `apc-settings.js` | settings overlay (tabs Global, Engine / Quality, MIDI, Presets & Data, License, About) |
| `apc-presets.js` | preset browser `[data-apc="presets"]` + header chip `[data-apc="preset-chip"]` |
| `apc-license-ui.js` | activation dialog / inline license status `[data-apc="license"]` |
| `apc-update-ui.js` | update dialog / inline panel `[data-apc="update"]` |
| `apc-components.css` | one `/* ==== kit-B ==== */` block at the end, token-only |
| `tests/kit-b-*.html`, `tests/harness-b.js` | DOM self-tests, run by `apc kit test` |

All files are classic ES5-style scripts (no modules, no network, no `?.`/`??`, no arrow functions) that only extend `window.APC`.
Load order: `apc-fit.js`, `apc-kit.js`, `apc-bridge.js` (native side), `apc-mock.js` (fallback), then the components.
Every component works with the mock alone and with the real native bridge alone; neither file may depend on the other.

## Markup and options

```html
<button data-apc="settings" aria-label="Settings">&#9881;</button>      <!-- opens the overlay on click / Enter -->
<div data-apc="preset-chip"></div>                                      <!-- compact header chip: prev, name*, next, Save -->
<div data-apc="presets" style="width:46rem;height:24rem"></div>         <!-- full browser; needs a definite height -->
<div data-apc="license"></div>                                          <!-- inline license status + dialog body -->
<div data-apc="update"></div>                                           <!-- inline update panel -->
```

| Component | `data-*` options | Notes |
|---|---|---|
| `settings` | - | Overlay, not an OS dialog. `APC.emit("settings:open", {tab:"midi"})` or `APC.settingsUI.open({tab})`. Esc closes, focus is trapped and restored |
| `presets` | `data-categories="pad,bass"` (show only these), `data-hide-categories="bass"` | A flat-hierarchy plugin (`features.presetHierarchy:"flat"`) hides kind scopes and the Kind filter automatically. Instance on the node: `node.__apcPresets` (`ready`, `refresh()`, `state()`, `setScope/Sort/Search`) |
| `preset-chip` | same as `presets` | The name button opens the browser as a modal sheet |
| `license` | `data-drop-target="document"` | Renders nothing at all when `license.mode` is `none` |
| `update` | - | Follows the update state machine below |

Events on the kit bus (`APC.emit` / `APC.on`): `settings:open {tab?}`, `license:open {verb?, lead?}` (the footer badge and any
gated verb emit this), `update:open`, and outbound `settings:changed {settings}`, `presets:changed {reason, id}`,
`presets:rescanned {count, builtAt}`. Programmatic API: `APC.settingsUI`, `APC.licenseUI`, `APC.updateUI`, `APC.presetsUI`
(`quickSave()`, `saveAs()`, `load(id,name)`).

Header wiring (kit-A chrome provides the buttons): gear -> `data-apc="settings"`; footer badge click -> `APC.emit("license:open")`;
footer `^ update available` -> `APC.emit("update:open")`; Save slot -> `<div data-apc="preset-chip">`.

## Rules the components implement (do not re-implement them natively)

- **Visible controls, shortcuts only accelerate** (X-09): Save, Save As..., Revert, Init, A/B toggle, Copy A->B, Import, Export are
  buttons; Ctrl/Cmd+S is an accelerator (Shift = Save As) and is removed on `dispose()`.
- **Never fail silently**: every `{error}` result (or rejected promise) becomes `APC.emit("error", {message, ...})`, which the
  core turns into a toast. I/O messages carry the failing path (`message` already contains it; `path` is appended otherwise).
  The only errors that are not toasts are `gated` (opens the activation sheet) and user-input errors shown inline (bad serial).
- **Gated verbs**: a result `{error:"gated", verb:"PresetSave"|"PackExport"|"PackInstall"}` opens the activation sheet via
  `license:open`. If `apc-license-ui.js` is not loaded a warning toast is shown instead.
- **Preset load**: `Confirm if dirty` (default) shows a confirm sheet when `apc.presets.state().current.dirty`; `Instant` does not.
  The dirty `*` is rendered next to the name; Revert is disabled while clean.
- **Read-only presets** (factory packs, INIT): Save opens Save As (copy-on-write, P-07).
- **Settings**: changes are written immediately with a minimal patch; a failed write shows an inline error plus a toast and the
  control snaps back. Most values apply on the next window open; the scale is also applied live via `apc.ui.setScale`.
  Per-tab "Restore defaults" always asks first.
- **Engine / Quality (X-08)**: edits go to `apc.engine.set` (this instance, saved in the DAW chunk). "Set as default for new
  instances" is the only thing that writes `settings.engine` (the machine default). The tab says so explicitly.
- **License**: badge text `DEMO`, `TRIAL n d`, `LICENSED to <name>`, `UNVERIFIED` with a plain-language explanation and the
  way forward. Never blocks audio or the plugin (the sheet always has Later/Esc). Modes: `none` renders nothing; `signed-file`
  shows only Load License File / paste; `online-activation` shows serial + e-mail + Activate, Load File (also drag and drop of a
  `.lic`), offline method B (request code -> copy -> paste the response back) and Deactivate This Machine.
- **Update** (`updater.md`): Idle -> Checking -> UpToDate | UpdateAvailable (notes, Download) -> Downloading (progressbar,
  Cancel) -> Verifying -> **ReadyToInstall** ("Close your DAW, then run this installer." + path + Reveal installer) | Failed
  (visible error + Try again). The UI never claims it installs by itself and never downloads without a click.
- **Links** (About): only configured `info.links.*` are rendered; a click calls `apc.openUrl`, the page never navigates.

## What the native side must return

Shapes are the contract's, plus the additive ones marked **(+)**. Errors are either a rejected promise or a resolved
`{error:"<code>", message:"<plain language>", path?:"<failing path>"}`; both are handled identically.

| Function | Needed shape / behavior |
|---|---|
| `apc.info` | `product, manufacturer, version, buildDate, links{company,product,docs,support,update,account(+)}, features{themeEnabled, midiLearnTable, autoUpdateCheck, licenseMode, presetHierarchy:"typed"\|"flat", ...}`; **(+)** `juceVersion, frameworkVersion, legal{openSource, eula}` (strings; the About tab hides what is missing); `standards` as flat registry ids (`"ux.double_click":"reset"`) used as "restore defaults" targets |
| `apc.settings.get/set` | the `apc-settings/1.0` document; `set {patch}` deep-merges objects, replaces arrays, keeps unknown keys, returns the merged document; an invalid enum value returns `{error:"invalid"}`; a failed write returns `{error:"io", path}` |
| `apc.engine.get` | `{values:{oversampling:2,...}, defaults:{...}, fields:[{key,label,type:"enum"\|"int"\|"bool", values?, min?, max?, suffix?, default}], scope:"chunk"\|"machine", latencySamples}` - **(+)** `fields/defaults/scope/latencySamples` drive the Engine tab; a bare `{oversampling, max_voices}` still works. The tab is hidden when there are no fields |
| `apc.engine.set {patch}` | changes only this instance; same shape as `get`. Must never touch `settings.engine` |
| `apc.midi.table.get` | `{rows:[{id,name,unit,cc:number\|null,min,max,pmin,pmax}]}`; `table.set {rows:[{id,cc,min,max}]}` validates `cc` 0..127; `midi.learn {id}` -> `{id,cc}` |
| `apc.presets.list {scope,filters,search,sort}` | `{items,total,totalAll}`; items `{id,kind,name,pack,meta,rating,favorite,mtime, uses?, lastLoaded?, readOnly?, missing?:[names]}`. **The native side does the filtering and sorting** (below) |
| `apc.presets.state` | `{current:{id,name,dirty,readOnly,kind?,pack?,missing?:[]}, ab:{active,hasB}, loadBehavior}` |
| `apc.presets.save {}` | quick save (overwrite the loaded file). `{name,pack,kind,meta,replace?}` = Save As; a name clash returns `{error:"exists"}` unless `replace:true`; read-only quick save returns `{error:"readonly"}` |
| `apc.presets.import {path}` / `{name,data,encoding:"base64"}` | never overwrites (pack `Name 2`); returns `{imported, pack}`. `exportPack {ids}` returns `{count, path}` |
| `apc.presets.info` **(+)** | `{root, assets, builtAt, devRoot:string\|null, packs:[{name,readOnly,count}], writablePacks:["User","_wip"]}` for Presets & Data and Save As |
| `apc.presets.restoreFactory` **(+)** | re-creates the factory layout in this user's folder (P-14); `{ok, restored}` |
| `apc.license.status` | `{state, mode, name?, daysLeft?, seats?, message?}`; `message` is the short banner text, shown as supplied under the UI's own explanation |
| `apc.license.activate/loadFile/offlineRequest/deactivate` | `activate` -> `{ok, status}` or `{error: missing_serial\|invalid_serial\|invalid_email\|seat_limit\|network\|unsupported, message}`; `loadFile {text}` verifies BEFORE replacing anything (a bad file never replaces a good license); `offlineRequest` -> `{requestCode}` |
| `apc.update.state/check/download/revealInstaller` | state `{state, current, latest?, notes?, error?, message?, progress 0..1, installerPath?}` |
| `apc.update.cancel` **(+)** | back to `UpdateAvailable`; optional, the Cancel button reports the error if it is missing |
| events | `preset {state}`, `license {status}`, `update {state}`, `param {id,value}`, `meter`, `error`. Bare payloads (without the wrapper key) are also accepted by the UI |

### List semantics (tagging-filtering.md section 7) - implement exactly, or copy `apc-mock.js`

- `scope`: `"all"`, a kind (`"patch"|"sound"|"kit"|"sequence"`) or `"pack:<Name>"`.
- `filters`: `kind, pack, category, mood, genre, tag` (arrays of slugs), `axes: {bri:{op:"gte"|"lte"|"eq", word}}`,
  `favorite: true`, `minRating: n`. **OR within a group, AND across groups.** An item that lacks the attribute (no category,
  no moods, an untagged axis) fails every non-ANY filter on it: untagged items only pass groups left at ANY. Axis filters are
  thresholds on the ORDERED word list from `pmx1-vocabulary.json`.
- `search`: case-insensitive substring over `name + subcategory + desc + category + author + tags + moods`, query capped at 64 chars.
- `sort`: `name` (A-Z, case-insensitive), `type` (category, then name; uncategorised last), `rating` (stars desc, then name),
  `recent` (last loaded desc), `bpm` (ascending, no tempo last), `uses` (desc). Always TRUE sorting, factory items included.
- Dirty: any parameter write after load sets `current.dirty`; setting the stored value back clears it; save/revert/init/load clear it.
- A/B: first toggle copies the current state to the other slot; Copy A->B / B->A overwrites; each slot keeps its own dirty state.

## The mock (`apc-mock.js`)

~12 parameters (help, units, choices, modulation routes, one MIDI-learned CC), 30 presets in 3 packs (Factory and Expansion One
read-only, User writable) with PMX/1 slugs, a missing-asset patch (`Broken Link`), untagged items, a typed tree and a flat switch.
It implements every function and event of CONTRACT.md plus the **(+)** ones. Deterministic: same seed, same data.

```js
APC.mock.scenario("licensed");     // demo | trial | licensed | unverified | update-available | update-failed | io-error
APC.mock.config({ tickMs: 5 });    // virtual "network" delay of the update machine (default 150 ms)
APC.mock.config({ hierarchy: "flat", licenseMode: "signed-file", offline: true, checkFails: true, devRoot: "/repo/presets",
                  features: { midiLearnTable: false }, links: { docs: "" } });   // seed/hierarchy changes rebuild the world
APC.mock.loadBank(5000);           // adds generated presets (pack "Bulk") for list-performance tests
APC.mock.newInstance();            // new plugin instance: engine starts from the machine default (X-08)
APC.mock.calls("apc.settings.set"); APC.mock.clearCalls();   // recorded bridge calls (args included)
APC.mock.on("update", fn); APC.mock.emit(...); APC.mock.meter(id, v); APC.mock.emitError(msg);
```

Fake serials: `TEST-0000-...` activates (name = e-mail local part), `FULL-...` -> `seat_limit`, anything else -> `invalid_serial`;
a pasted license JSON `{"schema":"apc-license/1.0","customer_name":..,"signature_ed25519":"TEST..."}` loads, `"TAMPERED"` is rejected.
Scenario meaning: `update-failed` fails the first download at 40 % and succeeds on retry; `io-error` makes every persisting call return
`{error:"io", path:"/mock/AppData/..."}`; `trial` has 27 days left.

## Testing

```bash
node bin/apc.js kit test [--json] [--only kit-b] [--browser <path>] [--budget <ms>]   # exit 0 pass or SKIPPED, 1 failures, 2 usage
node --test test/kit-runner.test.js test/kit-b.test.js
```

The runner opens each `tests/*.html` with `<browser> --headless=new --disable-gpu --virtual-time-budget=N --dump-dom` and reads
`<pre id="apc-test-result">{pass,fail,failures}</pre>`. Without Edge/Chrome/Chromium it prints `SKIPPED` (JSON `skipped:true`) and exits 0;
that is explicitly **not** a pass. A page with no result element counts as a failure.

Virtual time makes timers instant but synchronous work is measured in real time, so the "5 000 presets render in < 250 ms"
assertion is genuine. A new test page loads `../apc-fit.js ../apc-kit.js ../apc-mock.js` + its components + `harness-b.js`, uses
`T.test(name, fn)` / `T.reset(scenario)` / `T.mount(html)` / `T.wait(fn)` and ends with `T.run()`; do not depend on kit-A files.

## Design conformance (one design, no OS look)

Every element and overlay of the kit must come out as APC Minimal (flat, square, tokens only), including the **native form controls**
inside the overlays (settings, preset browser and its dialogs, licence / update, context panel). `apc-components.css` starts with a
zero-specificity "design conformance" block that restyles them: `appearance:none` for buttons, text fields, checkboxes, radios,
range sliders; `menulist-button` for `<select>` (OS caret in `--ink`, options `--inset`/`--ink`); `textfield` for number inputs (no spin
buttons); a token cross for the search clear button; no textarea resize grip; `<summary>` markers as `▸/▾` glyphs; one flat arrowless
scrollbar (`::-webkit-scrollbar`, Firefox: `scrollbar-color`); `accent-color`, `::selection`, `::placeholder`, square list bullets and the
focus ring come from tokens. A new overlay that uses plain `<input>`, `<select>`, `<textarea>`, `<details>` or a scroll box needs no extra CSS;
a bare `<input type="range">` is flat too, and wrapped in `<span class="apc-range">` with an `.apc-range__fill` (see `apc-context.js`) it also
shows the fill. Do not use `title="..."` expecting an OS tooltip: `apc-help.js` shows it in the kit tooltip while hovered.

**Guard:** `tests/kit-conformance.html` (run by `apc kit test`) opens every overlay in night and day and checks every visible element
(+ `::before` / `::after`) against one table of checks (`CHECKS`): form-control appearance, token font, text floor (also at rem = 8 px),
radius / shadow / gradient / filter, colour = a colour token of the current mode, UA scrollbar, placeholder, slider parts, summary
marker, textarea grip, option colours, `title`, focus ring. It is generic (walks the DOM), so a new element is covered automatically; add a
scene to `SCENES` only if it needs an action to become visible. Deliberate exceptions live in two short allow-lists with a reason
(`ALLOW_RADIUS`: the round knob dial, `ALLOW_GRADIENT`: the modulation-source dash swatches and the gripper hatch).
`kit-conformance.html?report=1` lists every violation; `?scene=<name>&theme=day` leaves one scene open for a screenshot.

## Do not

- Do not call `fetch`, `XMLHttpRequest`, `WebSocket`, or open a URL other than through `apc.openUrl`.
- Do not invent preset vocabulary values; the browser's lists are the frozen PMX/1 slugs (`test/kit-b.test.js` compares them with the schema).
- Do not hardcode colors in components or CSS: use the theme tokens (`var(--accent)`), fallbacks only as `var(--x, fallback)`.
- Do not gate in the UI: `{error:"gated"}` must come from the native I/O layer (L-02); the UI only reflects it.
