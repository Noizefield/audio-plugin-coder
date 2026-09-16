---
name: skill-testing
description: Perform APC plugin stability checks with pluginval, crash analysis, manual DAW checks, and build-error triage as part of testing.
---

# SKILL: TESTING

**Goal:** Stability Check.

## TASKS
1.  **Pluginval:** Run validation script.
2.  **Crash Analysis:** If crash reported, read Documents/APC_CRASH_REPORT.txt.
3.  **Manual Check:** Ask user to load in DAW and move knobs.
4.  **Build-Error Triage:** On any build/test failure, parse output with
    `scripts/error-detection.ps1` (`Parse-BuildErrors`, Windows) or
    `scripts/error-detection.sh` (`parse_build_errors`, macOS/Linux),
    then match via `Find-KnownIssue` / `find_known_issue` against
    `.agents/troubleshooting/known-issues.yaml` before trial-and-error fixes.
