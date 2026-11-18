# Local patches for `_tools/visage`

The `_tools/visage` submodule is pinned at upstream commit
`968d7801` (2026-01-19, "Heat map utility functions.") from
<https://github.com/VitalAudio/visage>. APC needs a few fixes on top of that pin.
Submodules cannot carry local edits, so they live here as patch files.

## Apply

From the repository root, after `git submodule update --init _tools/visage`:

```bash
git -C _tools/visage apply ../../patches/visage/0001-fix-resize-leaks-and-dpi-clip.patch
```

Check first with `git -C _tools/visage apply --check ...`. If the check fails, the patch
is already applied or the submodule pin has moved; see the status table below.

## What `0001-fix-resize-leaks-and-dpi-clip.patch` fixes

| File | Fix | Upstream `main` (checked 2026-11-18, source read only) |
|---|---|---|
| `visage_graphics/layer.cpp` | `destroyFrameBuffer()` also destroys the read-back texture; it leaked on every resize and exhausted bgfx handles/VRAM during drag-resize | **Fixed upstream** |
| `visage_ui/frame.h` | `setDpiScale()` re-derives bounds after a DPI change so the region is not left sized to the old raster | **Partly fixed upstream** (only when the frame has a parent; the root frame is still not re-baked) |
| `visage_graphics/canvas.h`, `canvas.cpp` | Clamp bounds for a region/canvas are already device pixels; `setClampBounds(x, y, w, h)` multiplies by `state_.scale` again, so the clip shrinks to scale² when the raster runs below 1.0 dpi | **Still present upstream** |
| `visage_graphics/canvas.cpp`, `layer.h` | `setWindowless()` / `setWindowlessRender()` with an unchanged size returns early instead of rebuilding the framebuffer, renderer and read-back on every resize tick | **Still present upstream** (performance, not correctness) |

When the submodule is bumped to a newer upstream, drop the fixed hunks and keep only
what is still needed.
