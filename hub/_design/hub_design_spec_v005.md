# APC Hub — Design Language Spec v005

Status: DRAFT for review · Date: 2026-09-13 · App: `hub/` · Command: `/apc-hub`
Supersedes: `hub_design_spec_v004.md` (kept, do not edit).

## Changes vs v004

1. PERSISTENT HEADER (§4.4): the block logo + title + status badges move out
   of section 01 into a top bar that spans the frame and renders on EVERY
   view. Fixes: logo disappearing on navigation + "text on top" unreadable.
2. Sidebar slimmed: `APC/HUB_` line and title drop out of the mark (they now
   live in the header); mark keeps version + revision only. Badges move to
   the header beside the title.
3. Tokens, padding, themes, switching, §10: unchanged.

---

## 1–3. Principles, palette, typography

Unchanged.

## 4. Layout (v005 revision)

### 4.1–4.3 Shell, logo source, centered frame

Unchanged, except the frame now stacks vertically first:

```
+------------ centered frame, max 1340px -------------+
| HEADER: logo | title + tagline + badges             |
+----------+-----------------------------------------+
| SIDE     | CONTENT (exactly one section visible)   |
| 264px    | max 860px                               |
+----------+-----------------------------------------+
```

### 4.4 Persistent header (new, normative)

- `.frame` (centered, outer 2px rules) contains `header.topbar` followed by
  `.shell` (the 264px/1fr grid). The header is OUTSIDE all sections, so it
  renders identically on every hash view — the constant visual anchor.
- Header content: full `assets/APC_ASCII.txt` `<pre>` (left) + title line
  `APC HUB // read-only command center` + the three status badges
  (setup / profile / snapshot) stacked right of / under the logo.
- Static, not scroll-sticky (deliberate: a ~150px sticky bar would eat the
  viewport; revisit only if requested).
- Below 900px the header stacks (logo scrolls horizontally before title);
  it stays above the collapsed top-nav block.

### 4.2 Logo placement (v005 revision)

Header owns the ONLY full-size logo. 01 OVERVIEW starts directly with its
kicker — the header above it provides the anchor the v004 layout lacked.

## 5. ASCII component library

5.1–5.10, 5.12–5.14 unchanged.

### 5.11 Sidebar mark (v005 revision)

```
+--------------------+
| APC v1.4.0         |
| v005 · DRAFT       |
+--------------------+
```

Version-only box (framework version + hub revision). The `APC/HUB_` name
line and the sidebar title are gone — both live in the header now, no
duplication. Sidebar order: MARK → REL → NAV → THEME → sidefoot.

## 6–10. Inventory, interaction, files, version/update

Unchanged from v003/v004 (11 sections + ++ CONSISTENCY; `:target` switching;
theme script; §10 update-check as specified).

## 11. Open questions for the reviewer

1. Header static (v005) or scroll-sticky — which?
2. Badges in header (v005) vs back in sidebar — position right?
3. Sidebar now lean: anything missing, or is this the right density?
