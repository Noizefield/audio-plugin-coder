# APC UI Kit - binding contract (v1)

Themeable building blocks every WebView plugin gets. The kit ships **ONE design: APC Minimal**
(`design_library/apc-minimal/`): flat, square, 1 px `--rule` hairlines, one signal colour (`--accent`), mono
UPPERCASE labels, sentences in the system sans, no gradient / shadow / glow / bevel. All colour, type and shape
come from CSS custom properties (tokens): `design_library/apc-minimal/tokens.css` is canonical, `apc-core.css`
`:root` (+ its `[data-theme="day"]` block) carries the identical defaults, so the kit looks like APC Minimal even
when no design stylesheet is loaded. A product restyles itself by overriding token **values** (never by editing
component CSS, never by renaming a token); to make a different design copy the folder.
**Every element of the kit is specified by those tokens in `design_library/apc-minimal/design-system.json`
`elements`** (parts, states, sizes, options, accessibility per `data-apc` name), which is what the Hub KIT / Design
pages render. Standards: `.agents/rules/product-standards.md` (decisions U-01..U-16, X-08, X-09, P-15, L-xx).
Layout rules: `.agents/rules/ui-layout-system.md`.

## Hard rules

1. **Classic scripts only.** No ES modules, no bundlers, no `import`, no external network, no CDN, no frameworks (known issue webview-008). ES5-safe syntax (no optional chaining / `??`), `"use strict"` IIFEs.
2. **One global:** `window.APC` (already created by `apc-fit.js`; every file does `var APC = (window.APC = window.APC || {});`). Never replace it.
3. **Every component is a pure function of DOM + bridge.** No hidden globals, no timers that outlive `dispose()`. Every `init` returns `{ dispose() }`.
4. **No function is gesture-only** (a11y): everything reachable by keyboard and by a visible button (X-09). Focus ring visible. `aria-*` names on every interactive element. `prefers-reduced-motion` honoured.
5. **Never fail silently** (stone rule 1): any bridge error is shown via `APC.toast.error(msg)` (visible, dismissible) and `APC.emit("error", {...})`.
6. **No telemetry/network.** The kit never calls `fetch`/`XMLHttpRequest`/`WebSocket`. Links open only through `APC.bridge.call("apc.openUrl", {url})` on a user click; native allow-lists the configured branding URLs.
7. Units shown to users are real-world (Hz, dB, ms); values passed over the bridge are real-world too, never 0..1, except where a parameter descriptor says `"normalized": true`.
8. **Token-only look, one design.** Components read colour / type / shape / size from tokens (`--plate`, `--ink`, `--accent`, `--accent-text`, `--rule`, `--r-control`, `--font-ui`, `--ctl-h`, ...) and from nothing else; no hard-coded colours, no gradient, shadow, glow or bevel (the dash patterns of modulation swatches are the one documented exception: a colour-blind aid). Accent-coloured **text** uses `--accent-text`, never `--accent` (day `--accent` is a graphic colour, not 4.5:1 on `--plate-2` / `--inset`). Widget and viz selectors sit inside `:where()` (specificity 0) so a design always wins. `node scripts/design-tokens-check.js` and `test/design-tokens.test.js` fail on token drift, a missing element spec or an unknown token in the spec.
9. **Canvas elements re-read the theme.** Anything drawn on a canvas (`graph`, `envelope`, `spectrum`, `waveform`, `scope`, `meter`, `xypad`, `picture` overlay) reads its tokens with `getComputedStyle` **at draw time** and redraws when `data-theme` changes on `<html>` or any ancestor, when `APC` emits `theme:changed`, on resize / rem-scale change and on `APC.viz.refreshTheme()`. A canvas element must never cache colours across a theme change.

## Files and ownership

| File | Owner | Role |
|---|---|---|
| `apc-kit.js` | core (exists) | `APC.on/off/emit`, `APC.dom.el`, `APC.register/mount`, `APC.toast`, `APC.format`, `APC.store` |
| `apc-bridge.js` | native-bridge agent | `APC.bridge.call(name,args)` / `.on(evt,fn)`; talks to JUCE 9 native functions + events; falls back to `APC.mock` when no native |
| `apc-mock.js` | kit-B agent | in-memory fake backend implementing every bridge function below (used by Hub gallery, tests, `apc screenshot`) |
| `apc-controls.js` | kit-A agent | `knob`, `slider`, `selector`, `toggle`: gestures U-01/U-02/U-15, value entry, wheel rule, modulation ring, drag begin/end gestures |
| `apc-context.js` | kit-A agent | right-click context panel: VALUE -> MODULATION -> MIDI -> HELP (U-03) |
| `apc-help.js` | kit-A agent | tooltip, info bar, F1/`?` help mode + **visible Help button** (U-09, X-09) |
| `apc-chrome.js` | kit-A agent | header lockup (logo/name links), **version footer** (U-16) with demo/trial badge + update note, corner gripper + scale steps (U-08), day/night theme (U-07) |
| `apc-settings.js` | kit-B agent | overlay tabs Global · Engine/Quality · MIDI · Presets & Data · License · About (U-05) |
| `apc-presets.js` | kit-B agent | preset browser (scope/filters/search/sort/ratings/favorites), dirty `*`, revert, A/B, Save/Save As with **visible Save button** (U-10, U-13, P-xx) |
| `apc-license-ui.js`, `apc-update-ui.js` | kit-B agent | activation dialog (serial / load file / deactivate), update check/download/`ReadyToInstall` dialog |
| `apc-widgets.js` | widgets agent | `button`, `buttons`, `segmented`, `checkbox`, `radio`, `dropdown`, `menu`, `tabs`, `textfield`, `numberfield`, `label`, `readout`, `panel`, `divider`, `led`, `progress`, `list`, `logo`; the `APC.widgets` API. **Needs `apc-controls.js` loaded before it** (parameter binding and the `numberfield` reuse `APC.controls.Model`) |
| `apc-widgets.css` | widgets agent | styles of the widgets (all selectors in `:where()`), plus a `[data-theme="day"]` mirror of the tokens.css day block |
| `apc-viz.js` | viz agent | `graph`, `envelope`, `spectrum`, `waveform`, `scope`, `meter`, `stepseq`, `xypad`, `picture`; the `APC.viz` API. Needs only kit + bridge (no controls dependency) |
| `apc-viz.css` | viz agent | DOM parts of the viz elements (nodes, tooltip, steps, thumb, clip lamp, error block); the canvases themselves read the tokens at draw time |
| `apc-mock-viz.js` | viz agent | **mock only, never ships**: animated demo data for the viz elements (`APC.mockViz`). Like `apc-mock.js` it is vendored into `Design/apc-ui/` for previews and used by the Hub / tests, but excluded from the plugin bundle (`templates/webview/CMakeLists.txt.template` filters every `apc-mock*.js`) |
| `apc-components.css` | kit-A (shared sections marked) | styles for the controls (re-skinned flat in APC Minimal), context panel, help, chrome and the kit-B panels, token-only |
| `native/` C++ glue | native-bridge agent | see below |

**Load order** (classic scripts): `apc-fit.js`, `apc-kit.js`, `apc-bridge.js`, [`apc-mock.js` preview only], `apc-controls.js`, `apc-widgets.js` (after controls), `apc-context.js`, `apc-help.js`, `apc-chrome.js`, `apc-settings.js`, `apc-presets.js`, `apc-license-ui.js`, `apc-update-ui.js`, `apc-viz.js`, [`apc-mock-viz.js` preview only], then `APC.mount(document)`. The plugin build bundle (CMake) orders fit, kit, bridge first and the rest alphabetically, which satisfies every dependency above. **CSS** order: `apc-core.css`, `apc-components.css`, `apc-widgets.css` (if widgets are used), `apc-viz.css` (if viz elements are used), then the design stylesheet (`tokens.css` or your own) **after** the kit.

Every `*.js` / `*.css` of this folder is either vendored into `Design/apc-ui/` (all of them; `CONTRACT.md` and `tests/` are not) or deliberately excluded from the plugin bundle (`apc-mock*.js` only); `test/hub-kit.test.js` enforces that.

## Component API

```js
APC.register("knob", function init(el, opts, ctx) { ...; return { dispose: function(){} }; });
APC.mount(rootEl);          // finds [data-apc="knob"] etc., calls init with parsed data-* options
// declarative markup:
// <div data-apc="knob" data-param="cutoff_hz"></div>
```
Common option: `data-param` = parameter ID (immutable, X-01). The control reads its descriptor from `APC.bridge.call("apc.params.get", {id})`.

### Elements (the `data-apc` names) and their common options

| Group | Names |
|---|---|
| Controls (`apc-controls.js`) | `knob`, `slider`, `selector`, `toggle` |
| Widgets (`apc-widgets.js`) | `button`, `buttons`, `segmented`, `checkbox`, `radio`, `dropdown`, `menu`, `tabs`, `textfield`, `numberfield`, `label`, `readout`, `panel`, `divider`, `led`, `progress`, `list`, `logo` |
| Visualisation (`apc-viz.js`) | `graph`, `envelope`, `spectrum`, `waveform`, `scope`, `meter`, `stepseq`, `xypad`, `picture` |
| Chrome and panels | `header`, `footer`, `scale`, `gripper`, `theme-switch`, `help-button`, `infobar`, `presets`, `preset-chip`, `settings`, `license`, `update` (+ the context panel, tooltip and toast, which the kit opens itself and which are not `data-apc` names) |

Per-element markup, options, events, keys and ARIA: the header comments of `apc-widgets.js` / `apc-viz.js`, the guides
`.agents/guides/ui-kit-controls.md` / `ui-kit-widgets.md` / `ui-kit-viz.md` / `ui-kit-panels.md`, and the Hub KIT page.
Visual spec (parts, states, sizes, tokens, a11y per name): `design_library/apc-minimal/design-system.json` `elements`.

Common options of the controls and widgets: `data-label` (visible caption, also the accessible name), `data-aria-label`
(name when there is no visible label), `data-title` (tooltip), `data-size` (`sm|md|lg|<length>|<number = rem>`: control
height; knob diameter, slider length), `data-disabled`, `data-orient` (`horizontal|vertical`), `data-param` (only on
parameter-bound elements). Viz elements take `data-label` (accessible name) plus their own options.

**Widget events.** DOM `CustomEvent` on the host (bubbles): `apc:change` `{id, kind, param?, value, ...}` (the common one),
plus `apc:click` (button), `apc:select` (menu), `apc:input` / `apc:submit` (textfield), `apc:toggle` (panel), `apc:activate`
(list). Bus (`APC.emit` / `APC.on`): `widget:change` (same detail as `apc:change`), `button` `{id,variant,action,param?,pressed}`,
`menu` `{id, item}`. **Handle:** every widget returns `{dispose()}` and leaves `el.__apcW` (= `APC.widgets.get(el)`); viz elements
leave `el.__apcViz`, controls `el.__apcCtl`. **`APC.widgets`:** `openMenu(items, {x,y | anchor, id, label, onselect})`,
`closeAll()`, `popup(...)`, `get(el)`, `stats()` (leak counters `{listeners, timers, binds, popups, widgets}`; they return to
their previous value after `dispose()`). Two-state parameters (boolean, 0..1, two choices) read as `checked = value > min`.
`readout` and `progress` accept `data-meter` (a bridge `meter` event id) besides `data-param`. `logo` renders a link button
only when a URL is configured (`data-url`, or `data-link` = a key of `apc.info` `links`) and opens it with `apc.openUrl` on
click; `data-src` images are never fetched from the network.

**Viz events and data.** Native -> JS bridge event **`viz`** `{id, data}` (native name `apc.viz`; the kit registers one listener and
routes by id). Elements subscribe with `data-viz="<id>"` (meter: `data-meter="<id>"`, else the element id). Payloads (JSON number
arrays, or `Float32Array` in JS): `{type:"spectrum", db:[...], fs, log?}` (linear bins 0..fs/2; `log:true` = bins already
log-spaced), `{type:"meter", db, peak?}`, `{type:"waveform", min:[..], max:[..]}` or `{samples:[..]}`, `{type:"playhead", step}`
or `{type:"steps", steps, accents?}`, `{type:"curve"|"curves", ...}`; a bare array is the element's natural payload. The host
emits at display rate (~30 fps) from the analysis thread, **never per audio buffer**; real analysis comes from DSP, the kit
only draws. **`meter` value convention:** the bridge event `meter {id,value}` is a **linear** amplitude by default and dB when the
element says `data-input="db"`; `viz` meter payloads are always dB. **Array parameters** (stepseq): a descriptor with `array:true`
(or `type`/`kind` `"steps"`, or an array `value`) accepts `apc.param.set {id, value:[...]}`; for any other descriptor `stepseq`
only emits its bus event. **New bus events:** `graph:node`, `envelope:node`, `envelope:change`, `meter:clip`, `stepseq`,
`xypad:change` (each also fires a DOM `CustomEvent` on the host, e.g. `apc-node`, `apc-clip`, `apc-stepseq`, `apc-xypad`).

## Bridge functions (JS -> native, each returns a Promise of JSON; names are the contract)

```
apc.info                      -> { product, manufacturer, version, buildDate, links:{company,product,docs,support,update}, features:{ themeEnabled, helpMode, midiLearnTable, undoRedo, macros, dragModulation, oversampling, autoUpdateCheck, licenseMode, presetHierarchy }, standards:{...effective values} }
apc.params.list               -> [ParamDescriptor]
apc.params.get {id}           -> ParamDescriptor
ParamDescriptor = { id, name, unit, min, max, default, value, step?, skew?, choices?:[labels], help:{what,effect,how}, group?, modulation:[{src,amount,polarity,min,max,bypass}], midiCc?:number|null, normalized?:bool }
apc.param.set {id, value}     -> {value}            apc.param.begin {id} / apc.param.end {id}   (host gesture)
apc.param.reset {id}          -> {value}            (declared default; base value only)
apc.mod.set {id, route} / apc.mod.remove {id, src} / apc.mod.clear {id}
apc.midi.learn {id} / apc.midi.unlearn {id} / apc.midi.table.get / apc.midi.table.set
apc.settings.get              -> { schema:"apc-settings/1.0", ui:{...}, engine:{...}, presets:{...}, license:{...} }
apc.settings.set {patch}      -> merged settings (native does lock+merge, X-08: engine here = defaults for NEW instances)
apc.engine.get / apc.engine.set {patch}   -> per-instance engine state (lives in the DAW chunk, X-08)
apc.presets.list {scope, filters, search, sort} -> {items:[{id,kind,name,pack,meta,rating,favorite,mtime}], total}
apc.presets.state             -> { current:{id,name,dirty,readOnly}, ab:{active:"A"|"B", hasB:bool}, loadBehavior }
apc.presets.load {id} / apc.presets.save {name,pack,kind,meta} / apc.presets.revert / apc.presets.init
apc.presets.rate {id,stars} / apc.presets.favorite {id,on} / apc.presets.import {path|data} / apc.presets.exportPack {ids}
apc.presets.ab {action:"toggle"|"copyAtoB"|"copyBtoA"} / apc.presets.rescan / apc.presets.openFolder
apc.license.status            -> { state:"DEMO"|"TRIAL"|"LICENSED"|"UNVERIFIED", name?, daysLeft?, seats?, mode:"none"|"signed-file"|"online-activation" }
apc.license.activate {serial,email?} / apc.license.loadFile {text} / apc.license.deactivate / apc.license.offlineRequest   (offline: returns {requestCode} to paste on the website)
apc.update.state              -> { state:"Idle|Checking|UpToDate|UpdateAvailable|Downloading|Verifying|ReadyToInstall|Failed", current, latest?, notes?, error?, progress? }
apc.update.check / apc.update.download / apc.update.revealInstaller
apc.presets.info              -> { root, assets, builtAt, devRoot?, factoryInstall, hierarchy, packs:[{name,readOnly,count}], writablePacks }
apc.presets.restoreFactory    (re-creates the factory layout; see P-14 multi-account note)
apc.update.cancel
apc.openUrl {url}             (user-click only; native allow-list)
apc.ui.setScale {scale} / apc.ui.getPrefs
apc.diagnostics.copy          (X-10: local-only; returns text for the clipboard)
```
### Error model (added after the first native implementation)

A failing call resolves to a value `{ error, message, path?, verb? }`; codes: `gated`, `exists`, `unknown_function`,
`unknown_param`, `not_found`, `readonly`, `io`, `invalid`, `empty`, `unsupported`, `invalid_state`, `unverified`, `invalid_file`.
Components report plugin errors themselves (toast with the failing path). `apc-bridge.js` emits `APC.emit("error")` only for
infrastructure failures (`timeout`, `unknown_function`, `no_backend`, bad name), marked `infra:true`, so nothing toasts twice.
`apc.presets.list` query: filters are arrays per group plus `axes:{bri:{op:"gte|lte|eq",word}}`, `favorite`, `minRating`;
scope `"all" | kind | "pack:<Name>"`; sort keys `name|type|rating|recent|bpm|used|path`; search is a case-insensitive
substring over name, subcategory, desc, category, author, tags, moods (query capped at 64 chars).
`save {}` = quick save, `save {name,...}` = Save As (`replace:true` overwrites). `import` takes `{path}` or `{name,data,encoding:"base64"}`.
`update.check` / `update.download` answer immediately; results arrive as `update` events.

Native -> JS events (`APC.bridge.on(name, fn)`): `param {id,value}`, `preset {state}`, `license {status}`, `update {state}`, `meter {id,value}`, `viz {id,data}` (live display data for the viz elements, see "Viz events and data"), `error {message,detail?,source}`. Every `error` event is shown by `APC.toast.error`.

## Behaviour that must match the standards exactly

- U-01 Alt/Option+Click always resets (base value only, never modulation). U-02/U-15 double-click = reset by default, `ui.double_click:"value_entry"` switches it to value entry. Click on value readout = text entry (Enter commit, Esc cancel, `.`/`,` decimals, units `Hz kHz dB %`, `1.2k`; invalid -> red flash and keep focus; out-of-range -> clamp + hint). Shift+drag = fine (10x). Wheel nudges; inside scrollable panels capture only after 120 ms hover or with Shift (`ui.wheel_target`). Arrow keys nudge, Shift fine, PgUp/PgDn coarse. Modifiers ignored during an active drag.
- U-03 context panel sections in order VALUE (reset, enter value, copy/paste) -> MODULATION (route rows: source, amount -100..100, polarity, min/max, bypass, delete, add source, clear all) -> MIDI (learn/unlearn/CC) -> HELP. Esc closes.
- U-04 modulated controls show ONE ring (slider: one band) = the summed reach of all active modulation routes, plus a live position marker. Individual sources (colour-blind-safe swatches + dash) live in the context panel only. There is no visible `⋯` options button by default (`data-more="show"` opts in); every control reaches the context panel via right-click, touch long-press, Shift+F10 / ContextMenu.
- U-09 tooltip: delay `ui.tooltip_delay_ms` (default 400), never while dragging, fixed anchor (never under the pointer or over the readout), <=3 lines; info bar mode; F1/`?` help mode + visible Help button; text from the parameter descriptor `help` only (written once).
- U-16 version `v<semver>` always visible in the footer (never only in a menu); shares the spot with `[DEMO]`/`[TRIAL n d]` badge and `↑ update available`.
- U-08 scale steps 50..300 % in 25 % steps, gripper snaps to 5 %, aspect-locked, one scale pipeline (see `apc-fit.js`/`apc-core.css`).
- U-10/U-13 preset load `Instant`/`Confirm if dirty`; dirty `*`; revert; A/B with copy; every preset I/O failure visible; Save has a visible button (Ctrl/Cmd+S only an accelerator).
- Demo gating (L-02) is enforced natively; the UI only reflects `apc.license.status` and shows the activation sheet when a gated verb returns `{error:"gated"}`.
- Branding: a link is rendered only when its URL is configured; no auto-launch ever.

## Testing contract

**Design conformance guard:** `tests/kit-conformance.html` opens every element and overlay in night and day and fails on any UA/native
look (appearance, font, non-token colour, radius, shadow, gradient, scrollbar, focus ring, text floor, native `title` bubble). New kit
elements are covered by walking the DOM; see `.agents/guides/ui-kit-panels.md` "Design conformance".

Each component ships a **self-test page** under `templates/webview/apc-ui/tests/` that loads the kit + `apc-mock.js`, runs DOM assertions with synthetic pointer/keyboard events, and writes `window.__APC_TEST__ = { pass, fail, failures:[...] }` and a `<pre id="apc-test-result">` JSON; `scripts/apc-kit-test.js` (kit-B agent) drives them in a headless Chromium-family browser (`--headless=new --dump-dom`) and skips cleanly if none is installed (`node bin/apc.js kit test`). Pages: `kit-a.html`, `kit-b-*.html`, `kit-widgets.html`, `kit-viz.html`. The viz page loads `apc-mock-viz.js` with `window.APC_MOCKVIZ_AUTOSTART = false` and steps it synchronously for deterministic frames. Showcase / screenshot mode (not a test): `tests/kit-viz.html?demo=1[&theme=day]` (night by default, `theme=day` for the day palette); the widgets have `tests/demo/widgets-demo.html#day|#night`. Every element must also appear in the Hub catalog (`hub/kit-catalog.json`: markup, options, gestures, demo scene) and in the element spec (`design-system.json` `elements`); `test/hub-kit.test.js` and `test/design-tokens.test.js` fail when a registered name is missing from either.
