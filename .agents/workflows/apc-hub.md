---
description: "Open the APC Hub live dashboard (read-only command center)"
---

# APC Hub

**Preferred model:** Read `apc.config.json` -> `models.phases.status` and announce it.

**Setup gate:** If `setup.completed` is false, suggest `/apc-setup` once. Setup owns all toolchain checks - do not re-verify anything here.

**Start** (pick one for the platform):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\apc-hub.ps1 [-Port 4872] [-NoOpen]
```

```bash
bash scripts/apc-hub.sh [--port 4872] [--no-open]
```

**Done:** report `-> Dashboard at http://localhost:<port>/` and stop. No validation probes, no follow-ups.
