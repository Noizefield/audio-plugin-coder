# APC Hub - Design Language Spec v006

Status: DRAFT for review · Date: 2026-09-13 · App: `hub/` · Command: `/apc-hub`
Supersedes: `hub_design_spec_v005.md` (kept, do not edit).

## Changes vs v005

1. STICKY HEADER (§4.4 revision): `position:sticky; top:0` + paper background
   + z-index. The header now survives scrolling INSIDE long sections, not
   just navigation between them (v005 screenshot defect).
2. `10 DOCS` renamed `10 DOCUMENTATION`, redesigned as a real doc center:
   baked chapter index (real `##` headings per file), `<details>` collapsers
   (zero JS), disabled-search placeholder, reader preview with real text.
   Full dynamic loading specified for the live app (§6.2).
3. Header gains the 4th badge `APC v1.4.0` so the version stays visible even
   when the stuck header covers the sidebar mark.
4. Convention: review questions live in CHAT, not in the mockup files.

---

## 1–3. Principles, palette, typography

Unchanged.

## 4. Layout (v006 revision)

### 4.4 Persistent header (revision)

```css
.topbar{position:sticky; top:0; z-index:60; background:var(--paper);}
```

- Sticky within the centered frame: survives both navigation AND scroll.
- Opaque paper background is mandatory (content must slide UNDER it, never
  show through). z-index above sticky sidebar (40).
- Known overlap: when stuck, the header covers the sidebar's mark block.
  Accepted - version/badges are duplicated in the header, nav stays visible.
- Header content: logo + title + FOUR badges
  (`[OK] SETUP…` · `PROFILE` · `SNAP` · `APC v1.4.0`).

## 5. ASCII component library

5.1–5.14 unchanged, plus:

### 5.15 Doc collapser (new)

- Native `<details>` + `<summary>`, zero JS. Marker restyled ASCII:
  closed `+`, open `-` (via `summary::before`, `list-style:none`).
- Summary line: `<b>Doc Title</b> - path · N §`. Body: mono `§ chapter`
  lines (real baked `##` headings) + footer note pointing at the live reader.

## 6. Page inventory (v006 revision)

Sections 01–09 + ++ unchanged. Section 10 is now:

### 6.2 DOCUMENTATION (new design)

Live-app behavior (phase-2 `ui/` + server):

- `GET /api/v1/docs` → index: `{id, title, path, headings[{level, text}]}`.
- `GET /api/v1/docs/:id` → raw markdown, rendered client-side (tiny
  built-in md→HTML: headings, tables, code, lists - no deps).
- Reader: per-heading anchors (`#/10-documentation/:id#slug`), bookmarks in
  `localStorage`, full-text search over the index, chapter tree = `##`
  headings. Re-fetch on load, so edited `.md` files show up without a hub
  rebuild.
- v006 mockup: search input rendered DISABLED with honest placeholder;
  chapter index baked from the live tree (snapshot date stamped); reader
  preview box shows real excerpt text to fix reader typography.

## 7–10. Interaction, files, version/update

Unchanged, plus file convention: mockup `.md` records carry NO review
checklists - questions are asked in chat.

Update-check recap (specified v004, still current): `GET
https://api.github.com/repos/Noizefield/audio-plugin-coder/releases/latest`
→ semver compare → `[OK] CURRENT` / `[!!] UPDATE AVAILABLE` / `[..]
UNCHECKED`; future `scripts/apc-update-check.ps1/.sh` + `/api/v1/update`.

## Appendix A - unchanged.
