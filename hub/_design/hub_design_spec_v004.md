# APC Hub — Design Language Spec v004

Status: DRAFT for review · Date: 2026-09-13 · App: `hub/` · Command: `/apc-hub`
Supersedes: `hub_design_spec_v003.md` (kept, do not edit).

## Changes vs v003

1. TABLE PADDING RULE (§5.14): all cells get left air; first column never
   touches the outer rule (fixes v003 screenshot).
2. CENTERED SHELL (§4.3): app framed at max 1340px, auto margins, 2px outer
   rules. Sidebar stays left of content — centering wraps the whole shell.
3. FRAMEWORK VERSION + UPDATE CHECK (§10): version shown top-left in the
   sidebar mark (source: `package.json`); update-detection mechanism
   specified, mocked honestly in v004, implemented in the live app phase.
4. Tokens, themes, components otherwise unchanged.

---

## 1–3. Principles, palette, typography

Unchanged from v002/v003.

## 4. Layout (v004 revision)

4.1–4.2 unchanged (shell grid, logo placement), plus:

### 4.3 Centered frame (new)

```css
.shell{display:grid; grid-template-columns:264px 1fr;
  max-width:1340px; margin:0 auto; min-height:100vh;
  border-left:2px solid var(--rule); border-right:2px solid var(--rule);}
```

- Restores the v001/v002 centered-page feel; the sidebar remains the left
  column of the centered frame (not viewport-docked).
- Content column keeps max 860px so line length stays readable on ultrawide.
- Below 900px: stacked as before, frame borders retained.

## 5. ASCII component library

5.1–5.13 unchanged, plus:

### 5.14 Table cell padding (new, normative)

```css
th,td{padding:8px 12px 8px 14px;}
```

- 14px left padding on EVERY cell: first-column text never touches the outer
  rule (the v003 defect), inter-column air stays even.
- Header keeps 2px bottom rule; row rules 1px. No other table restyle.

### 5.11 Sidebar mark (v004 revision)

```
+--------------------+
| APC/HUB_           |
| APC v1.4.0         |
| v004 · DRAFT       |
+--------------------+
```

- Line 2 = framework version, source `package.json` (`"version"` field).
  `bin/setup.js` banner carries the same string; hub CONSISTENCY flags a
  mismatch as `[!!]` (new check, see §10).
- Line 3 = hub mockup revision (design iteration, NOT framework version —
  the two must never be confused; label says DRAFT until approved).

## 6–9. Inventory, interaction, files

Unchanged from v003, except the live-CSS map gains `shell.css` already
listed; no new files.

## 10. Framework version + update check (new)

### 10.1 Version source

- Canonical: `package.json → version` (currently `1.4.0`).
- Mirror: `bin/setup.js` banner string. Both must match; hub displays the
  `package.json` value and reports mismatch in ++ CONSISTENCY.

### 10.2 Update-check mechanism (live app phase; mocked in v004)

- Endpoint: `GET https://api.github.com/repos/Noizefield/audio-plugin-coder/releases/latest`
  → `tag_name` (expected form `vX.Y.Z`, strip leading `v`).
- Compare: semver `installed < upstream` ⇒ update available. Non-semver
  tags ⇒ `[..]` + raw tag shown, never a false `[OK]`.
- Trigger: once at hub server start + manual re-check control; result
  cached 24h in server memory (no disk writes in phase 1).
- Failure (offline / rate-limit / no releases yet): `[..] UNCHECKED` +
  reason, never red — absence of information is not failure.
- Future scripts: `scripts/apc-update-check.ps1` / `.sh` (shared fetch +
  compare, used by server AND usable standalone). Future endpoint:
  `GET /api/v1/update → {installed, upstream, state}`.
- States and rendering (sidebar REL block + 01 OVERVIEW row):
  `[OK] CURRENT v1.4.0` (green) · `[!!] UPDATE vX.Y.Z AVAILABLE` (amber) ·
  `[..] UNCHECKED reason` (muted).
- v004 mockup renders installed `v1.4.0` honestly and upstream as `[..]`
  with note `live check in app — spec §10` (static file cannot check).

## 11. Open questions for the reviewer

1. Padding 14px enough, or want more air (16–18px)?
2. Centered frame with outer rules — keep, or borderless centering?
3. Update cadence: start-up + manual enough, or also periodic (hourly)?
4. Auto-download/install later, or check-notify forever?
