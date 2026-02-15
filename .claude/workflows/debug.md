---
description: "Autonomous debugging and fault isolation for the plugin"
---

# Debug Phase

**Prerequisites:**
```powershell
. "$PSScriptRoot\..\scripts\state-management.ps1"

$state = Get-PluginState -PluginPath "plugins\$PluginName"

if ($state.current_phase -ne "code_complete" -and $state.current_phase -ne "test_failed") {
    Write-Error "Debugging requires completed implementation or failed tests."
    exit 1
}
```

**Execute Skill:**
Load and execute `...kilocode\skills\skill_debug\SKILL.md`

The debugging skill MUST follow the instructions defined in crash.md.

## Debugging Responsibilities (LLM-Enforced)

The LLM operates as an autonomous debugger and must:

- Inspect the full codebase
- Identify high-risk execution paths
- Insert breakpoints where runtime inspection is required
- Generate or update .vscode/launch.json
- Enter Visual Studio Code: debug mode
- Execute the plugin under debugger control
- Capture all runtime diagnostics (no suppression)

## Debug Actions Performed

- Workspace reconnaissance
- Static code risk analysis
- Breakpoint placement (entry points, exception paths, async boundaries)
- Debug configuration generation
- Debug session launch
- Runtime state inspection
- Crash / exception reproduction

## Telemetry Captured

The following artifacts MUST be collected and transmitted to the LLM:

- Breakpoint list (file, line, condition)
- Generated launch.json
- Call stacks at failure
- Variable snapshots
- Thread / async task state
- Full stdout and stderr
- Framework warnings and low-signal logs (tagged, not removed)

No diagnostic output may be discarded.

## Output Artifact

The Debug phase must produce a structured payload:

```json
{
  "workspaceMap": {},
  "debugConfig": {},
  "breakpoints": [],
  "executionTimeline": [],
  "errors": [],
  "rawLogs": "",
  "suspectedRootCauses": [],
  "confidence": 0.0
}
```

## Completion Criteria

Debugging is considered complete ONLY when:

- The failure is reproducible under the debugger
- The exact source line(s) responsible are identified
- The root cause is supported by runtime evidence

## Completion Output

```
🐞 Debugging complete!

Root cause identified: [Yes/No]
Failure reproducible: [Yes/No]
Confidence score: [0.0–1.0]

Next step:
- /fix [Name] if root cause is identified
- /debug [Name] to continue investigation
```

## Notes on Design Choices

- This workflow **intentionally mirrors** your Test workflow's structure to remain idiomatic to Kilo Code.
- It cleanly integrates with `crash.md` instead of duplicating logic.
- It supports both **reactive debugging** (after failed tests) and **proactive debugging** (post-code completion).

## Future Enhancements

If you want, next we can:
- Write `skill_debug/SKILL.md`
- Add a `/debug` command contract
- Chain Debug → Fix → Retest automatically
- Add CI/headless-debug variants

Just say which layer you want to tackle next.
