---
description: "PHASE 2: Architecture - Define structure and UI framework"
---

# Plan Phase (Architecture)

**Prerequisites:**
1. Validate: `Test-PluginState -PluginPath "plugins\$PluginName" -RequiredPhase "ideation"`
2. Check required files exist from ideation phase

**Execute Skill:**
Load and follow `...kilocode/skills/skill_planning.md` exactly.

**CRITICAL UI Framework Decision:**
- Read user requirements
- If user has not explicitly chosen, ASK: "Use WebView2 (HTML/JS) or Visage (native C++)?"
- Determine: VISAGE (pure C++) or WEBVIEW (hybrid)
- Update status.json with framework selection
- Set complexity score (1-5)

**Success Criteria:**
- `status.json` updated with `ui_framework` = "visage" or "webview"
- Architecture document created
- Framework selection rationale documented

**After completion:**
Stop and inform user: "Plan phase complete. Framework selected: [X]. Use `/design [Name]` to continue."

