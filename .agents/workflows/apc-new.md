---
description: "Complete plugin development from idea to shipped product"
---

# New Plugin - Full Workflow
**Preferred model:** Read `apc.config.json` -> `models.phases.new` (announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).


**This workflow guides you through all phases with user confirmation at each step.**

**Usage:** `/apc-new [PluginName]`

---

## Phase 1: Dream ≡ƒÆ¡
Execute `/apc-dream [PluginName]`

**STOP** - Review creative brief and parameters
**Continue?** User must approve before proceeding

---

## Phase 2: Plan ≡ƒôï
Execute `/apc-plan [PluginName]`

**CRITICAL:** UI framework selection happens here
**Ask user:** "Use WebView2 (HTML/JS) or Visage (native C++)?"
**STOP** - Review architecture and framework choice
**Continue?** User must approve before proceeding

---

## Phase 3: Design ≡ƒÄ¿
Based on framework selected:
- **Visage:** Execute Visage design workflow
- **WebView:** Execute WebView design workflow

**STOP** - Preview and approve design
**Continue?** User must approve before proceeding

---

## Phase 4: Implementation ≡ƒÆ╗
Execute `/apc-impl [PluginName]`

**Build and test** - Verify plugin loads and works
**STOP** - Test in DAW
**Continue?** User must approve before proceeding

---

## Phase 5: Ship ≡ƒÜÇ
Execute `/apc-ship [PluginName]`

**COMPLETE** - Plugin is packaged and ready!

---

**Note:** You can exit at any phase and resume later with `/apc-resume [PluginName]`

**Emergency:** If something breaks, use `/apc-status [PluginName]` to check state
