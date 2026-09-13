# APC Hub — Design Changelog

## v009 — 2026-09-13 (DRAFT)

- Full-bleed scroll container (§4.5 amendment): `max-width` off `.content`,
  onto `.content>main,.content>footer` — scrollbar docks at the frame's
  right edge. 6-line delta vs v008, nothing else changed.

## v008 — 2026-09-13 (DRAFT)

- Fixed shell (§4.5): `body{overflow:hidden}`, flex-column frame; header +
  sidebar viewport-locked, only `.content` scrolls. Mobile falls back to
  page scroll + sticky header. Sticky-overlap defect gone by construction.
- Decided: submenu stays manual-expand, no new JavaScript.

## v007 — 2026-09-13 (DRAFT)

- DOCUMENTATION submenu (§5.16): native `<details>` collapser in sidebar,
  closed by default, INDEX + 16 short-label entries; parent highlights for
  every child view via prefix-match `:has` rule.
- 16 per-doc sections with real baked chapter lists; pager chain extended
  to 27 stops; index `<details>` gain OPEN AS SECTION links.
- Build order unchanged (overview/projects first). Questions live in chat.

## v006 — 2026-09-13 (DRAFT)

- Sticky header (§4.4 revision): `position:sticky; top:0`, opaque paper
  background, z-index above sidebar — survives scrolling inside sections.
  Header gains 4th badge `APC v1.4.0`.
- `10 DOCS` renamed `10 DOCUMENTATION`, rebuilt as doc center: disabled
  search placeholder, 16 `<details>` collapsers with the real baked `##`
  chapter index (178 chapters), reader preview with real README.md text.
  Dynamic loading (`/api/v1/docs`, search, bookmarks) specified in §6.2.
- Convention: review questions live in chat, not in mockup files.

## v005 — 2026-09-13 (DRAFT)

- Persistent header (§4.4): logo + title + badges span the frame on EVERY
  view; logo removed from 01 OVERVIEW; sidebar slimmed to version-only
  mark + REL + nav + theme + foot.

## v004 — 2026-09-13 (DRAFT)

- Table padding rule (§5.14): 14px left air on all cells (screenshot fix).
- Centered shell (§4.3): max 1340px frame, auto margins, 2px outer rules;
  sidebar stays left inside the frame.
- Sidebar mark shows `APC v1.4.0` (src `package.json`, banner matches).
- New sidebar REL block + 01 OVERVIEW upstream row; update-check mechanism
  specified in new spec §10 (GitHub releases/latest, semver, states,
  future `scripts/apc-update-check.ps1/.sh` + `/api/v1/update`).

## v003 — 2026-09-13 (DRAFT)

- App shell: fixed 264px left sidebar (ASCII mark, badges, nav, theme,
  stamp) + right side shows ONLY the active section.
- Switching is CSS-only (`:target` + `:has`); hash = state, bookmarks and
  back-button work natively; overview is the no-hash default.
- Full block logo moved to 01 OVERVIEW; sidebar carries compact `APC/HUB_`
  mark. PREV/NEXT pagers per section. Print renders all sections stacked.
- Tokens, data snapshot, theme switch: unchanged from v002.

## v002 — 2026-09-13 (DRAFT)

- Dual theme: dark default (`#0B0B0B` paper), light alternate (v001 look).
- Theme switch `THEME: [*DARK] [LIGHT]` in header, persisted via
  `localStorage["apc-hub-theme"]`, no-flash (`data-theme` on `<html>`).
- Second signal color: phosphor green (`#33FF33` dark / `#0B7A30` light)
  for all OK/calm/good elements (`[OK]`, `[x]`, setup badge, `::selection`).
- Amber strictly active/warning from here on (current-phase chips, `[!!]`).
- Fixed: neogrid-minimal accent is `#7B68EE` (v002 mockup; v001 was correct).
- Spec split: `themes.css` added to the future live-CSS file map.

## v001 — 2026-09-13 (DRAFT)

- Initial APC RASTER language: rectangles only, 1px rules, mono-first,
  system fonts, zero JS, light theme only, amber single signal color.
- Static mockup with live snapshot baked in (4 plugins, config, 3 designs,
  18 skills, 23 workflows, 33 scripts, 27 template files, 16 docs/696 heads).
