# RAMS 60 — Design Library Entry

Dieter Rams / Swiss 1960s hi-fi instrument design system, extracted from the VinylNoize
project (design v9).

## Contents

- `preview.html` — working interactive preview (open directly in a browser)
- `Noizefield_NF_Logo_150x150.webp` — sample label art asset used by the preview
  (replace with your own logo when reusing; the preview falls back to the cream
  "33⅓" label if the file is missing)
- `design-system.json` — machine-readable tokens (palette, typography, components,
  motion rules) consumed by the APC design workflow

## Signature elements

1. Ivory faceplate + single shellac-black rotating disc as sculptural contrast
2. Braun signal-green (`#1F7A3D`) for functional/measured states; Braun orange
   (`#D9531E`) strictly for degradation/hot/exceeded states
3. Numbered index chips (01–10) on every control; engraved-style rules and tick scales
4. Canvas turntable centerpiece: constant-length tonearm on a fixed pivot,
   procedural aging render, drag-to-scratch gesture with audio feedback
5. Footer status ladder wired to the master macro
   (BYPASS → LIGHT DUSTING → TRACING → REFERENCE FINGERPRINT → WORN PRESSING → COLLAPSE)

## Reusing

Apply via `/apc-design` → "Use existing design" → `rams60`. All motion respects
`prefers-reduced-motion`. Preview requires no build step or external dependencies.
