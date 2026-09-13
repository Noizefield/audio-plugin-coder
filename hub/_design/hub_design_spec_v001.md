# APC Hub - Design Language Spec v001

Status: DRAFT for review · Date: 2026-09-13 · App: `hub/` · Command: `/apc-hub`
Review loop: comment on this file, then a `_v002` revision is issued.
Nothing here is final until marked APPROVED.

Working title of the language: **APC RASTER** - Swiss rectilinear minimalism
with an ASCII-first component set. No images, no shadows, no rounded corners.

---

## 1. Principles

1. RECTANGLES ONLY. `border-radius: 0` everywhere. No `box-shadow`, no
   gradients, no translucency. Depth is expressed by rules and spacing.
2. ASCII BEFORE GRAPHICS. Status, progress and structure are text tokens
   (`[x]`, `[OK]`, `->`). A section must still read correctly in a terminal
   with CSS disabled.
3. ONE SIGNAL COLOR. Monochrome base + Amber `#FF9500` reserved for: current
   phase, active nav item, warnings. Amber is never body text on paper.
4. SYSTEM FONTS ONLY. No webfonts, no downloads, offline-safe.
5. TABLES OVER CARDS. Dense ruled tables are the default container. Loose
   "card grids" are banned in v001.
6. READ-ONLY HONESTY. Every value shows its source file. Missing data renders
   as `[NOT FOUND]` + expected path, never as a silent gap.

## 2. Palette (tokens)

| Token    | Value     | Use                                              |
|----------|-----------|--------------------------------------------------|
| `--paper`| `#FAFAF7` | page background                                  |
| `--ink`  | `#141414` | text, rules, borders                             |
| `--muted`| `#6B6B6B` | secondary text, timestamps                       |
| `--rule` | `#1A1A1A` | 1px borders and dividers                         |
| `--amber`| `#FF9500` | signal only: current phase chip, active nav, `[!!]` |
| `--amber-ink` | `#000000` | text on amber fills (contrast, non-negotiable) |

Accessibility rule: amber-on-paper fails small-text contrast, so amber appears
only as fills with black text, 3px+ rules, or large headings. Phase-1 ships
light theme only; dark inversion is specified in v002+ if requested.

## 3. Typography

- Mono (data, nav, logo, tables, code):
  `Consolas, "Cascadia Mono", Menlo, Consolas, monospace`
- Sans (prose paragraphs only):
  `system-ui, "Segoe UI", Roboto, Arial, sans-serif`
- Base 15px / 1.5. Section kickers: mono, 12px, uppercase, letter-spacing
  0.12em, e.g. `02 // PROJECTS`. H1 only for the hub title line.
- Logo: `assets/APC_ASCII.txt` verbatim inside `<pre>`, never re-set in a
  proportional font. Strict 7-bit fallback in Appendix A for fonts that
  mangle block glyphs.

## 4. Layout

- Max width 1120px, left-aligned, 24px gutters. No centered hero.
- Order: HEADER (logo `<pre>` + title line + setup badge) / NAV (numbered
  index `01…10`, anchor links = bookmarks) / MAIN (ruled sections) /
  FOOTER (resolved paths + snapshot timestamp + source list).
- Responsive: below 760px, tables scroll horizontally (`overflow-x: auto`),
  nav wraps to two columns, `<pre>` logo scales via `font-size: 2.2vw` with
  a 9px floor and horizontal scroll fallback. No hamburger, no hidden nav.

## 5. ASCII component library (normative for v001)

### 5.1 Section divider

```
=== 02 // PROJECTS =====================================================
```

### 5.2 Phase pipeline (plugin detail)

```
DREAM -> PLAN -> [DESIGN] -> IMPL -> SHIP
```

Current stage is bracketed AND amber-filled. Completed stages plain, future
stages muted.

### 5.3 Validation checklist

```
[x] creative brief        [x] parameter spec        [x] architecture
[x] ui framework          [x] design                [ ] code
[ ] tests                 [ ] ship ready
```

### 5.4 Status tokens (replaces emoji/pills)

`[OK]` present-pass · `[..]` pending/in-progress · `[!!]` missing-fail ·
`[ -- ]` not-applicable. Color: ink / muted / amber-fill-black-text / muted.

### 5.5 Data table

1px solid outer border, 1px row rules, no zebra, no padding above 8px/12px,
mono for all cells except prose description column. Header row uppercase,
12px, letterspaced, bottom border 2px.

### 5.6 Chips (square)

Phase/framework labels are square amber or ink-outline spans, e.g.
`[ SHIP_COMPLETE ]`, `WEBVIEW`. Square corners, 1px border, 11px mono.

### 5.7 Color swatches (designs section)

Text-first: `primary #1F7A3D` as a 14px square inline block + hex string.
The hex string is mandatory; the block is decoration.

### 5.8 Banners

```
+------------------------------------------------------------------+
| [!!] ../apc_plugins/ghost-project : status.json NOT FOUND        |
+------------------------------------------------------------------+
```

ASCII box, 1px, amber left border 4px for warnings.

## 6. Page inventory (v001 mockup scope)

| #  | Section      | Source of truth                                          |
|----|--------------|----------------------------------------------------------|
| 01 | OVERVIEW     | `apc.config.json` (setup, profile) + plugin phase counts |
| 02 | PROJECTS     | `<plugins_dir>/*/status.json`, config-resolved paths      |
| 03 | SKILLS       | `.agents/skills/*/` (legacy `skill_*` flagged, see 6.1)   |
| 04 | COMMANDS     | `.agents/workflows/apc-*.md` + alias pointers + Codex form|
| 05 | DESIGNS      | `design_library/manifest.json`                            |
| 06 | SCRIPTS      | `scripts/` incl. `installer/`, `codex/`, `lib/`           |
| 07 | TEMPLATES    | `templates/` tree                                         |
| 08 | TOOLS        | `_tools/` presence + JUCE pin + sampled tool versions     |
| 09 | SETTINGS     | `apc.config.json` vs `apc.config.example.json` + resolved |
| 10 | DOCS         | `docs/*.md` chapter counts + bookmarks                    |
| ++ | CONSISTENCY  | shim->canon ref check, orphans, empty `commands/` note    |

### 6.1 Redundancy flags (display only, no deletion in hub work)

- `.agents/skills/skill_ideation|skill_planning|skill_design|skill_implementation|skill_packaging|skill_debug`
  vs new-style `dream|plan|design|impl|test|debug|ship` - rendered with
  `[LEGACY?]` token for tidy-up confirmation.
- Root `commands/` empty - rendered as `[ -- ] pointer: use .agents/workflows`.
- Root `skills/` = packaged Codex skill only - labelled as such.

## 7. Interaction (v001 = static)

- Anchor nav (`#01-overview` …), per-heading doc anchors for bookmarks.
- No JavaScript in v001. Copy-buttons, search, `localStorage` bookmarks
  arrive with the phase-2 live `ui/` (fetch `/api/v1/*`).
- Print stylesheet: black on white, nav hidden, URLs after links.

## 8. File conventions

- `hub/_design/hub_design_spec_vNNN.md` - this spec, versioned.
- `hub/_design/hub_design_mockup_vNNN.md` - mockup record + full HTML in a
  fenced block + runnable `.html` twin (same basename) for `file://` review.
- `hub/_design/CHANGELOG.md` - per-version review notes (created at v002).
- Future live CSS split maps 1:1 to the `<style>` sections of the mockup:
  `tokens.css / base.css / layout.css / components.css / docs.css`.

## 9. Open questions for the reviewer

1. Amber density: current spec uses it sparingly (chips, active nav, `[!!]`).
   More or less?
2. Dark theme: specify now or defer?
3. Pipeline granularity: 5 coarse stages (v001) or full `status.json` phase
   strings (`design_complete`, `code_4_1_1`…) as the pipeline?

---

## Appendix A - strict-ASCII logo fallback (7-bit, for fragile fonts)

```
  ###   #####    ### 
 #   #  #    #  #   #
 #   #  #    #  #
 #####   #####   #
 #   #  #       #    #
 #   #  #        ####
              --------------------------> AudioPluginCoder
```

Primary remains `assets/APC_ASCII.txt` block version; use this fallback only
where block glyphs break.
