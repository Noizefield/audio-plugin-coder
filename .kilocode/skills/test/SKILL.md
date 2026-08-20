# Test - Plugin Testing & Validation

**Trigger:** `/test [PluginName]`
**Phase:** Testing (can run after Implementation)
**Primary Skill:** `..kilocode\skills\skill_testing\SKILL.md`

---

## EXECUTION

When invoked, execute the complete workflow from:
**`..kilocode\skills\skill_testing\SKILL.md`**

## WORKFLOW GATES

See `..kilocode\workflows\test.md` for:
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

