# Visage windowless raster clips to dead margins when rasterQuality < 1

**Issue ID:** visage-001
**Category:** ui
**Severity:** critical
**First Detected:** 2026-09-29
**Resolution Status:** solved

---

## Problem Description

Myriaplex (Visage UI) rendered its content clipped into the top-left of the
editor with black dead margins on the right and bottom whenever the window was
enlarged past the point where the windowless host's adaptive `rasterQuality_`
stepped below 1.0. At native 1440x900 everything looked fine; any larger
window progressively showed a smaller drawn region ("void" screenshots).

## Symptoms

- Content drawn to only ~`rasterQuality^2` of the window area (e.g. 0.76 ->
  ~58% coverage); black margins right/bottom.
- Drawn-region edge tracks the canvas framebuffer size, and inside the
  backbuffer the content edge tracks `region * dpiScale` (double scaling).
- Probes show view/canvas/region/native all consistent — geometry was never
  the problem; the clip was in the raster path.

## Root Cause

`visage::Canvas::beginRegion()` set the draw clamp as
`setClampBounds(0, 0, region->width(), region->height())` AFTER
`setLogicalPixelScale()` had made `state_.scale = dpi_scale_`.
`setClampBounds` multiplies its arguments by `state_.scale`, but region bounds
are already device pixels (`Frame::setBounds` bakes `native = logical *
dpi_scale_`). Net clamp = `region * dpi_scale` while emitted geometry is
`logical * dpi_scale` — a second dpi multiply that shrinks the clip window
whenever dpi < 1. Upstream visage never hits this because real display scales
are >= 1.0; APC's `rasterQuality_` downscale (VisageJuceHost.h) is the only
dpi < 1 caller. The same double-scale pattern existed in
`Canvas::setDimensions()` for the canvas-level clamp.

## Solution

Fixed in vendored `_tools/visage` (submodule carries local APC patches):

- `visage_graphics/canvas.h` — `beginRegion()` now assigns the clamp directly
  in device space:
  `setClampBounds({ 0.0f, 0.0f, region->width() * 1.0f, region->height() * 1.0f });`
- `visage_graphics/canvas.cpp` — `setDimensions()` same fix for the
  canvas-wide clamp.

Do NOT "fix" this host-side by keeping `canvas_->setDpiScale(1.0)`; the dpi
scale is what maps logical draw coords into the reduced raster framebuffer —
removing it just moves the clip to the framebuffer edge.

## Verification

- Resize standalone to 1800x1156 (or any size with rasterQuality < 1) ->
  content fills the client edge-to-edge on all pages.
- Probe: `canvas=[w*raster, h*raster, raster]` and `region` matches canvas.
- `APC_PAINTLOG`-style instrumentation confirmed bb painted then stretched.

## Related

- `common/VisageJuceHost.h` `applyCanvasSizing()` / `rasterQuality_`.
- Prior APC patch in `visage_ui/frame.h`: `setDpiScale` re-bakes
  `native_bounds_` via `setBounds(bounds_)` — required companion fix.

## Tags
visage, windowless, dpi, rasterQuality, clipping, resize, dead-margin
