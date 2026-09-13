# APC Hub - Design Language Spec v007

Status: DRAFT for review · Date: 2026-09-13 · App: `hub/` · Command: `/apc-hub`
Supersedes: `hub_design_spec_v006.md` (kept, do not edit).

## Changes vs v006

1. DOCUMENTATION SUBMENU (§5.16): the sidebar `10 DOCUMENTATION` item is now
   a native `<details>` collapser (zero JS, closed by default) listing all 16
   docs. First child `INDEX (ALL DOCS)` opens section 10; each doc opens its
   own right-side section.
2. PER-DOC SECTIONS (§6.2 revision): one section per doc (`doc-*` ids) with
   title, meta, full real baked `##` chapter list, back-to-index link. Pager
   chain runs linearly 09 → index → 16 docs → ++ CONSISTENCY, 27 views total.
3. Parent highlight: one `:has` rule with attribute-prefix match
   (`section[id^="doc-"]:target`) lights the parent for every child view.
4. Full doc TEXT stays live-app scope (§6.2): a static `file://` mockup
   cannot fetch `.md` at runtime (no converter, no deps allowed), so v007
   demonstrates the complete navigation + index structure with real headings;
   bodies arrive with `/api/v1/docs` in the app phase.
5. Build order unchanged (overview/projects first, docs API later).

---

## 1–4. Principles, palette, typography, layout

Unchanged (sticky header kept as approved).

## 5. ASCII component library

5.1–5.15 unchanged, plus:

### 5.16 Sidebar submenu (new, normative)

```html
<details class="navsub">
<summary>10 DOCUMENTATION</summary>
<a href="#10-documentation">INDEX (ALL DOCS)</a>
<a href="#doc-readme">README</a>
...
</details>
```

- Closed by default (user requirement). `+`/`-` ASCII markers like §5.15.
- Children indented (`padding-left:18px`), short labels
  (README, BUILD, CODEX COMPAT, …), same invert+`>` active system.
- Parent summary inverts whenever the index OR any `doc-*` section is
  targeted (prefix-match `:has` rule - the single exception to one-rule-
  per-view; documented here).
- Summary itself is NOT a link (avoids toggle-vs-navigate conflict); the
  INDEX child is the section entry point.

## 6. Page inventory (v007 revision)

### 6.2 DOCUMENTATION (revision)

- Section 10 = index overview (search dummy + 16 `<details>`, each with an
  `OPEN AS SECTION →` link into the per-doc section).
- 16 × `doc-*` sections in fixed order: README, BUILD-SYSTEM,
  CODEX-COMPATIBILITY, CODEX-ORCHESTRATION, COMMAND-REFERENCE, FAQ,
  GITHUB-ACTIONS, ICON-MANAGEMENT, INSTALLER-CREATION, MODEL-ROUTING,
  LIFECYCLE, PROJECT-STRUCTURE, SHIP-WORKFLOW, STATE-MANAGEMENT,
  TROUBLESHOOTING, WEBVIEW.
- Pager chain extended linearly (27 stops total).
- Live-app §6.2 API design unchanged; per-doc sections become reader views
  fed by `/api/v1/docs/:id`.

## 7–10. Interaction, files, version/update

Unchanged. File convention addendum: large mockups may be assembled by
script (html authored once, `.md` fence generated) - verified by
FENCE-MATCH, no hand duplication.

## Appendix A - unchanged.
