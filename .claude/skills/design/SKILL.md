---
name: skill_design
description: Create the Visual Interface for audio plugins. Use when user mentions UI design, mockup, WebView interface, or requests 'design UI for [plugin]'.
---


# SKILL: GUI DESIGN
**Goal:** Create the Visual Interface for audio plugins.
**Output Location:** `plugins/[Name]/Design/` and `Source/`

---

## 🎨 PHASE 0: DESIGN LIBRARY CHECK

Check if `design_library/manifest.json` exists and count available designs.

**Import state management:**
```powershell
# Import state management module
. "$PSScriptRoot\..\scripts\state-management.ps1"
```

**Validate prerequisites:**
```powershell
# Check that planning phase is complete and framework is selected
if (-not (Test-PluginState -PluginPath "plugins\[Name]" -RequiredPhase "plan_complete" -RequiredFiles @(".ideas/architecture.md", ".ideas/plan.md"))) {
    Write-Error "Prerequisites not met. Complete planning phase first with framework selection."
    exit 1
}

# Get current state to check framework
$state = Get-PluginState -PluginPath "plugins\[Name]"
if ($state.ui_framework -eq "pending") {
    Write-Error "UI framework not selected. Complete planning phase first."
    exit 1
}
```

**If designs exist, present menu:**
```
Found {N} saved designs in library.

How would you like to start?
1. Use existing design - Apply saved visual style
2. Start from scratch - Create custom design
3. Browse library - View all designs first

Choose (1-3): _
```

**Routing:**
- Option 1: Show designs with previews, let user pick, skip to Phase 2 with applied style
- Option 2: Continue to Phase 1 (requirements gathering)
- Option 3: List all designs with metadata, return to menu

**If no designs:** Skip to Phase 1.

---

## 🎨 PHASE 0: DESIGN LIBRARY CHECK

**Check for existing designs first:**
```powershell
# Check if design library exists
$manifestPath = "design_library/manifest.json"
if (Test-Path $manifestPath) {
    $manifest = Get-Content $manifestPath | ConvertFrom-Json
    $designCount = $manifest.totalDesigns

    Write-Host "Found $designCount saved designs in library." -ForegroundColor Cyan
    Write-Host ""

    # Present menu
    Write-Host "How would you like to start?" -ForegroundColor Yellow
    Write-Host "1. Use existing design - Apply saved visual style"
    Write-Host "2. Start from scratch - Create custom design"
    Write-Host "3. Browse library - View all designs first"
    Write-Host ""
    $choice = Read-Host "Choose (1-3)"

    switch ($choice) {
        "1" {
            # Show available designs and let user pick
            Show-DesignLibrary -Manifest $manifest
            $selectedDesign = Read-Host "Enter design ID to use"
            # Apply selected design as v1
            Apply-DesignFromLibrary -DesignId $selectedDesign
            # Skip to Phase 2 with applied design
        }
        "2" {
            # Continue to Phase 1 (requirements gathering)
        }
        "3" {
            # List all designs with details
            Show-DesignLibrary -Manifest $manifest -Detailed
            # Return to menu
            # (Loop back to choice prompt)
        }
    }
} else {
    Write-Host "No design library found. Starting from scratch." -ForegroundColor Yellow
    # Continue to Phase 1
}
```

**Design Library Integration:**
- If user chooses existing design: Apply it as the starting point, still allow iteration
- If user chooses from scratch: Continue to Phase 1
- Browse option: Show metadata without committing to use

---

## 📋 PHASE 1: REQUIREMENTS GATHERING

**Do NOT write code yet.** Gather requirements through focused questions:

### Tier 1 - Critical (always ask if missing):
1. **Style Direction:** Cyberpunk? Analog hardware? Minimal modern? Skeuomorphic?
2. **Primary Layout:** Big central knob? Horizontal strip? Vertical rack? Multi-section?
3. **Control Count:** How many knobs/sliders/buttons? (affects spacing)
4. **Window Size:** Compact (400x300)? Standard (600x400)? Large (800x600)?

### Tier 2 - Visual (ask if Tier 1 complete):
5. **Color Palette:** Primary accent color? Dark/light theme?
6. **Control Style:** Rotary knobs? Linear sliders? Toggles? Mix?
7. **Metering:** VU meters? LED indicators? Waveform display?

### Tier 3 - Polish (ask last):
8. **Branding:** Logo placement? Plugin name display?
9. **Special Features:** Preset browser? Analyzer? Custom graphics?

**Helper Functions for Design Library:**

```powershell
function Show-DesignLibrary {
    param($Manifest, [switch]$Detailed)

    Write-Host "Available Designs:" -ForegroundColor Cyan
    Write-Host ("=" * 50) -ForegroundColor Cyan

    foreach ($design in $Manifest.designs) {
        Write-Host "$($design.id)" -ForegroundColor Green
        Write-Host "  Name: $($design.name)"
        Write-Host "  Style: $($design.vibe)"
        Write-Host "  Best for: $($design.bestFor -join ', ')"

        if ($Detailed) {
            Write-Host "  Colors: $($design.colors.primary) (primary), $($design.colors.accent) (accent)"
            Write-Host "  Supports: $($design.supports.webview ? 'WebView' : ''), $($design.supports.visage ? 'Visage' : '')"
            Write-Host "  Usage: $($design.usageCount) times"
            Write-Host ""
        }
    }
}

function Apply-DesignFromLibrary {
    param($DesignId)

    $manifest = Get-Content "design_library/manifest.json" | ConvertFrom-Json
    $design = $manifest.designs | Where-Object { $_.id -eq $DesignId }

    if ($design) {
        Write-Host "Applying design: $($design.name)" -ForegroundColor Green

        # Copy design files as v1 starting point
        $designPath = "design_library/$($design.path)"

        # Copy preview.html as v1-test.html
        Copy-Item "$designPath/preview.html" "plugins/[$PluginName]/Design/v1-test.html"

        # Generate v1-ui-spec.md based on design metadata
        $specContent = @"
# UI Specification v1 (Based on $($design.name))

## Design Source
- **Library Design:** $($design.name)
- **ID:** $($design.id)
- **Style:** $($design.vibe)

## Layout
[Layout details from design]

## Colors
- Primary: $($design.colors.primary)
- Accent: $($design.colors.accent)
- Background: $($design.colors.background)

## Controls
[Control specifications based on design]
"@

        $specContent | Out-File "plugins/[$PluginName]/Design/v1-ui-spec.md"

        # Generate v1-style-guide.md
        $styleContent = @"
# Style Guide v1 (Based on $($design.name))

## Color Palette
- **Primary:** $($design.colors.primary)
- **Accent:** $($design.colors.accent)
- **Background:** $($design.colors.background)

## Typography
[Typography details]

## Visual Style
- **Theme:** $($design.vibe)
- **Best for:** $($design.bestFor -join ', ')
"@

        $styleContent | Out-File "plugins/[$PluginName]/Design/v1-style-guide.md"

        Write-Host "Design applied as v1. You can now iterate on this foundation." -ForegroundColor Green
    } else {
        Write-Error "Design '$DesignId' not found in library."
    }
}
```

**Rules:**
- Ask max 4 questions at once using `AskUserQuestion` tool
- Check creative brief first (if exists) - extract known requirements
- Calculate recommended window size before asking (based on control count)
- Present decision gate after each batch: Finalize / Ask more / Add context

---

## 🎨 PHASE 2: MOCKUP GENERATION

**Create design specification files:**

1. **`plugins/[Name]/Design/v1-ui-spec.md`** - Structured design plan:
```markdown
   # UI Specification v1
   
   ## Layout
   - Window: [width]x[height]px
   - Sections: [list sections]
   - Grid: [describe layout structure]
   
   ## Controls
   | Parameter | Type | Position | Range | Default |
   |-----------|------|----------|-------|---------|
   | ...       | ...  | ...      | ...   | ...     |
   
   ## Color Palette
   - Background: #______
   - Primary: #______
   - Accent: #______
   - Text: #______
   
   ## Style Notes
   [Key visual decisions, inspirations, constraints]
```

2. **`plugins/[Name]/Design/v1-style-guide.md`** - Visual reference:
   - Hex codes for all colors
   - Font choices and sizes
   - Spacing/padding rules
   - Control visual styles
   - Example UI state descriptions

3. **`plugins/[Name]/Design/v1-test.html`** - **WORKING HTML PREVIEW**:
   
   **CRITICAL:** For WebView framework, this HTML MUST be production-ready with proper JUCE integration.

   **Required structure:**
   ```html
   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>[Name] Plugin</title>
     <script type="module" src="js/index.js"></script>
     <style>
       /* Complete CSS based on style guide */
       :root {
         --primary: [color from style guide];
         --accent: [color from style guide];
         --background: [color from style guide];
       }
       
       body {
         background: var(--background);
         color: var(--primary);
         font-family: [font from style guide];
         margin: 0;
         padding: [padding from style guide];
         width: [width]px;
         height: [height]px;
         overflow: hidden;
       }
       
       /* All UI component styles */
     </style>
   </head>
   <body>
     <!-- Complete HTML structure matching UI spec -->
     <div id="plugin-ui">
       <!-- Controls with proper IDs matching parameter IDs -->
       <div class="control" id="[PARAMETER_ID]-control">
         <div class="knob" id="[PARAMETER_ID]-knob"></div>
         <div class="label">[Parameter Name]</div>
         <div class="value" id="[PARAMETER_ID]-value">[Default Value]</div>
       </div>
       <!-- Repeat for all controls -->
     </div>
   </body>
   </html>
   ```

   **JavaScript placeholder (for preview only):**
   ```javascript
   // This is a placeholder for preview - actual implementation goes in Source/ui/public/js/index.js
   document.addEventListener("DOMContentLoaded", () => {
       console.log("Preview mode - UI structure loaded");
       // Preview-only code here
   });
   ```

   **For WebView plugins:** The HTML in `v1-test.html` should be **identical** to what will be in `Source/ui/public/index.html` (minus the preview JavaScript).

   **CRITICAL WebView Requirements:**
   - HTML must use `<script type="module">` for JavaScript imports
   - All element IDs must match parameter IDs from `parameter-spec.md`
   - CSS must be complete and production-ready (embedded in `<style>` tag)
   - HTML structure must match the approved design exactly
   - No external dependencies (all assets embedded or served via resource provider)

**Present decision menu:**
```
🎨 Design specification v1 created
Files:
   - plugins/[Name]/Design/v1-ui-spec.md
   - plugins/[Name]/Design/v1-style-guide.md
   - plugins/[Name]/Design/v1-test.html (preview in browser)

⚠️ STOP HERE - Do NOT create Source/ files yet!
What would you like to do?
1. Iterate - Refine layout or style (creates v2)
2  Implement - Generate production code in Source/
3. Save as template - Add to design library
4. Preview - Open v1-test.html in browser
Choose (1-4): _
```

**Routing:**
- Option 1: Collect feedback, create v2 specs and v2-test.html, return to this menu
- Option 2: Mark design as approved and complete Design phase, suggest starting Implementation phase
- Option 3: Save to design_library/, return to menu
- Option 4: Open v1-test.html in browser for preview, return to menu

**After design approval (Option 2):**
```powershell
# Mark design phase complete
Complete-Phase -PluginPath "plugins\[Name]" -Phase "design" -Updates @{
  "validation.design_complete" = $true
}

Write-Host "Design phase complete! Ready for implementation."
Write-Host "Run /impl [Name] to start building the plugin."
```

---

## ✅ PHASE 4: COMPLETION

1. **Commit files to git**
2. **Update `plugins/[Name]/.ideas/todo.md`** - Check off GUI tasks
3. **Update `PLUGINS.md`** - Mark design stage complete

**Present instructions:**
```
GUI files generated and committed!

Next steps:
- Preview Visage: powershell -ExecutionPolicy Bypass -File .\scripts\preview-design.ps1 -PluginName [Name]
- Preview WebView: Open plugins/[Name]/Design/index.html in browser
- Build: Follow standard build process

Files created:
[list generated files]
```

**STOP HERE.** Let user test before proceeding.

---

## 🔄 VERSIONING SYSTEM

- Each iteration creates new version: v1, v2, v3...
- All files prefixed with version: `v2-ui-spec.md`, `v2-PluginEditor.h`
- Keep all versions for comparison
- Latest version used for build unless specified

---

## 📚 INTEGRATION

**Invoked by:**
- Natural language: "Design UI for [Name]", "Create GUI mockup"
- After creative brief in plugin workflow
- During plugin redesign

**Creates:**
- Design specs: `plugins/[Name]/Design/v[N]-*.md`
- Source code: `Source/PluginEditor.{h,cpp}`
- Optional: `Source/VisageControls.h`, `v[N]-ui.html`

**Updates:**
- `PLUGINS.md` - Design status
- `plugins/[Name]/.ideas/todo.md` - Task completion

---

## ⚠️ CRITICAL RULES

1. **Never write code before gathering requirements** - Always complete Phase 1 first
2. **Respect the decision gates** - Wait for user approval at each menu
3. **One phase at a time** - Don't skip ahead
4. **Version everything** - Never overwrite previous iterations
5. **Check design library first** - Reuse before creating
6. **Commit after each phase** - Preserve progress