# APC Minimal

The one design library APC ships. Its canonical visual source is [`hub/_design/apc_filter_f30_annotate_v006.html`](../../hub/_design/apc_filter_f30_annotate_v006.html): a 120 × 70 instrument face with night and day surfaces, deep teal panels, a coral signal, cyan energy and spectrum colour, compact rounded corners, hairline rules, subtle material depth, and mono numerals. The APC Hub 09c KIT page labels this reference **APC Minimal** and serves the source HTML unchanged. The `F-30` filename is retained as the source file's identity; the library name shown in APC is APC Minimal.

`tokens.css` and `design-system.json` provide the global palette and the adjustable component specification for the APC UI kit. The Hub's global token edits and saved per-element geometry overrides are preview layers; they do not rewrite the canonical reference file. Copy this folder to create another design library.

## Design language: "Zeichnung 2030"

An instrument *drawn* on deep teal: a technical drawing more than a skeuomorphic box. Flat surfaces,
hairline rules, compact rounded corners, a little material depth, and colour used only where it
carries meaning. **Five colours, one job each:**

| Colour | Name | Job |
|---|---|---|
| `#122935` | material | The plate, the panel body: everything that is not signal |
| `#5BC7D2` | energy | Spectrum, meter body, lamps that say "alive", success |
| `#FB543D` | limit | Clip, ceiling, the value arc of a control in use, errors |
| `#ED7941` | warning | The meter's approach zone (between energy and limit) |
| `#F2B29E` | memory | The ghost of a curve you just moved, soft warm washes |

**Night** is the default (deep teal plate); **day** re-inks the same plate on paper (`#E3EAEC`), with the
signal colours darkened just enough to stay readable.

- **Type.** Inter for words, JetBrains Mono for numbers (tabular figures). Both are bundled under `fonts/`
  (OFL-1.1, latin subset, about 110 KB). APC never loads a font from the network.
- **Labels and values.** Labels are small, uppercase and letter-spaced in `--ink-2`; values are mono in `--ink`.
  Micro labels, units and axis ticks use `--ink-3`.
- **Grid.** The reference face is 120 × 70 cells at `1 rem` per cell. Controls sit on cell boundaries, captions
  share one baseline per card, and boxes in a row share one height (`--ctl-h`) and one gap (`--ctl-gap`).
- **Controls.** A hairline dial with a pointer line in `--ink`; the accent arc appears only for the
  part of the range in use. Faders have a flat cap with no outline. Focus is a ring, never a box around the
  pointer. A subtle halo shows while you drag.
- **Colour roles are strict.** `--accent`, `--ok` and `--apc-danger` are *graphic* colours (fills, arcs,
  rings, lamps). Text in those hues uses `--accent-text`, `--ok-text` or `--apc-danger-text`, which are
  tuned to pass WCAG 4.5:1 in both modes. Meaning never rides on colour alone.

**Where the design comes from.** `hub/_design/` holds the review trail: `apc_filter_f30_spec_v006.md` (what
each review round changed and why), `apc_filter_f30_mockup_v006.html` (the approved plate the kit CSS
quotes) and `apc_filter_f30_annotate_v006.html` (the same plate with review pins: the **canonical
reference** the Hub shows). `hub/_design/CHANGELOG.md` logs every pass. Earlier drafts are not part of
the repository.

## Files

| File | What it is |
|------|------------|
| `tokens.css` | **The token contract.** One `:root, [data-theme="night"]` block (night is the default) and one `[data-theme="day"]` block that overrides some of the same names. This is what the UI kit loads. |
| `design-system.json` | Documentation of the same values (`tokens.night` / `tokens.day` flat maps), palette roles, WCAG contrast pairs, typography roles, shape, spacing, motion, data-viz palette. `elements` is the element spec (see below), `groups`, `fontsets`, `scales` and `tokenGroups` serve the Hub. |
| `preview.html` | Standalone page (no network) that loads `tokens.css` and shows the swatches and type scale for night and day. The instrument-face reference is the canonical file linked above. |
| `README.md` | This file. |

The registry entry is `design_library/manifest.json` (`"tokens": "tokens.css"`, `"spec": "design-system.json"`, `examples.webview: ["preview.html"]`).

## Make your own design

1. Copy this folder: `design_library/apc-minimal/` to `design_library/<your-id>/` (lowercase letters, digits, `-`, `_`).
2. In `tokens.css` change the **values**. Never rename or remove a token: the kit and every plugin rely on the names. Add tokens only if you also add them to the kit.
3. Mirror the values in `design-system.json` (`tokens.night`, `tokens.day`, the `palette` section, the contrast pairs). Update `id`, `name`, `description`.
4. Register it in `design_library/manifest.json`: add an entry with `id`, `name`, `path`, `vibe`, `category`, `tags`, `supports`, `tokens: "tokens.css"`, `spec: "design-system.json"`, `examples`, `colors`, and bump `totalDesigns`.
5. Check it: `node scripts/design-tokens-check.js design_library/<your-id>` (tokens.css and design-system.json agree; every documented contrast pair is met), and `node bin/apc.js validate a11y --plugin <Name>` for a plugin that uses it.
6. Look at it in the Hub: `/apc-hub`, page **09c KIT**. The component gallery uses your `tokens.css`; the top reference stage remains the canonical v006 page and applies only explicit live token edits or saved element tuning.

A design that has only a `design-system.json` (no `tokens.css`) still works: the Hub derives a subset of kit tokens (`--plate`, `--ink`, `--accent`, radius, font) from its `palette` / `typography` / `components`. Ship a `tokens.css`; it is exact.

## The token contract

Everything the UI kit draws comes from these custom properties. A product restyles itself by overriding values, never by editing component CSS. `templates/webview/apc-ui/apc-core.css` `:root` defaults (and its `[data-theme="day"]` block) are identical to `tokens.css`, so the kit looks like APC Minimal when no design is loaded.

| Group | Tokens |
|-------|--------|
| Surfaces | `--apc-letterbox` `--surface` `--plate` `--plate-2` `--inset` |
| Lines | `--rule` (control borders, >= 3:1) `--rule-2` (quiet dividers, decorative) `--grip-ink` |
| Text | `--ink` `--ink-2` `--ink-3` |
| Signal | `--accent` `--accent-ink` `--accent-text` `--ok` `--ok-text` `--apc-danger` `--apc-danger-text` `--apc-focus` `--apc-overlay` `--memory` |
| Data | `--viz-line` `--viz-accent` `--viz-fill` `--viz-grid` `--viz-axis` `--viz-1..4` `--meter-ok/warn/clip` `--led-on/off` `--step-*` `--apc-mod-1..8` |
| Shape | `--r-control` `--r-panel` `--r-radio` `--r-led` `--sh-recess` `--sh-raised` `--apc-shadow-pop` `--stroke` `--stroke-2` `--disabled-opacity` |
| Type | `--font-ui` (interface words) `--font-num` (tabular numbers) `--font-text` (sentences) `--t-micro` `--t-label` `--t-value` `--t-readout` `--t-title` `--t-head` `--label-spacing` |
| Sizing | `--ctl-h` `--ctl-gap` `--pad` `--knob-size` `--knob-arc` `--track-w` `--thumb` `--check` `--apc-viz-node` `--apc-logo-h` (rem: the kit scales as a whole) |

Type roles: **label** = UPPERCASE, letter-spaced, mono, `--ink-2`. **value** = mono, tabular numerals, `--ink`. **text** = system sans.

Accessibility rules baked into the values (both modes): text pairs >= 4.5:1, graphics and control boundaries >= 3:1, the accent never the only carrier of meaning, motion off by default. The measured ratios are listed in `design-system.json` (`contrast.pairs`) and re-verified by `test/design-tokens.test.js`. One usage rule follows from the numbers: `--accent`, `--ok` and `--apc-danger` are **graphic** colours (fills, rings, lines, lamps, focus). Text in those hues uses the matching text token: `--accent-text` (night #FF7B64, day #A6331F), `--ok-text` (night = `--ok` #5BC7D2, day #217180) and `--apc-danger-text` (night = `--apc-danger` #FB543D, day #A6331F). Day `--accent` (#D0442C) clears 3:1 as a graphic on every surface, and white `--accent-ink` on an accent fill reaches 4.62:1, but it is not used as text colour on the plate. `apc validate a11y` checks all 441 text pairs of the kit; the lowest is 4.58:1.

## The element spec (`design-system.json` `elements`)

Every element of a plugin UI is defined by tokens there: `elements["<data-apc name>"] = { title, group, summary, parts, states, sizes, options, a11y }` for all 46 names (knob ... update, plus the overlays `context-panel`, `tooltip`, `toast`). `parts` maps a part (`dial`, `arc`, `label` ...) to properties whose values are tokens (`"--accent"`), compounds (`"--stroke solid --rule"`) or literals; `states` (`hover`, `active`, `focus`, `disabled`, `selected`, `error`, `checked`, `open`) replaces individual `"<part>.<property>"` values; `sizes.default` is the default size token and `sizes.overridable` lists the per-control overrides that are not design tokens (`data-size`, `--w-h`, `--slider-len`, `--apc-viz-w/h`). The values were read from the kit CSS, so a design that changes tokens changes exactly what the spec says. `groups` orders the nine groups (Rotary & linear, Buttons & switches, Selection, Text & numbers, Containers, Display, Visualisation, Chrome, Overlays). `tokenGroups` lists every token of `tokens.css` once, with a kind (`color|length|font|number`) and a description, so an editor can be generated; `fontsets` offers system-safe alternatives for `--font-ui` / `--font-text` (never a web font); `scales` explains the `--t-*` rem + px-floor ladder.

## Drift protection

`tokens.css` is canonical. `test/design-tokens.test.js` (run by `npm test`) fails when

- a `tokens.css` token is missing from, or has another value in, `apc-core.css` (`:root` for night, `[data-theme="day"]` for day);
- `design-system.json` `tokens.night` / `tokens.day` differ from `tokens.css`;
- a documented contrast pair drops under its minimum or its documented ratio is stale;
- the `[data-theme="day"]` mirror in `apc-widgets.css` differs from the tokens.css day block;
- an element in `elements` references a token that `tokens.css` does not define, uses an unknown group or state, or a state key names a part or property the element does not have;
- an `APC.register("name")` of the kit has no `elements` entry (explicit exceptions: none), or an entry is neither registered nor one of the three overlays;
- `tokenGroups` miss a token, repeat one, or lack a description;
- accent-coloured text in the kit CSS uses `--accent` instead of `--accent-text`.

## How the Hub 09c KIT page uses it

`GET /kit-demo/_reference?surface=night|day` serves `hub/_design/apc_filter_f30_annotate_v006.html` byte for byte. The Hub does not rebuild or replace its markup. `GET /kit-theme/apc-minimal.css` returns `tokens.css` for the component gallery, unchanged except that the portable font URLs (`fonts/x.woff2`) are pointed at the Hub's same-origin copy, and `GET /api/v1/design/apc-minimal` exposes the token file, element specification, and validated tuning schema. In 09c, global token changes preview against the source's corresponding CSS variables; per-element numeric tuning is layered onto the source preview and saved in `design-system.json`.
