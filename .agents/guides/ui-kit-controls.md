# UI kit A: controls, context panel, help, window chrome

Agent-facing usage for `templates/webview/apc-ui/` files `apc-controls.js`,
`apc-context.js`, `apc-help.js`, `apc-chrome.js` (+ the kit-A sections of
`apc-components.css`). Binding contract: `templates/webview/apc-ui/CONTRACT.md`.
Standards: `.agents/rules/product-standards.md` (U-01..U-04, U-07..U-09, U-12,
U-15, U-16, X-09). Layout rules: `.agents/rules/ui-layout-system.md`.

Never hand-roll knobs, tooltips, context menus, footers or grippers: use these
components, position them with `.apc-cell`, and let the design theme restyle them
through CSS tokens. The vendored copy in `Source/ui/public/apc-ui/` is frozen per
plugin: fix the template and re-vendor, do not edit the copy.

## Load order (classic scripts, no modules)

```html
<link rel="stylesheet" href="apc-ui/apc-core.css">
<link rel="stylesheet" href="apc-ui/apc-components.css">
<link rel="stylesheet" href="design-theme.css">          <!-- token overrides; load AFTER the kit -->
...
<script src="apc-ui/apc-fit.js"></script>
<script src="apc-ui/apc-kit.js"></script>
<script src="apc-ui/apc-bridge.js"></script>
<script src="apc-ui/apc-controls.js"></script>
<script src="apc-ui/apc-context.js"></script>            <!-- optional, needs controls -->
<script src="apc-ui/apc-help.js"></script>               <!-- optional -->
<script src="apc-ui/apc-chrome.js"></script>
<script>APC.mount(document);</script>
```

`APC.mount(root)` initialises `[data-apc]` **descendants** of `root` (not `root`
itself). Every component returns `{ dispose() }`.

## Markup

All parameter values cross the bridge in real-world units. The control reads its
`ParamDescriptor` from `apc.params.get {id}`; there is nothing to configure in JS.

```html
<!-- knob: vertical drag, ring, modulation arcs, readout under the dial -->
<div class="apc-cell" style="left:3rem;top:5rem;width:6rem;height:8rem"
     data-apc="knob" data-param="cutoff_hz" data-label="CUTOFF"></div>

<!-- slider: vertical (default) or horizontal -->
<div class="apc-cell" data-apc="slider" data-param="mix_pct" data-label="MIX"></div>
<div class="apc-cell" data-apc="slider" data-param="mix_pct" data-orientation="h"></div>

<!-- selector: choice list; descriptor.choices are LABELS and labels go over the bridge -->
<div class="apc-cell" data-apc="selector" data-param="osc_wave" data-label="WAVE"></div>

<!-- toggle: boolean (sends true/false if the descriptor value is boolean, else 0/1) -->
<div class="apc-cell" data-apc="toggle" data-param="bypass" data-label="BYPASS"></div>

<!-- chrome -->
<header class="apc-cell" data-apc="header" style="left:0;top:0;width:50rem;height:2.5rem"></header>
<footer class="apc-cell" data-apc="footer" style="left:0;top:25.5rem;width:50rem;height:2rem"></footer>
<div class="apc-grip" data-apc="gripper"></div>
<div data-apc="infobar"></div>          <!-- only if you want an info bar outside the footer -->
<div data-apc="help-button"></div>      <!-- only if you do not use the header -->
<div data-apc="scale"></div>  <div data-apc="theme-switch"></div>
```

### Options (`data-*`)

| Component | Option | Meaning |
|---|---|---|
| all controls | `data-param` | **required**, immutable parameter ID (X-01) |
| all controls | `data-label` | visible label and accessible name (default: existing text, else descriptor name) |
| knob, slider | `data-readout="false"` | hide the value readout (value entry stays reachable via context panel / Enter key) |
| knob | `data-bipolar="true"` | value arc starts at the centre (automatic when min < 0 < max) |
| slider | `data-orientation="h"` | horizontal |
| header | `data-product`, `data-manufacturer` | text shown until `apc.info` arrives |
| header | `data-logo-src` | image used instead of the manufacturer text |
| header | `data-save="true"` | render a plain Save button in the Save slot (emits `preset:save`); otherwise the slot is filled with `data-apc="save-button"` when that component is registered, else left empty for the presets module |
| header | `data-help="false"` | omit the Help-button slot |
| header | `data-scale="false"` | omit the +/- scale control |
| footer | `data-version` | version text shown synchronously before `apc.info` resolves |
| scale | `data-min`, `data-max` | scale range (default 0.5..3.0; never wider) |
| infobar | `data-idle` | initial idle text |

The ParamDescriptor drives everything: `min/max/default/value/unit/step/skew/choices/help/modulation/midiCc`.
`skew` follows the JUCE convention (`norm = ((v-min)/(max-min))^skew`).
`help = {what, effect, how}` is the **only** source of tooltip, info-bar and manual text.

## Gesture and keyboard map

| Input | Action |
|---|---|
| Drag (knob: vertical, ~150 px = full range; slider: along the track length) | adjust; wrapped in `apc.param.begin ... set* ... end` |
| Shift+drag / Ctrl (Cmd on macOS)+drag | fine x10 / super-fine x100 |
| (macOS) Option+drag | **not** fine; fine is Shift |
| Modifiers pressed after the drag started | ignored; the mode is latched at pointer-down |
| Alt/Option+click | reset to declared default (base value only, modulation untouched) |
| Double-click | reset by default; `ui.double_click = "value_entry"` opens value entry (selector: always reset; toggle: nothing) |
| Touch double-tap | same as double-click; touch long-press = context panel |
| Click on the readout | inline text entry: Enter commits, Esc cancels. Accepts `850`, `850 Hz`, `1.2k`, `1,2 kHz`, `-6 dB`, `35%`, `250 ms` (seconds params). Invalid: red flash + stays focused + reason hint. Out of range: clamped + "Clamped to ..." hint |
| Wheel | one notch = 1 % of range (Shift = 0.1 %; stepped/choice = one step); host gesture ends 250 ms after the last notch |
| Wheel inside a scrollable panel | captured only after 120 ms of hover, or with Shift; `ui.wheel_target = "panel"` requires Shift |
| Arrow keys | 1 % (Shift 0.1 %; stepped = one step); PageUp/PageDown 10 %; Home/End min/max |
| Enter / F2 on a focused knob or slider | value entry (selector: open the list; toggle: toggle) |
| Space | toggle (toggle), open the list (selector) |
| Delete / Backspace | reset |
| Right-click, Shift+F10, ContextMenu key, touch long-press, the `⋯` button only if a product opts in with `data-more="show"` | context panel (never the browser menu) |
| F1 or `?` (not while typing), the visible **Help** button | help mode: click any control for its manual entry; Esc or F1 leaves |
| Esc | closes the entry / menu / context panel / manual / help mode |

Everything reachable by gesture is also reachable by keyboard and a visible
control (X-09). Hosts often swallow F1 and `?`: the Help button always works.

## Context panel (U-03)

Sections in this order: **VALUE** (Reset, Enter value..., Copy value, Paste) ->
**MODULATION** (one row per route: source dropdown, amount -100..100, polarity,
min/max range, bypass, delete; "+ Add source" menu; Clear all) -> **MIDI**
(MIDI Learn, Unlearn, CC) -> **HELP** (What's this?). The panel is a focus-trapped
`role="dialog"`; Esc closes and returns focus to the control.

Offered sources: `APC.context.sources = [{id, name}, ...]` (default: LFO 1/2, Env 1/2,
Macro 1, Velocity, Keytrack, Mod Wheel, Aftertouch, Random, Breath, Expression) plus an
optional `descriptor.modSources`. Polarity strings mirror the descriptor
(`"bipolar"/"unipolar"` or `"bi"/"uni"`).

The amount control is a native `<input type="range" min="-100" max="100">` restyled as the kit's flat slider (1 px `--rule` track in
`--inset`, square `--accent` thumb of `--thumb`, fill from 0 to the thumb, `--apc-focus` ring, arrows / PageUp / PageDown / Home / End unchanged,
value label next to it). Never leave a native control unstyled in the panel: see "Design conformance" in `ui-kit-panels.md` and the guard
`tests/kit-conformance.html`.

## Modulation indication (U-04)

ONE neutral arc around a knob (one band along a slider) shows the **summed** reach of all
non-bypassed routes: each route pushes the value up and/or down from the base value (bipolar
both ways by its amount, unipolar by its sign), the extents add up and are clamped to the
range. Individual sources are not drawn on the control; the context panel lists them (with
their `var(--apc-mod-N)` swatches and dash style, colour-blind-safe) for editing. The arc
reads `--ink` (override `.apc-ring__sum` / `.apc-fader-sum`). A dot beside the label marks
any modulated control (its tooltip names the sources); the live
position marker needs `param` events that carry `modulated` (real-world value) or `meter`
events with id `"<paramId>.mod"`.

## Events

| Bus event (`APC.on/emit`) | Direction | Payload |
|---|---|---|
| `undo:push` | out | `{label, id, before?, after?, kind?}` (module optional; nobody listening is fine) |
| `ctl:drag` | out | `{id, active}` (gesture start/end; the tooltip uses it) |
| `params:changed` | in/out | `{id}`: refetch the descriptor (emitted after modulation/MIDI edits) |
| `settings:open`, `license:open`, `update:open`, `preset:save` | out | chrome buttons; the settings/licence/update/preset modules listen |
| `license:gated` | out | `{fn, result}` when a bridge call returns `{error:"gated"}` |
| `settings:changed` | in | the full settings object or just its `ui` part; refreshes `APC.prefs` |
| `scale:changed`, `theme:changed`, `help:mode`, `help:manual`, `context:opened/closed` | out | informational |

Bridge events consumed: `param {id,value,modulated?}` (`id:"*"` = re-read everything), `preset`,
`meter`, `license`, `update`, and optionally `midi {id,cc}`. Every bridge failure is shown
via `APC.toast.error` (never silent).

`APC.prefs.get("tooltips" | "tooltip_delay_ms" | "wheel_target" | "double_click" | "reset_animation" | "theme" | "scale")`
is the cached `settings.ui` block (loaded from `apc.settings.get`).

## Help (U-09)

- Tooltip after `ui.tooltip_delay_ms` (default 400); anchored above (or below) the control, never
  under the pointer, never over the readout, hidden on press / drag / wheel / key; at most 3 lines of prose.
- Info bar: hover or keyboard focus shows `[Name] value (default x) - what effect ...`; idle shows the
  preset name and `*` when dirty (the footer feeds it).
- `ui.tooltips = false` disables tooltips and the hover text of the info bar; explicit help mode still works.

## Footer and header (U-16, U-11)

- The footer always renders `v<semver>` (from `apc.info.version`, or `data-version`), plus `[DEMO]` /
  `[TRIAL n d]` from `apc.license.status`, `↑ update available` from `apc.update.state` (and the `license`
  / `update` events), and the preset name + dirty marker.
- The header renders a link only when its URL is configured in `apc.info.links` (`company` on the
  manufacturer/logo, `product` on the product name). Clicks go through `apc.openUrl`; nothing opens by itself.

## Scale and gripper (U-08)

One scale value (`APC.chrome.scale`): steps 50..300 % in 25 % steps (`+`/`-`), the gripper snaps to 5 %,
is aspect-locked (uniform scale from the diagonal drag), forwards raw deltas to the native `resizeGrip`
functions through `attachGrip`, and calls `apc.ui.setScale {scale}` on release. The gripper is also a
keyboard slider (arrows = 5 %, PageUp/PageDown = 25 %).

## Themes (U-07)

All colours come from CSS custom properties; a design theme only overrides tokens
(`--plate --plate-2 --surface --inset --rule --rule-2 --ink --ink-2 --accent --grip-ink --r-control --font-ui`,
plus kit-A's `--apc-mod-1..8 --apc-danger --ok --apc-focus --apc-overlay`). Never hardcode colours in
plugin CSS; use `var(--token, neutral-fallback)`.

When `features.themeEnabled` is true the chrome sets `data-theme="night"|"day"` on `<html>` from
`ui.theme` (Night / Day / Follow-OS via `prefers-color-scheme`) and shows the theme switch. The kit ships
fallback token sets under `[data-theme="night"]` and `[data-theme="day"]`. A design that wants its own day
look declares the same selectors **after** the kit stylesheet (same specificity, later wins). Both
themes must keep 4.5:1 text contrast and 3:1 focus rings: check with `apc validate a11y`.

## Self-test

`templates/webview/apc-ui/tests/kit-a.html` (helper `harness-a.js`, in-page spy bridge, no dependency on
`apc-bridge.js` / `apc-mock.js`) runs DOM assertions with synthetic pointer, keyboard and wheel events and
writes `window.__APC_TEST__ = {pass, fail, failures}` and `<pre id="apc-test-result">`.

```bash
msedge --headless=new --disable-gpu --window-size=1000,700 --virtual-time-budget=90000 \
  --dump-dom file:///.../templates/webview/apc-ui/tests/kit-a.html   # parse the last #apc-test-result
```

Append `?only=<substring of test name>` to run a subset.
