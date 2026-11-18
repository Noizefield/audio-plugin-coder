---
description: "APC first-run setup â€” toolchain, paths, models, JUCE verification"
---

# APC Setup Phase

**Prerequisites:** None (framework entry point â€” run before `/apc-dream`)

**Preferred model:** economy (see `apc.config.json` â†’ `models.phases.setup`)

**Execute Skill:**
Load and execute `.agents/skills/apc-setup/SKILL.md`

**Validation:**

- `apc.config.json` exists
- `setup.completed` is true
- System-check reports critical tools OK (or user accepted warnings)
- Path helpers resolve plugins/build/release
- Product standards block present: `apc standards validate` reports no issues
  (global defaults are set in the Advanced Setup step, step 5b)

**Completion:**
Stop and inform user:

```
APC setup complete.
Next: /apc-dream <PluginName>
```

**Deprecated alias:** `/setup` â†’ use `/apc-setup`

