---
description: "PHASE 3: Design - Create UI mockups based on selected framework"
---

# Design Phase

**Prerequisites:**
```powershell
. "$PSScriptRoot\..\scripts\state-management.ps1"

$state = Get-PluginState -PluginPath "plugins\$PluginName"

if ($state.current_phase -ne "plan_complete") {
    Write-Error "Planning phase not complete. Run /plan first."
    exit 1
}

if ($state.ui_framework -eq "pending") {
    Write-Error "UI framework not selected. Complete /plan first."
    exit 1
}
```

**Framework Router:**

**FOR ALL FRAMEWORKS (Visage and WebView):**
- Load `...agent\skills\skill_design\SKILL.md`
- Create framework-agnostic design specifications and a framework-appropriate preview
- NO production framework-specific code generation
- Design phase focuses on creative iteration and approval

**Framework-specific notes:**
- **WebView:** Generate `Design/v1-test.html` preview.
- **Visage:** Do NOT generate HTML. Ask to generate a Visage preview scaffold (default Yes).

**Validation:**
- Verify Design/ folder exists with appropriate files
- Verify v1-ui-spec.md exists
- Verify v1-style-guide.md exists

**Completion:**
```
✅ Design phase complete!

Framework: [Visage/WebView]
Design version: v1

Preview commands:
- Visage: .\scripts\preview-design.ps1 -PluginName [Name]
- WebView: Open plugins\[Name]\Design\index.html in browser

Next step: /impl [Name] (after design approval)
```

