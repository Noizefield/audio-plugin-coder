# APC Hub

APC Hub is the live local dashboard for the framework - a read-only command
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
- **Read-only.** The server binds loopback `127.0.0.1`, answers GET only,
  and never writes, builds, or executes anything.
- **Live.** Every view is rendered from `/api/v1/*` on load: edit a
  `status.json`, doc, or config value and it shows up on reload. No rebuild.
- **One write path.** Everything is read-only except the Settings form,
  which POSTs the full structured config to `/api/v1/config`
  (shape-validated, backs up `apc.config.json` to `.bak` first).
- **Design language.** APC RASTER as approved in `hub/_design/`
  (`hub_design_spec_v009.md`): rectangles only, ASCII-first tokens,
  dark default + light alternate, amber = active/warning, phosphor green =
  ok/good.

## API (`/api/v1/*`, GET only)

| Endpoint | Content |
|---|---|
| `/api/v1/meta` | hub/framework versions, repo root, setup state |
| `/api/v1/config` | live + example config, resolved + verified paths |
| `/api/v1/plugins` | all plugin summaries (config-resolved dirs) |
| `/api/v1/plugins/:name` | full `status.json` + artifact listing |
| `/api/v1/skills` | `.agents/skills/` inventory (legacy flagged) |
| `/api/v1/commands` | workflows: primaries + alias resolution check |
| `/api/v1/designs` | `design_library/manifest.json` passthrough |
| `/api/v1/scripts` | `scripts/` inventory with synopses |
| `/api/v1/templates` | `templates/` tree |
| `/api/v1/tools` | JUCE/pluginval/visage presence + live toolchain |
| `/api/v1/docs` | chapter index over `docs/*.md` |
| `/api/v1/docs/:id` | raw markdown (rendered client-side) |
| `/api/v1/update` | installed vs latest GitHub release (cached 24h, `?refresh=1` forces) |
| `/api/v1/consistency` | tidy-up radar checks |
| `POST /api/v1/config` | save full config (validated, `.bak` backup) |
| `/preview/:design/:file` | design preview assets in a new tab |

## Layout

```
hub/
  server.js        # static + API server (loopback, GET-only)
  ui/              # live app: index.html, app.js, css/*.css
  _design/         # approved design language + versioned mockups
  README.md        # folder overview
```

## Later (not in v1)

Action buttons (build/validate/backup), config editing, and the full
plugin-development workbench stay under the same `/apc-hub` command.
