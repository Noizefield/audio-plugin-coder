# APC Hub - Design Language Spec v002

Status: DRAFT for review · Date: 2026-09-13 · App: `hub/` · Command: `/apc-hub`
Supersedes: `hub_design_spec_v001.md` (kept, do not edit).
Review loop: comment on this file, then a `_v003` revision is issued.

## Changes vs v001

1. DUAL THEME with switch. Default is DARK. Light theme = v001 look.
2. SECOND SIGNAL COLOR: phosphor green for everything OK / calm / good.
3. One tiny theme script (~20 lines, no deps) - the single JS exception.
4. `hub/_design/CHANGELOG.md` opened.

---

## 1. Principles (v002 revision)

1. RECTANGLES ONLY. `border-radius: 0` everywhere. No `box-shadow`, no
   gradients, no translucency. Depth is expressed by rules and spacing.
2. ASCII BEFORE GRAPHICS. Status, progress and structure are text tokens
   (`[x]`, `[OK]`, `->`). A section must still read correctly in a terminal
   with CSS disabled.
3. TWO SIGNAL COLORS, STRICT ROLES.
   - Amber `#FF9500` = ACTIVE / WARNING. Current phase, active nav, `[!!]`,
     logo arrow line.
   - Phosphor green = CALM / GOOD. `[OK]`, `[x]`, present-pass, healthy
     metrics, setup badge. Never for warnings, never for the active phase.
   - Everything else stays monochrome. If a third color seems needed, the
     spec is wrong, not the palette.
4. DARK FIRST. Dark theme is the default and the reference design. Light is
   a supported alternate, not an afterthought - but new components are
   drawn dark-first.
5. SYSTEM FONTS ONLY. No webfonts, no downloads, offline-safe.
6. TABLES OVER CARDS. Dense ruled tables are the default container.
7. READ-ONLY HONESTY. Every value shows its source file. Missing data renders
   as `[NOT FOUND]` + expected path, never as a silent gap.

## 2. Palette (tokens, per theme)

Dark is `html[data-theme="dark"]` (default). Light is `html[data-theme="light"]`.

| Token         | Dark        | Light       | Use                                              |
|---------------|-------------|-------------|--------------------------------------------------|
| `--paper`     | `#0B0B0B`   | `#FAFAF7`   | page background                                  |
| `--ink`       | `#EDEAE0`   | `#141414`   | text, rules, borders                             |
| `--muted`     | `#8A877E`   | `#6B6B6B`   | secondary text, timestamps                       |
| `--rule`      | `#3D3A33`   | `#1A1A1A`   | 1px borders and dividers                         |
| `--amber`     | `#FF9500`   | `#FF9500`   | signal: active / warning (same both themes)      |
| `--amber-ink` | `#000000`   | `#000000`   | text on amber fills                              |
| `--good`      | `#33FF33`   | `#0B7A30`   | signal: ok / calm / good (phosphor family)       |
| `--good-ink`  | `#000000`   | `#FFFFFF`   | text on green fills                              |

Rationale for two greens: `#33FF33` is classic P1 phosphor on black but
unreadable as text on paper, so light theme uses a deep phosphor-descendant
`#0B7A30`. Same hue family, contrast-safe in both. Shade adjustable in review.

Green usage rules (normative):

- `.tok-ok`, `[OK]` badges, `[x]` checklist marks, healthy counts → green.
- Amber and green never touch: a current-phase chip is amber even when that
  phase is "good news". State (active) beats sentiment (good).
- `::selection` = green fill, black text (dark) / white text (light).
- Print stylesheet: both themes print black-on-white, green as bold ink.

## 3. Typography

Unchanged from v001: mono stack for data/nav/logo/tables/code, system sans
for prose only, 15px/1.5, mono uppercase kickers `02 // PROJECTS`.
Logo: `assets/APC_ASCII.txt` verbatim in `<pre>` (+ Appendix A fallback).

## 4. Layout

Unchanged, plus: header carries the theme switch at top-right
(see 5.9). Below 760px the switch stays visible (wraps under the title).

## 5. ASCII component library

5.1–5.8 unchanged from v001 (section divider, pipeline, checklist, status
tokens, data table, square chips, swatches, banners), with rendering notes:

- 5.2 pipeline: current stage = amber fill; completed stages = green `[x]`?
  No - completed stages stay plain ink. Only the bracketed current stage
  carries color. Restraint.
- 5.3 checklist: `[x]` renders in `--good`, `[ ]` in `--muted`.
- 5.4 tokens: `[OK]` = green bold; `[..]` = muted; `[!!]` = amber fill
  black text; `[ -- ]` = muted.

### 5.9 Theme switch (new)

```
THEME: [*DARK] [LIGHT]
```

- Two square mono buttons, 1px border, no radius. Active option marked BOTH
  by inverted fill AND `*` prefix (readable with CSS off / color-blind safe).
- Behavior: click sets `documentElement[data-theme]`, persists to
  `localStorage["apc-hub-theme"]`. On load: stored value wins, else `dark`.
  `data-theme="dark"` is hardcoded on `<html>` so first paint never flashes.
- The theme script is the ONLY JavaScript allowed in hub UI until the live
  `ui/` phase. No frameworks, no deps, <30 lines, commented.

### 5.10 Banners (amendment)

Warning banners keep the amber left border. Informational "all clear" notes
(if ever needed) use a green left border - same construction, other signal.

## 6. Page inventory

Unchanged from v001 (01 OVERVIEW … 10 DOCS + ++ CONSISTENCY). Mockup v002
re-renders all sections under the new tokens; no new sections.

## 7. Interaction

- Anchor nav, per-heading doc anchors (unchanged).
- v002 JS allowance: theme switch only (see 5.9). Copy-buttons, search,
  bookmarks still wait for the phase-2 live `ui/`.
- Print: light rendering regardless of active theme.

## 8. File conventions

- `hub/_design/hub_design_spec_vNNN.md` - spec, versioned, superseded kept.
- `hub/_design/hub_design_mockup_vNNN.md` - mockup record + full HTML fence.
- `hub/_design/hub_design_mockup_vNNN.html` - runnable twin (`file://`).
- `hub/_design/CHANGELOG.md` - per-version notes (opened in v002).
- Live CSS split still maps 1:1 to mockup `<style>` sections, now plus
  `themes.css` (token blocks per `data-theme`).

## 9. Open questions for the reviewer

1. Phosphor shade: `#33FF33` classic, or softer `#4ADE80`-style? Light-theme
   `#0B7A30` readable enough?
2. Amber/green balance: green currently on every `[x]`/`[OK]` - too loud in
   dark mode, or exactly the terminal feel we want?
3. Kicker numbers (`01`, `02`…): keep monochrome, or amber in dark mode?

---

## Appendix A - strict-ASCII logo fallback (unchanged from v001)

(Same 7-bit block as v001.)
