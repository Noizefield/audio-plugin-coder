# APC Hub - Design Language Spec v003

Status: DRAFT for review · Date: 2026-09-13 · App: `hub/` · Command: `/apc-hub`
Supersedes: `hub_design_spec_v002.md` (kept, do not edit).

## Changes vs v002

1. APP SHELL replaces one-pager: fixed left sidebar (menu + categories +
   theme switch) / right content shows ONLY the active section.
2. Switching is CSS-only (`:target` + `:has`) - bookmarks and back-button
   keep working natively, still no section JavaScript.
3. Sidebar carries a compact ASCII mark; the full block logo moves to
   01 OVERVIEW. Below 900px the sidebar collapses to a top block.
4. Tokens, colors, dark-default, components 5.1–5.10: unchanged.

---

## 1–3. Principles, palette, typography

Unchanged from v002 (rectangles only; ASCII-first; amber = active/warning,
phosphor green = calm/good; dark-first; system fonts; tables over cards;
read-only honesty). Token table identical.

## 4. Layout (v003 revision)

### 4.1 Shell

```
+--------+--------------------------------------------------+
| SIDE   | CONTENT (exactly one section visible)            |
| 264px  | max 860px column, 24px gutters                     |
| sticky |                                                  |
+--------+--------------------------------------------------+
```

- `.shell`: grid `264px 1fr`, full viewport height.
- Sidebar: sticky, `100vh`, own scroll, `border-right: 2px solid --rule`.
  Order inside: MARK → TITLE → BADGES → NAV → THEME → side-footer
  (snapshot stamp).
- Content: single column, sections have no bottom border anymore (only one
  is ever visible); each section ends with a PREV/NEXT pager (5.12).
- Responsive: below 900px the shell stacks - sidebar becomes a static top
  block (`border-right: none; border-bottom: 2px`), nav links wrap
  horizontally, content full width. No hamburger, nothing hidden.
- Print: all sections render stacked (switching CSS disabled in print).

### 4.2 Logo placement

The 6-line block logo is ~450px wide and does not fit a 264px sidebar, so:
sidebar shows the compact mark (5.11); the full `assets/APC_ASCII.txt`
`<pre>` opens section 01 OVERVIEW. Both render from the same source file.

## 5. ASCII component library

5.1–5.10 unchanged from v002.

### 5.11 Sidebar mark (new)

```
+------------------+
| APC/HUB_         |
| v003 · DRAFT     |
+------------------+
```

Boxed `<pre>`, mono, 1px border. `APC/HUB_` in bold ink; version line muted.
The trailing `_` is a nod to the terminal cursor. No other sidebar graphics.

### 5.12 Nav item + pager (new)

Nav items: `01 OVERVIEW` … `++ CONSISTENCY`, block links, 13px mono.
Active item = inverted fill (ink bg, paper text) AND `>` prefix marker, so
state survives CSS-off reading:

```
> 02 PROJECTS
  03 SKILLS
```

Pager at each section end: `< PREV | NEXT >` as plain mono anchor links
(`01 OVERVIEW` has NEXT only, `++ CONSISTENCY` has PREV only). Order follows
the section inventory (§6).

### 5.13 Switching mechanism (normative, CSS-only)

```css
main section{display:none}
main section:target{display:block}
body:not(:has(main section:target)) #01-overview{display:block}
body:has(#02-projects:target) a[href="#02-projects"]{...active...}
```

- Zero section-switching JavaScript: the URL hash IS the state, so every
  view is bookmarkable and back/forward works for free.
- Default (no hash): 01 OVERVIEW.
- Active nav highlighting uses one `:has` rule per section (11 rules).
- `:has` + `:target` support: all current browsers (2023+). Fallback on
  ancient engines: overview stays visible - acceptable, documented.

## 6. Page inventory

Unchanged (01…10 + ++ CONSISTENCY, same sources). v003 renders the same
snapshot baked 2026-09-13.

## 7. Interaction (v003 revision)

- Hash nav = section switching + bookmarks (native, no code).
- Theme switch: same v002 script, relocated into the sidebar.
- Still no JS for content: no copy-buttons/search yet (phase-2 live `ui/`).
- Print: `main section{display:block}`, sidebar condensed.

## 8. File conventions

Unchanged, plus: mockup HTML now carries a `/* == shell.css == */` style
section mapping to the future live split
(`tokens.css / themes.css / base.css / layout.css / shell.css / components.css / docs.css`).

## 9. Open questions for the reviewer

1. Sidebar width 264px - wider/narrower? Collapsible later, or fixed forever?
2. Compact mark vs an attempt to squeeze the full block logo in - keep split?
3. CSS-only switching accepted (ancient-browser fallback = overview only)?
4. Pager useful, or is the sidebar alone enough?
