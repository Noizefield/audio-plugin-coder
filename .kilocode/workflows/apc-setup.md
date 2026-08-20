---
description: "APC first-run setup â€” toolchain, paths, models, JUCE verification"
---

# APC Setup Phase

**Prerequisites:** None (framework entry point â€” run before `/apc-dream`)

**Preferred model:** economy (see `apc.config.json` â†’ `models.phases.setup`)

**Execute Skill:**
Load and execute `..kilocode/skills/apc-setup/SKILL.md`

**Validation:**

- `apc.config.json` exists
- `setup.completed` is true
- System-check reports critical tools OK (or user accepted warnings)
- Path helpers resolve plugins/build/release

**Completion:**
Stop and inform user:

```
APC setup complete.
Next: /apc-dream <PluginName>
```

**Deprecated alias:** `/setup` â†’ use `/apc-setup`


