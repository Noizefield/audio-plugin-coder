# APC Hub - Design Language Spec v011

Status: DRAFT for review · Date: 2026-09-13 · App: `hub/` · Command: `/apc-hub`
Supersedes: `hub_design_spec_v010.md` (kept, do not edit).
Note: v011 amends the language for the LIVE app; no static mockup twin
(the live `hub/ui/` is the demo).

## Changes vs v010

1. SIDEBAR MARK REMOVED (§5.11 retired): the version box is gone entirely.
   Rationale: the header already carries the APC version (now an amber repo
   link); the sidebar keeps REL/upstream lines only, in line with the other
   plain sidebar information. No duplication, no boxes-in-boxes.
2. HEADER VERSION BADGE (§4.4 addendum): `APC vX.Y.Z` is a real link to the
   GitHub repo (new tab) rendered as an AMBER badge (amber fill, black text).
   It is the only amber element in the header besides the logo arrow line.
3. DESIGN FILE LISTING (§6.3 new): the designs table no longer trusts
   `manifest.json → examples` (proven wrong: manifest claims `preview.html`
   for all three designs, only rams60 has it). The server walks each design
   directory for real `*.html` files; the UI lists every found file as a
   new-tab preview link, plus a `[!!]` note naming manifest-listed files
   that do not exist on disk (also surfaced in ++ CONSISTENCY).
4. SETTINGS FORM (§9 new): the raw-JSON textarea is replaced by a structured
   form covering every key in the file - PATHS (3 text fields), DEFAULTS
   (framework select + visage checkbox), MODELS (profile + per-phase
   provider/model table), CODEX (enabled, default tier, per-tier
   model/profile/reasoning/max-attempts table, escalation fields), SETUP
   (completed checkbox; timestamps preserved). SAVE validates client-side,
   POSTs, server shape-checks, backs up `.bak`, then reloads. Unknown keys
   (e.g. `notes`) are preserved, never dropped.

---

## 1. Principles

Unchanged, incl. the em-dash ban (§1.8).

## 2-10. Palette, type, layout, components, inventory, interaction, files

Unchanged except §4.4, §5.11, §6.3, §9 as revised above.

## Appendix A - unchanged.
