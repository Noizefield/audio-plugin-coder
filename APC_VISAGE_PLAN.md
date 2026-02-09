# APC Visage Integration Plan (Checklist)

This checklist captures the current Visage integration plan and is intended for the next AI to take over. Work through items in order; each item should be marked done when complete and verified.

## 1) Build System Wiring
- [x] Add a root CMake option `APC_ENABLE_VISAGE` (default OFF) to toggle Visage build.
- [x] Wire `_tools/visage` as a subdirectory when `APC_ENABLE_VISAGE` is ON.
- [x] Add a `visage::visage` alias target after `add_subdirectory` if the target exists.
- [x] Add a Visage-aware plugin CMake template (new template file or conditional logic in `templates/CMakeLists.txt.template`).
- [x] Ensure Visage plugins do NOT enable WebView-only flags (`NEEDS_WEBVIEW2`, `JUCE_WEB_BROWSER`, `juce::juce_gui_extra`) unless explicitly needed.

## 2) JUCE ↔ Visage Embedding Layer
- [x] Create a reusable JUCE host for Visage (using existing `common/VisageJuceHost.h`).
- [x] Use `VisageJuceHost.h` in Visage templates for embedding inside JUCE editor.
- [ ] Ensure resize propagation from JUCE to Visage window (verify in actual plugin usage).
- [ ] Decide how redraws are triggered (JUCE timer vs Visage internal callbacks).
- [ ] Confirm Windows/macOS/Linux parent-handle expectations with Visage `createPluginWindow`.

## 3) Visage UI Scaffold & Controls
- [ ] Add `Source/VisageControls.h` for Visage-specific widgets (per docs).
- [ ] Implement a minimal Visage UI layout example (knobs/sliders/labels).
- [ ] Add parameter binding helpers from JUCE parameters to Visage controls.
- [ ] Provide a safe default visual style for Visage-based plugins.

## 4) Workflow & State Management Updates
- [ ] Update `scripts/state-management.ps1` to support `ui_framework: "visage"` end-to-end.
- [x] Add `scripts/validate-visage-setup.ps1` similar to WebView validation:
  - [x] Root CMake includes Visage when required.
  - [x] Plugin CMake links Visage.
  - [x] `VisageControls.h` exists.
  - [x] WebView-only definitions are not required.
- [x] Update plan/design/impl workflows to route by framework and avoid WebView-only checks.
- [x] Add explicit framework question in plan/new workflows and planning skills.

## 5) Design Workflow & Templates
- [x] Add Visage design templates (e.g. `.kilocode/templates/visage/`).
- [x] Update `/design` workflow to generate Visage layout specs when `ui_framework == "visage"`.
- [x] Add a default Visage UI spec template.
- [x] Visage design preview scaffold (default yes) with no HTML output.

## 6) Docs & Guidance
- [ ] Add a Visage framework guide (parallel to `docs/webview-framework.md`).
- [ ] Update `docs/README.md` and `docs/PROJECT_STRUCTURE.md` with Visage steps.
- [x] Update `docs/command-reference.md` for Visage preview flow and validation script.
- [x] Update `docs/plugin-development-lifecycle.md` for framework-specific previews.
- [ ] Add Visage troubleshooting notes (embedding, event loop, GPU context).

## 7) Pilot Plugin
- [ ] Select a small plugin to pilot Visage UI end-to-end.
- [ ] Implement Visage UI in `PluginEditor` using the new host component.
- [ ] Validate on Windows (HWND), macOS (NSView), Linux (X11 + fd polling if needed).

## Key Risks To Address Early
- [ ] Embedding correctness and parent-handle stability.
- [ ] Render loop integration without `runEventLoop()` inside a plugin.
- [ ] GPU context conflicts (bgfx vs JUCE OpenGL/Metal).
- [ ] Linux event pumping / fd integration.
