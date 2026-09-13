# APC Hub — Design Language Spec v009

Status: DRAFT for review · Date: 2026-09-13 · App: `hub/` · Command: `/apc-hub`
Supersedes: `hub_design_spec_v008.md` (kept, do not edit).

## Changes vs v008

1. FULL-BLEED SCROLL CONTAINER (§4.5 amendment): the scrollbar hugs the
   frame's right edge. Root cause of the v008 defect: `max-width` was set on
   the scroll container itself, so element edge — scrollbar included — ended
   mid-frame. The width cap now lives on an inner column instead.

---

## 1–4. Principles, palette, typography, layout (v009 revision of §4.5 only)

```css
.content{overflow-y:auto; min-height:0; padding:8px 24px 0;}  /* full column width, NO max-width */
.content>main, .content>footer{max-width:884px;}              /* inner cap: line length */
```

- Rule (normative): `max-width` is FORBIDDEN on any scroll container. Width
  caps apply to inner content wrappers only, so scrollbars always dock at
  the container/frame edge.
- Visual result: scrollbar runs flush against the frame's right 2px rule —
  the "complete page edge" placement. Content column keeps its 884px measure.
- Unchanged: locked header/sidebar, independent regions, mobile fallback,
  all tokens, sections, submenu, switching, §10.

## 5–10. Components, inventory, interaction, files, version/update

Unchanged.

## Appendix A — unchanged.
