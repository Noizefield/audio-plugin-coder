---
description: "PHASE 3: Design - Create UI mockups based on selected framework"
---

# Design Phase
**Preferred model:** Read `apc.config.json` -> `models.phases.design` (announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).


**Prerequisites:**
```powershell
. "$PSScriptRoot\..\scripts\state-management.ps1"
$PluginPath = Get-ApcPluginPath -PluginName $PluginName

$state = Get-PluginState -PluginPath $PluginPath

if ($state.current_phase -ne "plan_complete") {
    Write-Error "Planning phase not complete. Run /apc-plan first."
    exit 1
}

if ($state.ui_framework -eq "pending") {
    Write-Error "UI framework not selected. Complete /apc-plan first."
    exit 1
}
```

**Framework Router:**

**FOR ALL FRAMEWORKS (Visage and WebView):**
- Load `.agents/skills/design/SKILL.md`
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

**Design library:** the framework ships one design, `apc-minimal` (`design_library/apc-minimal/`; `tokens.css` = token contract). Copy its folder to start your own design and register it in `design_library/manifest.json`.

**Standard UI kit (WebView):** use `templates/webview/apc-ui/` (contract: `CONTRACT.md`; guides `ui-kit-controls.md`, `ui-kit-widgets.md` (button, buttons, segmented, checkbox, radio, dropdown, menu, tabs, textfield, numberfield, label, readout, panel, divider, led, progress, list, logo), `ui-kit-viz.md` (graph, envelope, spectrum, waveform, scope, meter, stepseq, xypad, picture), `ui-kit-panels.md`; browse it live in the Hub at `#09c-kit` after starting the Hub with `/apc-hub`). The kit ships one design, APC Minimal; **every element is specified by tokens in `design_library/apc-minimal/design-system.json` `elements`** (parts, states, sizes, options, a11y) and every token of the design is listed in its `tokenGroups`. Do NOT hand-build knobs, buttons, dropdowns, tabs, fields, meters, graphs, sequencers, context menus, settings overlays, preset browsers, activation/update dialogs, version footers or grippers - mount the kit components (`data-apc="knob"` etc.) and only supply layout (ui-map) and theme tokens (design_library). Accent-coloured text uses `--accent-text`. Verify with `node bin/apc.js kit test`.

**Preview loop and accessibility (WebView):**
```bash
node bin/apc.js watch <Name>                       # debounced compose + lint + live reload
node bin/apc.js screenshot <Name> --scale 50,100,300   # deterministic shots; --compare <baseline.png> for visual diff
node bin/apc.js validate a11y --plugin <Name>      # contrast (all themes), keyboard reach, names, focus, reduced motion
```
Guides: `.agents/guides/preview-loop.md`, `.agents/guides/a11y-perf.md`. Interactive controls need `tabindex` + an accessible name; the version string must be visible in the footer; help/quick-save need visible buttons.

**Completion:**
```
Γ£à Design phase complete!

Framework: [Visage/WebView]
Design version: v1

Preview commands:
- Visage: .\scripts\preview-design.ps1 -PluginName [Name]
- WebView: Open `$PluginPath/Design/index.html` in browser

Next step: /apc-impl [Name] (after design approval)
```
