# UI kit widgets: the complete set of plugin UI elements (non-visualisation)

Agent-facing usage for `templates/webview/apc-ui/apc-widgets.js` + `apc-widgets.css`
(and the flat re-skin of the four older controls in `apc-controls.js` /
`apc-components.css`). Binding contract: `templates/webview/apc-ui/CONTRACT.md`.
Standards: `.agents/rules/product-standards.md`. Layout rules:
`.agents/rules/ui-layout-system.md`. Controls (knob/slider/selector/toggle,
context panel, help, chrome): `.agents/guides/ui-kit-controls.md`.

Never hand-roll buttons, menus, dropdowns, tabs, fields or LEDs: use these elements,
position them with `.apc-cell` (or normal flow inside a panel), and let the design
restyle them through CSS tokens. The kit ships ONE design, **APC Minimal**: flat,
square, 1 px `--rule` hairlines, `--accent` as the single signal colour, mono
uppercase letter-spaced labels, sentences in `--font-text`. No gradient, shadow,
glow or bevel anywhere (tokens `--sh-*`, `--apc-shadow-pop` are `none`,
`--r-control`/`--r-panel` are `0`).

## Load order (classic scripts, no modules)

```html
<link rel="stylesheet" href="apc-ui/apc-core.css">        <!-- scaling + night token defaults -->
<link rel="stylesheet" href="apc-ui/apc-components.css">  <!-- knob/slider/selector/toggle + kit-A/B panels -->
<link rel="stylesheet" href="apc-ui/apc-widgets.css">     <!-- widgets + the day palette mirror -->
<link rel="stylesheet" href="design-theme.css">           <!-- optional token overrides, AFTER the kit -->
...
<script src="apc-ui/apc-fit.js"></script>
<script src="apc-ui/apc-kit.js"></script>
<script src="apc-ui/apc-bridge.js"></script>
<script src="apc-ui/apc-controls.js"></script>            <!-- Model/parsing/bridge helper used by the widgets -->
<script src="apc-ui/apc-widgets.js"></script>
<script>APC.mount(document);</script>
```

`apc-widgets.css` contains one `[data-theme="day"]` block, a **mirror of
`design_library/apc-minimal/tokens.css`'s day block** (apc-core.css only carries the night
values). Keep both in sync; a design loaded after the kit overrides either.

## Common conventions

| Option | Meaning |
|---|---|
| `data-apc="NAME"` | one of the names below (the contract) |
| `data-param="id"` | bind to a parameter (only where the element lists it) |
| `data-label` | visible caption; also the accessible name |
| `data-aria-label` / `data-title` | accessible name without a visible label / tooltip |
| `data-size` | `sm` \| `md` \| `lg` \| a CSS length \| a bare number = rem (sets `--w-h`, the control height) |
| `data-disabled` | `true`/empty = disabled; `el.__apcW.setDisabled(bool)` at runtime |
| `data-orient` | `horizontal` \| `vertical` where it applies |

* Every element returns `{dispose()}` and leaves a handle on `el.__apcW` (`APC.widgets.get(el)`).
* Events: DOM `CustomEvent("apc:change")` (bubbles) with `detail = {id, kind, param?, value, ...}`
  plus the bus event `APC.emit("widget:change", detail)`. Element-specific events are listed below.
* Parameter binding is identical for all bound elements: descriptor from `apc.params.get`,
  one complete host gesture (`begin`, `set`, `end`) per discrete change, follows `param` / `preset`
  bridge events and `params:changed`, pushes `undo:push`. Two-state parameters (boolean, 0..1,
  2 choices) read as `checked = value > min`. A parameter that cannot be read: the element gets
  `is-error` + `aria-invalid`, is disabled, and the failure is toasted (never silent).
* Choice parameters send **labels** over the bridge (the descriptor's `choices`); numeric parameters
  with `data-items='[{"value":-50,"label":"Down"},...]'` send the number.
* Popups (dropdown, menu) are fixed layers sized in rem, flipped/clamped inside `.apc-plate`,
  scrolling when taller than the free space; they close on outside click, Esc, resize.
* Nothing is gesture-only: every element is operable by keyboard and has a visible control.
* `prefers-reduced-motion`: nothing animates (the indeterminate progress bar becomes a static segment).

## The elements

Full markup/option/event/key/ARIA tables are in the header comment of `apc-widgets.js`
(the Hub catalog is built from it). Summary:

| `data-apc` | What | Notable options | Events | Keys |
|---|---|---|---|---|
| `button` | action (momentary), `latch` (aria-pressed), `primary`; LED / icon slot | `data-variant`, `data-led`, `data-icon` or `<svg data-slot="icon">`, `data-param` (momentary or latch) | `apc:click`, bus `button` | Enter/Space; with `data-param` press on keydown, release on keyup |
| `buttons` / `segmented` | one choice of N as a button row/column | `data-param` (choice), `data-items`, `<option>`, `data-value`, `data-orient` | `apc:change` | roving tabindex, arrows select, Home/End |
| `checkbox` | on/off box | `data-param`, `data-checked`, `data-indeterminate` | `apc:change` | Space |
| `radio` | radio group (stacked by default) | as `buttons` | `apc:change` | arrows, Home/End |
| `dropdown` | field + popup listbox | `data-param`, `data-items`, `<option>`, `data-placeholder`, `data-searchable` | `apc:change` | Down/Up/Enter/Space open, arrows, Home/End, type-ahead, Esc |
| `menu` | popup/anchor/context menu, one submenu level | `data-items` JSON or child markup, `data-label`, `data-trigger="none"`, `data-context`, `data-onselect` | bus `menu {id,item}`, `apc:select`, `handle.onselect` | arrows, Right/Left submenu, Enter/Space, Esc, type-ahead |
| `tabs` | tablist + panels | children `data-tab="Title"`, `data-orient`, `data-value` | `apc:change` | roving tabindex, arrows by orientation, Home/End |
| `textfield` | single-line text with validation | `data-required`, `data-pattern`, `data-maxlength`, `data-help`, `data-error`, `handle.validator` | `apc:input`, `apc:change`, `apc:submit` | Enter commit, Esc revert |
| `numberfield` | typed numeric + units + step buttons | `data-param` or `data-min/max/step/unit/value/digits`, `data-steppers` | `apc:change` | Enter, Esc, Up/Down (Shift fine), PageUp/Down coarse, wheel |
| `label` | static text | `data-role="title\|label\|caption\|value"`, `data-text`, `data-for` | - | - |
| `readout` | live read-only value | `data-param` or `data-meter` or `handle.setValue`, `data-unit`, `data-digits`, `data-layout`, `data-align` | - | - |
| `panel` | titled frame, optional collapse | `data-title`, `data-collapsible`, `data-collapsed` | `apc:toggle` | header button |
| `divider` | rule, optional text | `data-orient`, `data-label` | - | - |
| `led` | indicator | `data-state`, `data-on`, `data-param`, `data-states` | - | - |
| `progress` | determinate / indeterminate bar | `data-value/min/max`, `data-indeterminate`, `data-show-value`, `data-state`, `data-param`/`data-meter` | - | - |
| `list` | listbox single/multi, scrollable | `data-items`/`<option>`, `data-multiple`, `data-rows`, `data-param` (single) | `apc:change`, `apc:activate` | arrows, Space, Shift ranges, Ctrl+A, type-ahead |
| `logo` | wordmark/lockup slot | `data-text`, `data-sub`, `data-src`, child `<svg>`/`<img>`, `data-url` or `data-link` | - | link button only when a URL is configured |

Programmatic: `APC.widgets.openMenu(items, {x,y | anchor, id, label, onselect})`,
`APC.widgets.closeAll()`, `APC.widgets.popup(...)`, `APC.widgets.stats()` (leak counters used by tests).

### The four older controls (re-skinned, behaviour unchanged)

`knob`, `slider`, `selector`, `toggle` keep every behaviour (U-01/U-02/U-15 gestures, value
entry, wheel rule, modulation ring, context panel). New options:

| Option | Applies to | Meaning |
|---|---|---|
| `data-size` | all | knob diameter (`sm` 2rem, `md` 3rem, `lg` 4rem), slider length (4/6/9rem), others the control height |
| `data-disabled` | all | no interaction, `aria-disabled`, out of the tab order; `el.__apcCtl.setDisabled(bool)` |
| `data-readout` | knob, slider | `below` (default) \| `above` \| `none` (`false` still works) |
| `data-unit` | knob, slider | `inline` (default, "1.2 kHz") \| `separate` (unit in a dimmed span) \| `none` (aria keeps the unit) |
| `data-ticks` | knob, slider | `5` = five ticks incl. both ends, or `steps` = one per step of a stepped/choice parameter |
| `data-bipolar` | knob, slider | arc/fill from the centre (automatic when the range spans 0) |
| `data-orient` | slider | `horizontal`/`h` (alias of `data-orientation`) |
| `data-steppers="false"` | selector | hide the visible prev/next buttons (default: shown, 1:1 with ArrowDown/Up) |
| `data-variant="button"` | toggle | boxed look with a square LED instead of the switch |

Look: knob = hairline dial + 1 px `--rule` track ring + `--knob-arc` thick `--accent` value arc +
2 px `--accent` pointer line; slider = `--track-w` track, `--accent` fill, flat `--thumb`-long cap with a
centre line; selector = `[<] value [>]` joined hairline boxes; toggle = 2 rem square switch.

## Styling hooks (how a design overrides)

All colour, type and shape come from tokens; a design (`design_library/<id>/tokens.css`, loaded
after the kit) overrides **values**, never component CSS. Every widget rule is wrapped in
`:where()` (specificity 0), so any selector in a design wins without `!important`.

Tokens read (no others): surfaces `--plate --plate-2 --inset --surface`; lines `--rule --rule-2`
`--stroke --stroke-2`; text `--ink --ink-2`; signal `--accent --accent-ink --accent-text --ok --apc-danger
--meter-warn --led-on --led-off --apc-focus`; shape `--r-control --r-panel --apc-shadow-pop
--disabled-opacity`; type `--font-ui --font-text --t-micro/label/value/readout/title/head
--label-spacing`; size `--ctl-h --pad --knob-size --knob-arc --track-w --thumb --check`.
Tokens added for the widgets (defined in `tokens.css`, the CSS keeps a fallback): `--r-radio` (radio box corner,
= `--r-control`), `--r-led` (LED corner, = `--r-control`), `--apc-logo-h` (logo image height, 1.5 rem).
Not a token (a per-control override): `--w-h` (control height; `data-size` writes it). Accent-coloured TEXT
(logo hover) uses `--accent-text`; `--accent` is for fills, rings and lines.

Class hooks: `.apc-w` (every widget host) with `.apc-w--<kind>`, state classes `is-error`,
`is-disabled`, `is-selected`, `is-on`, `is-checked`, `is-active`; parts `.apc-button`,
`.apc-seg`, `.apc-radio`, `.apc-check`, `.apc-dd`, `.apc-pop`, `.apc-opt`, `.apc-menu2`,
`.apc-mi`, `.apc-tab`, `.apc-input`, `.apc-nf`, `.apc-li`, `.apc-led`, `.apc-progress__*`,
`.apc-panel__*`, `.apc-logo__*`.

Example (round, serif, bigger controls, different accent) - values only:

```css
:root { --r-control: 6px; --font-ui: "Inter", sans-serif; --ctl-h: 1.75rem; --accent: #3d9be0; --accent-ink: #000; }
```

## Tests and demos

* `templates/webview/apc-ui/tests/kit-widgets.html` (run with `node bin/apc.js kit test`):
  every element - states, keyboard, ARIA, parameter round trip with `apc-mock.js`,
  multi-instance coexistence, dispose cleanliness (listeners/timers/bindings/popups), disabled,
  error state, token overrides, day theme, flat-look sweep (no gradient/shadow/filter, square
  corners, text >= 9 px) and popup placement inside the plate.
* `tests/demo/widgets-demo.html`, `widgets-variants.html`, `panels-demo.html`: self-contained
  galleries for screenshots (`#day`/`#night`, `#open=dropdown|menu|submenu`); they are not test
  pages (the runner only scans `tests/*.html`).

## Limits and notes

* Param-bound widgets and `numberfield` need `apc-controls.js` (they share its `Model`).
* `list` with `data-param` is single-select only; `tabs` is not parameter-bound (use `buttons` /
  `segmented` for a parameter-driven view switch).
* The dash patterns in `.apc-swatch--dash1/2` (modulation source identity in the context panel)
  are `repeating-linear-gradient`/`radial-gradient` background images on purpose: they are a
  colour-blind aid, not decoration.
