# APC Hub — Design Language Spec v010

Status: DRAFT for review · Date: 2026-09-13 · App: `hub/` · Command: `/apc-hub`
Supersedes: `hub_design_spec_v009.md` (kept, do not edit).
Note: v010 amends the language for the LIVE app; no static mockup twin
(the live `hub/ui/` is the demo).

## Changes vs v009

1. NO EM DASHES (§1 addendum): U+2014 is banned from all hub UI text, code
   comments, workflow, and docs. Use `-` (hyphen) or `->` (arrow) instead.
   Applied repo-wide across `hub/` (frozen mockup twins updated identically,
   fence checks still green).
2. SIDEBAR MARK (§5.11 revision): the ASCII `+---+` box is retired - it
   rendered unevenly at small sizes. The mark is now a plain HTML box
   (1px border, padded): bold `APC vX.Y.Z` + muted `HUB - LIVE` line.
   The full block logo in the header is unaffected (real art, keep).
3. SUBMENU ACTIVE STATE (§5.16 revision): active doc highlighting is painted
   by a tiny `hashchange` script (`.on` class: invert + `>` marker) instead
   of per-id CSS `:has` rules. Reason: doc ids are data-driven (any future
   `docs/*.md`, any filename case) and CSS cannot cover open-ended sets.
   The theme script + this painter are the only JS in the UI.
4. App features specified here for the record (implemented in `hub/`,
   documented in `docs/hub.md`): settings editor (POST with `.bak` backup),
   design preview links (`/preview/:design/:file`, new tab), update
   RE-CHECK button (`?refresh=1` bypassing the 24h cache).

---

## 1. Principles (v010 addendum)

8. NO EM DASHES. The character U+2014 must not appear in UI text, comments,
   or docs. Rationale: it renders inconsistently across the system fonts and
   reads as visual noise against the ASCII language. Hyphen `-` for joins,
   `->` for direction, `...` never (use `[..]`).

## 2–10. Palette, type, layout, components, inventory, interaction, files

Unchanged, except §5.11 and §5.16 as revised above.

## Appendix A — unchanged.
