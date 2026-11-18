# APC Hub (`hub/`)

Live local dashboard for the framework. See `docs/hub.md` (user doc),
`_design/hub_design_spec_v012.md` (latest spec of the Hub's own shell design, APC RASTER) and
`design_library/apc-minimal/README.md` (the APC Minimal plugin-UI design language shown on 09c KIT).

```
hub/
  server.js        # Node-stdlib static + /api/v1/* server (loopback; GET + 3 guarded write paths)
  kit-catalog.json # hand-maintained catalog behind the KIT page (docs, demo scenes, standards coverage)
  kit-tuning.js    # allow-list + ranges for 09c ELEMENT SPEC tuning
  ui/              # live app
    index.html     # shell: header, sidebar, content, footer
    app.js         # vanilla JS: fetch API, render sections, docs reader
    kit.js         # the 09c KIT page: canonical source stage, tabs, theme editor, element spec, component gallery
    css/           # tokens, themes, base, layout, shell, components, docs, standards, kit
  _design/         # Hub shell: hub_design_spec_v001…v012 + mockups v001…v009 + CHANGELOG
                   # APC Minimal ("Zeichnung 2030") plugin face, approved round v006:
                   #   apc_filter_f30_annotate_v006.html (canonical reference, served by 09c)
                   #   apc_filter_f30_mockup_v006.html   (approved plate quoted by the kit CSS)
                   #   apc_filter_f30_spec_v006.md       (review notes and decisions)
  README.md        # this file
```

Run: `/apc-hub` in the agent, or `node hub/server.js --port 4872`.
Read-only by default except three guarded write paths: `POST /api/v1/config`
(Settings form + the **09b STANDARDS** page, global-scope standards only,
validated against `schemas/apc-standards.json`, `.bak` backup) and the review
tool's `POST /api/v1/plugins/:name/annotations`, plus validated per-element tuning
from **09c KIT** at `POST /api/v1/design/:id/tuning` (design-system backup).
Writes need a loopback peer,
Host and Origin. No builds, no script execution.

**09c KIT** is where APC Minimal is referenced, previewed and tuned (`hub/_design/` + `templates/webview/apc-ui/` + `design_library/`):

- **Reference** (top, full width): the unchanged 120 x 70 APC Minimal visual source in
  `hub/_design/apc_filter_f30_annotate_v006.html`. This is the sole visual source of truth; the library is named
  **APC Minimal** in the Hub. Night / Day, scale, element locator, reload and open-source controls surround it.
- **Tabs:** COMPONENTS (one demo page per component, docs, markup), THEME EDITOR (live global design tokens, WCAG contrast,
  export of `tokens.css` / changes), ELEMENT SPEC (`design-system.json` -> `elements`, editable geometry and line weight saved in `elementTuning`), COVERAGE
  (standards table).
- **05 DESIGNS** indexes `design_library/` and links each design to this page (`[open in KIT]`).

Read routes: `GET /api/v1/kit`, `GET /api/v1/design/<id>` (`tokens.css` text + parsed `design-system.json` + tuning schema),
`GET /kit/<file>` (allow-listed kit `*.js` / `*.css` only), `GET /kit-theme/<id>.css` (the design's `tokens.css`;
fallback: tokens derived from `design-system.json`), `GET /kit-demo/<component>?theme=&scenario=&mode=` and
`GET /kit-demo/_reference?surface=night|day` (canonical source bytes; inline-script CSP scoped to this route, no network), `GET /kit-reference/<file>`
(allow-listed files of the reference folder), `POST /api/v1/design/<id>/tuning` (validated numeric overrides, revision checked, `.bak` backup). Theme-token drafts stay in `localStorage` and export is clipboard or download. Add a component: `.agents/guides/hub-kit.md`; user doc: `docs/hub.md`.

Tests: `node --test test/hub-standards.test.js test/hub-kit.test.js test/hub-reference.test.js` (start the server
on an ephemeral port with `--port 0`, fixture roots via `APC_ROOT`; the KIT test
also drives headless Edge / Chrome and skips cleanly without one).
