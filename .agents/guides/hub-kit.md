# Hub KIT page: showing a UI kit component in the Hub

The APC Hub page **09c KIT** is the live gallery and design-library editor for the WebView UI kit in `templates/webview/apc-ui/`. Its APC Minimal reference is the unchanged, single visual source `hub/_design/apc_filter_f30_annotate_v006.html`; the other tabs show kit demos, element documentation and standards coverage. Global colours and type live in `tokens.css`; validated per-element geometry and line tuning is saved into `design-system.json`. The Hub is loopback-only and offline.

Open it: `/apc-hub`, then `http://localhost:4872/#09c-kit`. User-facing summary: `docs/hub.md` (section "KIT page").

## How the page is fed

| Piece | Source | Maintained by |
|-------|--------|---------------|
| Registered component names + the file each lives in | `APC.register("name", ...)` in `templates/webview/apc-ui/*.js` | derived on every request |
| Mock scenarios | `var SCENARIOS = {...}` in `apc-mock.js` | derived on every request |
| Bridge functions the mock implements | `F["apc.x"] = ...` in `apc-mock.js` | derived, used to validate the catalog |
| Themes | `design_library/manifest.json` + `<theme>/tokens.css` (fallback: `<theme>/design-system.json`) | derived (tokens, see below) |
| Docs, markup, options, events, bridge list, gestures, standards ids, demo scene, test pages | **`hub/kit-catalog.json`** | by hand (this guide) |
| Visual spec of every element (parts, states, sizes, tokens, a11y), `elementTuning`, `groups`, `tokenGroups`, `fontsets`, `scales` | `design_library/apc-minimal/design-system.json`; `scripts/design-tokens-check.js` + `test/design-tokens.test.js` check the spec and token references | element descriptions by hand; numeric tuning saved from 09c |
| Standards coverage rows | `coverage` in `hub/kit-catalog.json` (summarised from `.agents/rules/product-standards.md`; `plans/` is gitignored and never read at runtime) | by hand |

`GET /api/v1/kit` merges them and adds an `issues` list. **The page and `test/hub-kit.test.js` fail when the catalog and the kit disagree**, so drift is caught by the same test run that guards the kit.

## Routes (`Cache-Control: no-store`; writes are guarded)

| Route | Serves |
|-------|--------|
| `/api/v1/kit` | the merged catalog (`kitFound`, `components[]`, `scenarios`, `themes`, `coverage`, `issues`; `[NOT FOUND]` data + the expected path when a folder or file is missing) |
| `/kit/<file>` | **only** root-level `*.js` / `*.css` of the kit folder. The allow-list is the directory listing: plain files only (no symlinks, no `tests/`, no `.md`, no `.html`); one path segment matching `^[A-Za-z0-9][A-Za-z0-9_-]*\.(js\|css)$`, so `..`, `%2e%2e`, `\`, drive letters, NUL and leading dots are refused (403) |
| `/kit-theme/<id>.css` | `design_library/<dir>/tokens.css` served as-is; only a design WITHOUT a `tokens.css` falls back to tokens derived from its `design-system.json` |
| `/kit-demo/<component>?theme=&scenario=&mode=` | generated, self-contained demo page. `theme` = `default` or a manifest id, `scenario` = a mock scenario, `mode` = `night` or `day` (default: the theme's own appearance). Anything else is rejected (400/404) and never echoed. CSP: `default-src 'self'` (+ inline styles, no network, `frame-ancestors 'self'`) |
| `/kit-demo/_reference?surface=night|day` | the exact v006 source file, with no HTML/CSS rewrite. It has a route-specific CSP for the source's inline CSS/JS and denies network access. |
| `/kit-demo/_early.js`, `_setup.js`, `_post.js` | the three small boot scripts of a demo page (hub code, not kit files) |
| `/api/v1/design/<id>/tuning` (POST) | validated numeric per-element overrides in the design spec; loopback peer/Host/Origin, revision check, and a `.bak` backup |

Every demo page links `apc-core.css`, `apc-components.css`, `apc-widgets.css`, `apc-viz.css` (the last two only when the kit folder has them; `KIT_DEMO_CSS` in `hub/server.js`) and then the theme's `tokens.css`. Boot order of a demo page (the Hub test checks it): error capture -> `apc-fit.js`, `apc-kit.js`, `apc-mock.js` (`KIT_CORE_SCRIPTS`) -> `_setup.js` (applies `scenario` and the viewport theme to the mock, so `apc-chrome.js` reads them when it loads) -> the component scripts from the catalog (`demo.scripts`; widgets: `["apc-controls.js", "apc-widgets.js"]`, viz: `["apc-viz.js", "apc-mock-viz.js"]`; `apc-mock-viz.js` feeds animated demo data and is demo-only, it never ships in a plugin) -> `_post.js` (mounts `[data-apc]`, runs the demo `actions`, checks `expect`, sets `data-demo-ready`). Script errors, failed script loads and unhandled rejections become the kit's own `.apc-toast--error`, so a broken page is never silent.

## Theme tokens

The framework ships one design library, `APC Minimal` (`apc-minimal`, `design_library/apc-minimal/`). The visual truth is the v006 annotated face named above, with its 120 x 70 grid and 30/30 source elements. `tokens.css` is the editable global token contract used by the kit; `design-system.json` documents the tokens and element spec, and its optional `elementTuning` stores validated Hub overrides. The Hub reference route serves the source bytes unchanged and maps token/element edits onto the source page at runtime. `test/design-tokens.test.js` guards token and element-spec consistency.

The 09c THEME EDITOR keeps a live component preview beside the token list while scrolling. Auto mode uses `design-system.json` token-use mappings to preview a relevant component when its token control receives focus; every edit updates open previews without reloading. Token groups collapse, and search opens matching groups so long specifications remain navigable.

### Element tuning

The ELEMENT SPEC cards expose only properties the kit CSS can apply safely: line thickness, corner radius, control height, host width/height, knob diameter/arc, slider length/track/thumb, and visualisation node size. Values are numeric, range- and step-checked against the Hub's allowlist in `hub/kit-tuning.js`; colours stay in the global token editor. Drafts preview live and remain local until **SAVE TO APC MINIMAL LIBRARY**. The server checks the design spec revision, writes the changed JSON, and backs up the previous file to `design-system.json.bak`.

To start your own design, copy `design_library/apc-minimal/` to `design_library/<your-id>/`, change the values in `tokens.css` (never the names), mirror them in `design-system.json`, and add an entry to `design_library/manifest.json` (`"tokens": "tokens.css"`, `"spec": "design-system.json"`). The KIT page then lists it in the theme selector.

`GET /kit-theme/<id>.css` serves the design's `tokens.css` verbatim; `GET /api/v1/kit` lists `tokensFile`, `modes` and the parsed token list (source `tokens.css`) for it.

### Fallback: designs without tokens.css

Older-style designs ship only `design-system.json`. The Hub then derives the kit tokens from it and says so on the page, with the source key next to every token:

| Kit token | From (dark theme) | From (light theme) |
|-----------|-------------------|--------------------|
| `--plate` | `palette.surface` | `palette.background` |
| `--plate-2` | `palette.surfaceHighlight` (else `surface`) | `palette.cap` (else `surfaceHighlight`, `surface`) |
| `--surface`, `--inset` | `palette.background` | `palette.surface` |
| `--rule` / `--rule-2` | `palette.border` / `surfaceHighlight` (else `border`) | same |
| `--ink`, `--ink-2` | `palette.textPrimary`, `textSecondary` | same |
| `--accent` | `palette.accent` (else `primary`) | same |
| `--grip-ink` | `palette.border` | same |
| `--r-control`, `--r-panel` | `components.borderRadius` | same |
| `--font-ui` | `typography.fontFamilyBody` | same |

"Dark" means the background's relative luminance is below 0.4. The tokens are emitted for the theme's own mode only (`[data-theme="night"]` or `[data-theme="day"]`); the other mode shows the kit's fallback tokens, which is what a product gets when its design defines one mode only. Values are validated (colour, font and radius patterns) before they reach the CSS. No contrast tuning is applied: check a real design with `apc validate a11y`.

## Add a component to the kit so it appears in the Hub

1. **Write the component** in `templates/webview/apc-ui/` and register it with a literal name: `APC.register("my-widget", function (el, o) { ...; return { dispose: function () {} }; });` (classic script, see `templates/webview/apc-ui/CONTRACT.md`). The scan matches `APC.register("name"` or `'name'`, so computed names are invisible to the Hub: do not use them.
2. **Add a self-test page** under `templates/webview/apc-ui/tests/` and run `node bin/apc.js kit test`.
3. **Add an entry** to `components` in `hub/kit-catalog.json`:

```json no-check
{
  "name": "my-widget",
  "registered": true,
  "group": "Controls",
  "title": "My widget",
  "file": "apc-widgets.js",
  "guide": ".agents/guides/ui-kit-controls.md#markup",
  "summary": "One or two sentences: what it is and which standards rule it carries.",
  "markup": "<div data-apc=\"my-widget\" data-param=\"mix_pct\"></div>",
  "options": [{ "name": "data-param", "required": true, "desc": "Parameter ID." }],
  "events": [{ "name": "ctl:drag", "dir": "out", "payload": "{id, active}", "note": "" }],
  "bridge": ["apc.params.get", "apc.param.set"],
  "gestureSet": "control",
  "scenarios": ["demo", "trial"],
  "standards": ["U-01", "X-09"],
  "demo": {
    "cols": 24, "rows": 10,
    "scripts": ["apc-widgets.js"],
    "body": "<div class=\"apc-cell\" style=\"left:2rem;top:2rem;width:6rem;height:6rem\" data-apc=\"my-widget\" data-param=\"mix_pct\"></div>",
    "actions": [{ "click": "[data-apc=\"my-widget\"]" }],
    "expect": ["[data-apc=\"my-widget\"][role]"],
    "hint": "What to try in the demo."
  },
  "tests": ["kit-a.html"]
}
```

Field rules (`test/hub-kit.test.js` enforces them):

- `name` and `file` must match what `APC.register` found; `group` is one of `groups` (add a group to the top-level `groups` list first if you need one; today: Controls, Widgets, Visualisation, Context & Help, Chrome, Settings, Presets, Dialogs). A component that is added to the kit also needs an entry in `design_library/apc-minimal/design-system.json` `elements` (its look in tokens) and a row in its guide, or `test/design-tokens.test.js` fails.
- `bridge` lists only functions `apc-mock.js` implements (CONTRACT.md names win). An element that never calls the bridge (label, divider, spectrum ...) lists none: an empty `bridge` is allowed for the Widgets and Visualisation groups. The page also shows the functions it finds in the file as a scan.
- Widgets and visualisation elements carry the standards that are really true for them (`U-07` themes via tokens; `U-01` / `U-02` where Alt+click / double-click reset a parameter). `standards` are decision ids (`U-01`, `X-09`, `P-07`, ...); `tests` are file names in `templates/webview/apc-ui/tests/`.
- `scenarios`: `"all"`, a list of mock scenario names, or omit it when scenarios change nothing. The first entry is the default.
- `demo.cols` x `demo.rows` is the plate in grid cells (1 cell = 1 rem = 16 px at 100 %); the Hub scale selector resizes the iframe to cols x rows x 16 px x scale. `demo.body` is HTML placed inside `.apc-plate` (position things with `.apc-cell`). `demo.scripts` is the minimal load list in dependency order (the core scripts and the mock are always loaded first).
- `demo.actions` (optional, run once after mount): `{"click": selector}`, `{"contextmenu": selector}` or `{"emit": "bus:event", "data": {...}}`. Use them for overlays and panels that are closed by default.
- `demo.expect`: CSS selectors that must exist after mount. The browser test and the page's status line fail when one is missing, so choose selectors that prove the component rendered, not just that its host element exists.
- A thing that is not a `data-apc` component (like the context panel) gets `"registered": false` and `"via": ["knob", ...]`.

4. **Add coverage rows** to `coverage` when the component implements a baseline standards item: `section`, `item`, `decisions`, `components`, `tests`, `status` (`kit`, `partial`, `native`, `not-in-kit`) and an optional `note`. A `kit` row must name a component and a test page.
5. **Verify**:

```bash
node --test test/hub-kit.test.js
node bin/apc.js docs check
```

`test/hub-kit.test.js` mounts every demo in headless Edge / Chrome (skips cleanly without one) and fails on any error toast or missing `expect` selector. Look at the result yourself too: `node hub/server.js --port 4872`, open `#09c-kit`, pick the component, switch theme / scenario / scale / day-night.

## Invariants (do not weaken)

- Loopback only. The only KIT write is the schema-limited, revision-checked design tuning route; no process execution. Tests cover validation and write guards.
- `/kit/` serves nothing but root-level `*.js` / `*.css` plain files of `templates/webview/apc-ui/`.
- Demo pages are static output with CSP `default-src 'self'`, no external URLs and no inline script.
- The page never hides a missing file: absent kit folder, catalog, theme, test page or script shows `[NOT FOUND]` plus the expected path.
- Brand-agnostic: demo data comes from `apc-mock.js` ("Example Synth", `example.test`); nothing here may name a real product.

## New kit files: packaging

A new `*.js` / `*.css` in `templates/webview/apc-ui/` is picked up automatically by the Hub (`/kit/<file>`), by `scripts/ui-compose.js` `vendorKit` (copies every file of the folder into `Design/apc-ui/`) and by the plugin bundle in `templates/webview/CMakeLists.txt.template` (fit, kit, bridge first, the rest alphabetical, so a file that needs another must sort after it, as `apc-widgets.js` after `apc-controls.js`). Only demo / test data must stay out of a plugin: name it `apc-mock*.js` (the template filters that pattern). A new stylesheet is added to `KIT_DEMO_CSS` in `hub/server.js` (demo pages) and to the `<link>` list in `scripts/ui-compose.js` (design preview). `test/hub-kit.test.js` ("kit files: ...") fails when a kit file is neither vendored nor deliberately excluded.
