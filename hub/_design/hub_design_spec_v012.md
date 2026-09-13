# APC Hub - Design Language Spec v012

Status: DRAFT for review · Date: 2026-09-13 · App: `hub/` · Command: `/apc-hub`
Supersedes: `hub_design_spec_v011.md` (kept, do not edit).
Note: v012 amends the language for the LIVE app; no static mockup twin
(the live `hub/ui/` is the demo).

## Changes vs v011

1. UPDATE SEMANTICS (§10 revision): "no releases published upstream" now
   counts as CURRENT (green `[OK]`), not UNCHECKED. Rationale: when nothing
   newer can exist, the installed version is the latest there is. The reason
   (`no upstream releases`) stays visible next to the version. UNCHECKED
   (`[..]`) is reserved for genuine unknowns: network errors, timeouts,
   malformed responses, non-semver tags.
2. FORM CONTROLS (§5.17 new): native `input`/`select`/checkboxes must follow
   the active theme via `color-scheme:dark` / `color-scheme:light` on the
   theme root. Backgrounds stay transparent; the scheme flag stops browsers
   from painting light-native white controls into the dark theme. Rule
   (normative): every new theme from here on ships its `color-scheme` line
   next to its tokens - never rely on transparent backgrounds alone.

---

## 1-10. Principles, palette, type, layout, components, inventory

Unchanged except §5.17 and §10 as revised above.

## Appendix A - unchanged.
