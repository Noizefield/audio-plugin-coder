---
description: "Decompose a goal and orchestrate APC subagent workers in parallel"
---

# Orchestrate
**Preferred model:** Read `apc.config.json` -> `models.phases.orchestrate` if present (announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).

**Prerequisites:**
```powershell
# If the goal names a plugin, resolve and read its state first:
. "$PSScriptRoot\..\scripts\state-management.ps1"
$PluginPath = Get-ApcPluginPath -PluginName $PluginName
$state = Get-PluginState -PluginPath $PluginPath
# Respect current_phase and ui_framework; never delegate edits to a
# frozen (ship_complete) plugin — open a generation via /apc-patch or
# /apc-evolve first.
```

If worker profiles are missing for your host, run the adapter sync once:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-agents.ps1
```

```bash
bash scripts/sync-agents.sh
```

**Execute Skill:**
Load and execute `.agents/skills/orchestrate/SKILL.md`

**Completion:**
```
✅ Orchestration complete!

Workers: [count + profiles used]
Result: [pass/fail summary per wave]
Files changed: [list]
Verification: [build/test outcome]

Next step: /apc-test [Name] if plugin code changed
```
