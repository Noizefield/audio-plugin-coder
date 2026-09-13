# Maintenance Triage — Orphan & Legacy Candidates

**Created:** 2026-09-13 · **Rule:** nothing here is deleted without owner tick-off.
Tick `Decision:` per item, then request execution. (Local-only clutter decisions live in `plans/cleanup-decision-list.md`, which is gitignored.)

## 1. Scripts — unreferenced or Windows-only (all still on disk)

| # | Path | Facts | Recommendation | Decision |
|---|------|-------|----------------|----------|
| S1 | `scripts/terminal-monitoring.ps1` | No `.sh` counterpart; only listing-level references (2 hits), not imported by any skill/workflow/doc how-to | Retire or document purpose | documented in PROJECT_STRUCTURE.md (done 2026-09-13) | 
| S2 | `scripts/list-folder-structure.ps1` | No `.sh`; 1 hit (listing only) | Retire or document purpose | documented in PROJECT_STRUCTURE.md (done 2026-09-13) |
| S3 | `scripts/copy-agent-folders.ps1` | No `.sh`; 1 hit. Conceptually obsolete since Phase 2 (`.claude`/`.kilocode`/`.agent` are now pointers to `.agents/`, nothing to sync) | Retire, or repurpose as `.agents/` shim-regenerator | DELETED (done 2026-09-13) |
| S4 | `scripts/error-detection.ps1` + `.sh` | 5 hits, listing only; never invoked by skills/workflows | Wire into test/debug skills or retire | WIRED into skill_testing + debug Step 7, stale `.kilocode/` paths fixed to `.agents/` (done 2026-09-13) |
| S5 | `scripts/add-icon-to-exe.ps1` + `scripts/rcedit-x64.exe` | Script IS called by `build-and-install.ps1:166` (audit missed it) — script RESTORED, blob stays deleted (re-downloaded by script). If the icon step should go, patch the build script instead | Reference from icon guide or drop blob | SCRIPT RESTORED 2026-09-13 (live caller); blob deleted, icon-guide link pending your call |
| S6 | `scripts/setup.ps1` | No `.sh`; superseded by `bin/setup.js` (`npx`) + `/apc-setup` | Retire or mark legacy | RETIRED + DELETED, docs repointed (CONTRIBUTING, command-reference; done 2026-09-13) |
| S7 | `scripts/setup_bridges.bat` | Legacy wrapper next to fixed `setup_bridges.ps1` | Keep if still used, else retire | keep |
| S8 | ~~`scripts/installer/create-macos-installer.sh`~~ | **Resolved 2026-09-13:** now referenced by `docs/installer-creation.md` | Keep | KEEP (done) |

### Missing `.sh` counterparts (12, per `file-naming-conventions.md` parity rule)

`add-icon-to-exe`, `copy-agent-folders`, `list-folder-structure`, `pluginval-integration`,
`setup`, `setup_bridges`, `terminal-monitoring`, `validate-plugin-status`,
`validate-state-management`, `validate-visage-setup`, `validate-webview-member-order`,
`validate-webview-setup`. Either grant a Windows-only exception in the rule or add ports.
Decision:

## 2. Templates — unreferenced files (dirs `ffgl/`, `max-external/`, `visage/`, `webview/` are healthy)

| # | Path | Facts | Recommendation | Decision |
|---|------|-------|----------------|----------|
| T1 | `templates/CMakeLists.visage.template` | Impl skill uses `templates/visage/` dir; zero references to this file | Retire | RETIRED + DELETED (done 2026-09-13) |
| T2 | `templates/LICENSE.txt.template` | Ship skills generate `LICENSE.txt` inline (`New-LicenseFile`), never from this template | Retire or wire up | WIRED into ship `New-LicenseFile` (template-first, inline fallback; done 2026-09-13) |
| T3 | `templates/IMPROVEMENTS.md` | Bridge TODO (PBO, ASan/TSan, CI); only CHANGELOG mentions bridges generally | Fold into issues or keep | DELETED (done 2026-09-13) |

Fixed 2026-09-13 (not orphans): `templates/ffgl/*` + `templates/max-external/*` JUCE 8→9 headers;
`scripts/setup_bridges.ps1` + `.bat` wrong dirs (`FFGL_Bridge`→`ffgl`, `Max_External`→`max-external`) + JUCE clone pin;
`.agents/skills/ship/SKILL.md` stale `scripts/installer-template.iss`→`scripts/installer/installer-template.iss`;
8 dangling `known-issues.yaml` `resolution_file` refs remapped to closest existing docs
(dedicated write-ups for cmake-duplicate-target, webview-path-error, vst3-install/permission,
linux-webview-needs-web-browser, linux-lv2-headless-xvfb, macos-archs-conflict,
ci-juce-submodule-not-proper still pending — see troubleshooting auto-capture);
5 dangling `reference/*.md` links in `skill_design_webview/SKILL.md` remapped to canonical files.

## 3. Assets

| # | Path | Facts | Recommendation | Decision |
|---|------|-------|----------------|----------|
| A1 | `assets/APC_ASCII.txt` | Zero references (README/docs/scripts/CMake/package) | Keep as fun artifact or retire | keep |
| A2 | `assets/APC_Logo.gif` (~9.8MB) | Referenced (README blob URL + `.codex-plugin` logo) but omitted from `package.json:files` | Keep; consider optimizing + adding to `files` | keep |
