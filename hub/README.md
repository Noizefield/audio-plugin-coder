# APC Hub (`hub/`)

Live local dashboard for the framework. See `docs/hub.md` (user doc) and
`_design/hub_design_spec_v009.md` (approved design language).

```
hub/
  server.js        # Node-stdlib static + /api/v1/* server (loopback, GET-only)
  ui/              # live app
    index.html     # shell: header, sidebar, content, footer
    app.js         # vanilla JS: fetch API, render sections, docs reader
    css/           # tokens, themes, base, layout, shell, components, docs
  _design/         # spec + versioned static mockups (v001…v009) + CHANGELOG
  README.md        # this file
```

Run: `/apc-hub` in the agent, or `node hub/server.js --port 4872`.
Read-only by design: no writes, no builds, no script execution.
