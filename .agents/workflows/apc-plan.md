---
description: "PHASE 2: Architecture - Define structure and UI framework"
---

# Plan Phase (Architecture)
**Preferred model:** Read `apc.config.json` -> `models.phases.plan` (announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).


**Prerequisites:**
1. Validate: `Test-PluginState -PluginPath $PluginPath -RequiredPhase "ideation"`
2. Check required files exist from ideation phase

**Execute Skill:**
Load and follow `.agents/skills/plan/SKILL.md` exactly.

**CRITICAL UI Framework Decision:**
- Read user requirements
- If user has not explicitly chosen, ASK: "Use WebView2 (HTML/JS) or Visage (native C++)?"
- Determine: VISAGE (pure C++) or WEBVIEW (hybrid)
- Update status.json with framework selection
- Set complexity score (1-5)

**Format Decision (CLAP opt-in):**
- If user has not stated a preference, ASK: "Also build a CLAP version?"
- If yes: record `formats.clap=true`, `formats.clap_id` (`clap.id_prefix` from
  apc.config.json + plugin slug) and `formats.clap_features` in status.json.
- See `.agents/skills/plan/SKILL.md` step 3.1b for the feature mapping.

**Guided configuration (product standards):**
- The locked standards (`apc-standards/1.0`) split into global defaults (set in
  `/apc-setup`) and plugin options that are asked ONCE here.
- Get the unanswered questions with `apc standards plan --plugin <Name>`.
- Record each answer with `apc standards set <id> <value> --plugin <Name>`.
- Required answers: `preset.hierarchy`, `preset.data_root`, `license.mode`.
- Validate with `apc standards validate --plugin <Name>` before completing.

**Success Criteria:**
- `status.json` updated with `ui_framework` = "visage" or "webview"
- `status.json` updated with `formats.clap` (opt-in decision recorded)
- `status.json` updated with `standards` (plugin-scope answers)
- Architecture document created
- Framework selection rationale documented

**After completion:**
Stop and inform user: "Plan phase complete. Framework selected: [X]. Use `/apc-design [Name]` to continue."
