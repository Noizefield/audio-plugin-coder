# APC Hub - Design Language Spec v008

Status: DRAFT for review · Date: 2026-09-13 · App: `hub/` · Command: `/apc-hub`
Supersedes: `hub_design_spec_v007.md` (kept, do not edit).

## Changes vs v007

1. FIXED SHELL (§4.5): header + sidebar are viewport-locked; ONLY the right
   content region scrolls. Replaces the sticky-overlap construction (v006
   screenshot defect: sidebar drifting / hiding behind the header).
2. Decision on open Q3: NO submenu auto-expand - manual expand only, no new
   JavaScript. Theme script remains the single exception.
3. Tokens, sections, submenu, switching, §10: unchanged.

---

## 1–3. Principles, palette, typography

Unchanged.

## 4. Layout (v008 revision)

### 4.5 Fixed shell (new, normative - replaces sticky overlap)

```css
html,body{height:100%;}
body{overflow:hidden;}                       /* page itself never scrolls */
.frame{height:100vh; height:100dvh;
  display:flex; flex-direction:column;}       /* header + shell stack */
.topbar{position:static; flex:none;}          /* always visible by construction */
.shell{flex:1 1 auto; min-height:0;}          /* grid fills remaining height */
.side{position:static; overflow-y:auto;}      /* own scroll only if needed */
.content{overflow-y:auto; min-height:0;}      /* THE scroll region */
```

- Header is in normal flow of a non-scrolling page: visible on every view
  AND every scroll position, with no sticky, no z-index, no overlap.
- Sidebar is viewport-locked: it can never scroll up or hide. If its content
  exceeds the available height (short viewports), it scrolls INDEPENDENTLY
  inside its own column - the content region is unaffected and vice versa.
- Fragment navigation (`:target` switching) keeps working: browsers scroll
  nested overflow ancestors to reveal the hash target.
- Mobile (≤900px): shell unfixes - `body` scrolls as one page again
  (`overflow:auto`, `.frame{display:block;height:auto}`), header returns to
  `position:sticky` for that mode only. Print: all static, all sections shown.

## 5–10. Components, inventory, interaction, files, version/update

Unchanged (submenu §5.16, per-doc sections §6.2, `:target` switching,
theme script, §10 update-check, script-assembled mockup twins).

## Appendix A - unchanged.
