# APC Hub

APC Hub is the live local dashboard for the framework - a guarded local command
center that reflects projects, skills, commands, designs, scripts, templates,
tools, settings, documentation, and consistency in one place.

## Start

In your AI agent:

```
/apc-hub
```

Or directly:

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\scripts\apc-hub.ps1
```

```bash
# macOS / Linux
bash scripts/apc-hub.sh

# Any platform (Node >= 18)
node hub/server.js --port 4872
```

Then open `http://localhost:4872/` (opens automatically unless `--no-open`).

## What it is

- **Vanilla, zero dependencies.** Static `hub/ui/` (HTML/CSS/JS, system fonts
  only) served by `hub/server.js` (Node stdlib `http` only).
- **Read-only by default.** The server binds loopback `127.0.0.1`, answers GET
  except for the three guarded write paths below, and never builds or executes
  anything.
- **Live.** Every view is rendered from `/api/v1/*` on load: edit a
  `status.json`, doc, or config value and it shows up on reload. No rebuild.
- **Guarded write paths.** Everything is read-only except the Settings form
  and the Standards page, which POST the full structured config to
  `/api/v1/config` (shape-validated, backs up `apc.config.json` to `.bak`
  first). The review tool additionally writes `Design/annotations.json`.
  Writes are refused unless the peer, `Host` header and (when present)
  `Origin` header are all loopback. 09c KIT can also save allowlisted numeric
  per-element settings into the selected design's `design-system.json`.
- **Two design languages, on purpose.** The Hub's *own* shell uses APC RASTER as
  approved in `hub/_design/` (`hub_design_spec_v*.md`): rectangles only, ASCII-first,
  dark default + light alternate, amber = active/warning, phosphor green = ok.
  The *plugin UI* design that APC ships is **APC Minimal** ("Zeichnung 2030":
  deep teal plate, coral signal, cyan energy), shown and edited on page 09c KIT.
  Its design language is documented in
  [`design_library/apc-minimal/README.md`](../design_library/apc-minimal/README.md).

## API (`/api/v1/*`, GET plus guarded POST writes)

| Endpoint | Content |
|---|---|
| `/api/v1/meta` | hub/framework versions, repo root, setup state |
| `/api/v1/config` | live + example config, resolved + verified paths |
| `/api/v1/plugins` | all plugin summaries (config-resolved dirs) |
| `/api/v1/plugins/:name` | full `status.json` + artifact listing |
| `/api/v1/skills` | `.agents/skills/` inventory (legacy flagged) |
| `/api/v1/commands` | workflows: primaries + alias resolution check |
| `/api/v1/designs` | `design_library/manifest.json` passthrough (+ `tokensExists` / `specExists` per design) |
| `/api/v1/scripts` | `scripts/` inventory with synopses |
| `/api/v1/templates` | `templates/` tree |
| `/api/v1/tools` | JUCE/pluginval/visage presence + live toolchain |
| `/api/v1/docs` | chapter index over `docs/*.md` |
| `/api/v1/docs/:id` | raw markdown (rendered client-side) |
| `/api/v1/update` | installed vs latest GitHub release (cached 24h, `?refresh=1` forces) |
| `/api/v1/consistency` | tidy-up radar checks |
| `/api/v1/standards` | standards registry (`schemas/apc-standards.json`) + global block (`apc.config.json`) + per-plugin blocks (`status.json`) + effective value and source per option |
| `POST /api/v1/config` | save full config (validated, `.bak` backup); an optional `standards` block is validated against the registry (global-scope ids, typed values) |
| `POST /api/v1/plugins/:name/annotations` | save review annotations to the plugin's design folder |
| `/preview/:design/:file` | design preview assets in a new tab |
| `/api/v1/kit` | UI kit catalog: components (docs, markup, options, events, bridge functions, standards ids, demo scene), mock scenarios, design-library themes with derived tokens, standards coverage, and an `issues` list when catalog and kit disagree |
| `/kit/<file>` | allow-listed `*.js` / `*.css` of `templates/webview/apc-ui/` (no `tests/`, no markdown) |
| `/kit-theme/<id>.css` | `design_library/<id>/tokens.css` served as-is (designs without one: kit tokens derived from `design-system.json`) |
| `/kit-demo/<component>` | generated demo page (`?theme=&scenario=&mode=`), CSP `default-src 'self'` |
| `/kit-demo/_reference` | the canonical APC Minimal source, `hub/_design/apc_filter_f30_annotate_v006.html`, served byte-for-byte (`?surface=night|day`); source-only CSP permits its inline code and denies network access |
| `/kit-reference/<file>` | allow-listed `*.js` / `*.css` / `*.svg` / `*.png` of `templates/webview/apc-ui/reference/` (one path segment, no traversal) |
| `/api/v1/design/<id>` | one design: `tokens.css`, parsed `design-system.json`, and the supported element tuning controls |
| `POST /api/v1/design/<id>/tuning` | save validated numeric per-element overrides into `design-system.json`; loopback guard, revision check, and `.bak` backup |

## Standards page (`09b STANDARDS`)

Lists every option of the locked Plugin Product Standards (decision X-06) with
its decision id, scope, summary, current value and the file the value comes
from (`schemas/apc-standards.json` default, `apc.config.json` global,
`<plugin>/status.json` plugin).

- **Global-scope options are editable** (toggle / select / number). `[SAVE
  GLOBAL]` re-reads `apc.config.json`, merges the changed keys into its
  `standards` block and POSTs it to `/api/v1/config`. The server rejects unknown
  ids, wrong JSON types, out-of-range or non-enum values and plugin-scope ids
  (HTTP 400, `invalid-standards`, file untouched). `[DEFAULT]` removes an
  override so the registry default applies again.
- **Plugin-scope options are read-only.** Those answers are decided once per
  plugin in `/apc-plan`; the page shows the CLI to change them, e.g.
  `apc standards set <id> <value> --plugin <Name>`.
- **Open decisions** (registry `status: "open"`, e.g. L-06/L-07) carry an
  `[OPEN] placeholder` marker: their values are not commitments.
- A missing registry renders `[NOT FOUND]` with the expected path.

Deep links such as `http://localhost:4872/#09b-standards` work.

## KIT page (`09c KIT`)

Where a design is defined, previewed and tweaked. The page has four parts, top to bottom:

1. **APC Minimal reference** - the canonical v006 design source, full width.
2. A tab strip: **COMPONENTS**, **THEME EDITOR**, **ELEMENT SPEC**, **COVERAGE**.
3. The selected tab.
4. Catalog issues (only when the catalog and the kit disagree).

The component gallery runs on the kit's mock backend (`apc-mock.js`, no network) in sandboxed
`<iframe sandbox="allow-scripts allow-same-origin">` pages served by the Hub. The reference itself is the
single source file at `hub/_design/apc_filter_f30_annotate_v006.html`, served unchanged. Theme-token drafts stay in
`localStorage` and export to clipboard or download. Element tuning is saved to the selected design library
through its guarded Hub endpoint.

### Canonical design source (top of the page)

The APC Minimal design library is named in the Hub around this source. The reference page remains the original
**APC FILTER F-30** face: a 120 x 70 grid, `1 rem` per cell, with its product structure, styling, inline simulation
and interactions. It declares its 30/30 element coverage and includes Night/Day, specimen anatomy, transport,
filter, graph, spectrum, meter, XY, sequence and envelope details. The COMPONENTS tab remains the kit gallery and
documents additional registered components separately.

The Hub toolbar provides **Night / Day**, **Scale**, an element locator, **Reload** and **Open Source**. The source
retains its Night/Day controls, T/A/Space/Esc keyboard controls and annotation interactions. The iframe loads when
the page is opened, not at Hub start.

`hub/_design/apc_filter_f30_annotate_v006.html` is the sole visual source of truth for APC Minimal. 09c serves
the bytes unchanged; it does not substitute another page or copy its styles into a second reference. The APC
Minimal library name and editable token/element documentation are presented around this source. The focused Hub
checks verify byte-for-byte serving, the source element types, its 120:70 grid, and token/tuning routes.

### COMPONENTS tab

- **Left:** every component, grouped as in the catalog. Entries marked `(api)` are behaviours of other
  components (the context panel), not `data-apc` components.
- **Demo:** the component on its own demo page. Selectors: **scenario** (only where it matters), **scale**
  (50 / 100 / 200 / 300 %), **viewport** night / day. A design select appears only when `design_library/`
  has more than one design; with the one shipped design the bar just reads `Design: apc-minimal`. A status line
  reports how many kit elements mounted, whether the expected DOM is present and how many error toasts show.
- **Docs below the demo:** summary, markup snippet with a copy button, options, events, bridge functions it
  uses, gesture / keyboard map, the standards decision ids it implements and its source files.

### THEME EDITOR tab

Live-editable design tokens of the selected design, read from `design_library/<id>/design-system.json`
(`tokenGroups`, `tokens`, `fontsets`, `contrast.pairs`) and `tokens.css`. One row per token with its
description: colours get a picker, a text field and an alpha field (for `rgba()` values); lengths and numbers a text
field; fonts a select of the design's `fontsets` plus free text; a per-token `[RESET]` and a `used by N` button
that opens the ELEMENT SPEC filtered to the elements that use the token.

- **Mode:** the editor edits the night or the day set, whichever the viewport shows (the viewport buttons are shared).
- **Live preview:** a component preview stays beside the token list while you scroll. In Auto mode, focusing a token
  switches to a component that uses it; the preview updates on every slider drag or value edit without reloading.
  Choose another component from the preview menu at any time.
- **Readable groups:** token groups collapse, and the filter / **CHANGED ONLY** controls narrow the list. A search
  opens matching groups automatically.
- **Live:** every change sets the CSS custom property on the reference plugin's `<html>` (and on any open demo,
  pinned component or spec preview) - no reload; canvases redraw. Drafts persist in `localStorage` per design.
- **Contrast panel:** WCAG ratios of the design's `contrast.pairs` for the mode, recomputed from the current values,
  with `[PASS]` / `[FAIL]` chips against each pair's minimum.
- **`[RESET ALL]`** (asks twice) clears the draft.
- **Export:** `[COPY tokens.css]` / `[DOWNLOAD tokens.css]` write a complete `tokens.css` for both modes built from
  the original file (comments and layout preserved, only the changed values replaced); `[DOWNLOAD changes.json]`
  carries the changed token maps in the `design-system.json` shape (`tokens.night`, `tokens.day`).
  To use the result: save it as `design_library/<your-id>/tokens.css` (copy `design_library/apc-minimal/` for the
  folder layout) and add the design to `design_library/manifest.json` - or ask your agent: *"create a design from
  this theme"* and give it the exported changes.

A design without `tokenGroups` still works: tokens are grouped by the section banners of its `tokens.css` and
their kind is inferred from the value.

### ELEMENT SPEC tab

`design-system.json` -> `elements` rendered as a spec sheet, ordered by `groups`: for each element a card with a
live mini preview, its **parts -> tokens**, **states**, sizes, options and accessibility. Expand **ADJUST THIS
ELEMENT** to tune supported line thickness, corner radius, control height, element dimensions and control-specific
sizes such as knob diameter/arc, slider length/track/thumb and visualisation nodes. The sliders update open Hub
previews immediately. `[SAVE TO APC MINIMAL LIBRARY]` writes these numeric overrides to `elementTuning` in the
selected design's `design-system.json`; the Hub validates names, ranges, steps and the file revision, then keeps a
`.bak` copy. The reset controls restore library values. Colours stay global in the THEME EDITOR. A filter box
searches names, groups and tokens.

### COVERAGE tab

Each baseline UX item of the locked standard pack, the kit component that implements it and the test page that
covers it, with an honest status (`[OK]` kit, `[PART]` kit plus native part, `[NONE]` not in the kit yet).

### Designs

The framework ships one design, **APC Minimal** (`apc-minimal`): deep teal surfaces, a coral signal, cyan status and
series colours, restrained rounded corners and subtle material depth (design language:
[`design_library/apc-minimal/README.md`](../design_library/apc-minimal/README.md)). Its `tokens.css`
is served unchanged except for pointing its bundled font URLs at the Hub's same-origin copy, so the page shows
exactly what a plugin gets; it defines both night and day. To start your own
design, copy `design_library/apc-minimal/` and register it in `design_library/manifest.json` (or export from the
theme editor). A design without `tokens.css` falls back to tokens derived from its `design-system.json` for its
own mode only; the viewport button of a mode a design does not define is disabled (API field `modes`).

### `05 DESIGNS` and `09c KIT`

`05 DESIGNS` indexes `design_library/` (manifest, colours, files). It carries a note that designs are defined,
previewed and tweaked in 09c KIT, shows whether each design's `tokens.css` and `design-system.json` exist, and links
`[open in KIT]` per row (opens 09c with that design selected).

### Invariants

Missing data renders `[NOT FOUND]` with the expected path: the kit folder, `hub/kit-catalog.json`,
`design_library/manifest.json`, a design's `tokens.css` or `design-system.json`, the reference folder, a component
script or a test page. The page keeps no state on the server; selection and drafts live in `localStorage`.

Deep link: `http://localhost:4872/#09c-kit`. The catalog is `hub/kit-catalog.json` (hand-maintained docs and demo
scenes; registered component names and scenarios are re-derived from the kit on every request, and
`test/hub-kit.test.js` fails when they disagree). How to add a component: `.agents/guides/hub-kit.md`.

KIT invariants: no process execution; the only KIT write is the revision-checked, schema-limited tuning endpoint;
`/kit/` serves only root-level `*.js` / `*.css`
plain files of the kit folder (traversal, symlinks, `tests/` and markdown are refused); `/kit-reference/` serves only
the allow-listed files of `reference/`; demo pages are static output with CSP `default-src 'self'`, no
external URLs and no inline script. The one exception is `/kit-demo/_reference`: it serves the v006 source
byte-for-byte, so its route-specific CSP permits that file's own inline script and style while still denying
all network connections (`connect-src 'none'`, no external URLs).

## Layout

```
hub/
  server.js        # static + API server (loopback; GET + guarded config/annotation/element-tuning writes)
  kit-catalog.json # docs + demo scenes + standards coverage for the KIT page
  kit-tuning.js    # allow-list + ranges for 09c ELEMENT SPEC tuning (validated server-side)
  ui/              # live app: index.html, app.js (pages), kit.js (09c KIT), css/*.css
  _design/         # Hub shell design (hub_design_*) + APC Minimal source (apc_filter_f30_*_v006)
  README.md        # folder overview
```

## Later (not in v1)

Action buttons (build/validate/backup) and the full
plugin-development workbench stay under the same `/apc-hub` command.
