---
description: "Open the APC Hub live dashboard (read-only command center)"
---

# APC Hub

**Preferred model:** Read `apc.config.json` -> `models.phases.status` (announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).

**What this does:** starts the zero-dependency local hub server (`hub/server.js`, Node stdlib only, loopback `127.0.0.1`, GET-only API) and opens the live dashboard — projects, skills, commands, designs, scripts, templates, tools, settings, documentation, consistency. Read-only: the server never writes, builds, or executes.

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\apc-hub.ps1
```

Optional flags: `-Port 4872` (default), `-NoOpen` (don't open the browser).

**macOS / Linux (Bash):**

```bash
bash scripts/apc-hub.sh
```

Optional flags: `--port 4872` (default), `--no-open`.

**Direct (any platform, Node ≥ 18 required):**

```bash
node hub/server.js --port 4872
```

**Completion message:** report `→ Dashboard at http://localhost:<port>/` and stop. Do not start a next phase; the hub is the destination.
