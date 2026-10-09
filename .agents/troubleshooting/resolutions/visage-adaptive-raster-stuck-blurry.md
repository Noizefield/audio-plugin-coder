# Visage windowless UI stays blurry after window resize

**Issue ID:** visage-002
**Category:** ui
**Severity:** high
**First Detected:** 2026-09-30
**Resolution Status:** solved

## Problem

After resizing the editor window, the whole UI looked soft / out of focus
and stayed that way — not just during the drag.

## Symptoms

- Blurry, unsharp text and hairlines after enlarging the window.
- Persists after the drag ends; never re-sharpens.
- Worst on large windows (the ones that make frames expensive).

## Root Cause

`common/VisageJuceHost.h` adaptive `rasterQuality_` (windowless mode renders
at `uiScale * rasterQuality_`, then `paint()` bilinear-stretches the
backbuffer to the editor bounds):

- During a resize drag every `resized()` reallocs the FBO, so frames are
  expensive and `frameEma_` spikes -> quality ratchets down (−0.08/step).
- Recovery required `frameEma_ < 7ms` at +0.05/step, but rendering the
  *reduced* raster is cheap, so EMA typically landed in the 7–14ms
  deadband where neither branch fired -> the reduced raster (and the
  blur) was pinned **indefinitely**.

## Solution

In `VisagePluginEditor::timerCallback` / `resized`:

- `resized()` resets `settleTicks_` and re-arms `snappedAfterResize_`.
- Once no `resized()` has fired for ~30 ticks (~0.5s), quality snaps back
  to 1.0 once — the resting image is always rendered at native. If native
  is genuinely unaffordable, the overload step-down walks it back under
  sustained load only.
- Recovery thresholds widened: down-step now needs `frameEma_ > 16ms`
  (was 14), up-step fires below `< 12ms` (was 7) at +0.10 (was +0.05).
  Static UI skips the readback so EMA decays to ~0 and quality always
  returns to native at rest.

## Verification

- `MYRIAPLEX_RASTERLOG=<path>` env var makes `applyCanvasSizing()` append
  `canvas=[w,h] raster=… quality=… uiScale=… view=[w,h]` lines — ground
  truth for the effective raster scale.
- Simulated drag (MoveWindow loop, ~90ms steps): quality dropped
  1.0 -> 0.92 during the drag, then snapped back to `raster=1.000` on
  settle; final `canvas` == `view`. Screenshots confirmed sharp text on
  all pages at ~1980x1236.

## Follow-up (same day): intermittent "~1 s later" re-blur

Residual symptom: after resize the UI sharpened on the settle snap, then
went soft again ~1 s later — intermittently. Cause: the down-step still
fired on a single cooldown window with `frameEma_ > 16ms`. The first
native frame after the snap is the most expensive (realloc + full-res
pipeline), so one EMA spike at the next 20-tick boundary stepped quality
right back down; cheap reduced-raster frames then re-raised it, producing
visible oscillation.

Fix: degrade is now earned, not sampled:

- Down-step needs `frameEma_ > 24ms` across ~3 consecutive cooldown
  windows (seconds of sustained overload) — one-off spikes can't trigger.
- Instant bail only for a pathological `frameEma_ > 45ms`.
- Floor raised 0.55 -> 0.70 so the worst-case soften stays mild.
- The settle snap also resets `overloadStreak_`, giving native a fresh
  evaluation window after every resize.
- Recovery still `frameEma_ < 12ms` at +0.10 — cheap frames return to
  native quickly.

Verified: 4 rapid resizes + 4 s settle — `rasterQuality_` never left
1.000 and `canvas == view` throughout.

## Related

- `visage-001` (sub-native clip) — the *other* half of resize rendering;
  that fix made the reduced raster draw correctly, this one controls when
  the reduced raster is used at all.
- `common/VisageJuceHost.h` `applyCanvasSizing()`, `rasterQuality_`.

## Tags

visage, windowless, rasterQuality, resize, blur, upscaling, adaptive-quality
