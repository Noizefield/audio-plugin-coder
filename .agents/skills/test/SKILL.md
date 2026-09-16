---
name: test
description: Run the APC testing and validation workflow for an audio plugin after implementation, including testing gates and results.
---

# Test - Plugin Testing & Validation

**Trigger:** `/test [PluginName]`
**Phase:** Testing (can run after Implementation)
**Primary Skill:** `.claude\skills\skill_testing\SKILL.md`

---

## EXECUTION

When invoked, execute the complete workflow from:
**`.claude\skills\skill_testing\SKILL.md`**

## WORKFLOW GATES

See `.claude\workflows\test.md` for:
- Prerequisites (requires completed Implementation phase)
- Test procedures
- Validation criteria

## PARAMETERS

- `PluginName` - Name of existing plugin to test

## OUTPUT

- Test results
- Validation report
- Updates `$PluginPath/status.json` with test status

## TEST TYPES

- Build validation
- Parameter range testing
- UI/DSP integration verification
- DAW compatibility check
