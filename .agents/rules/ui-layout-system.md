# APC UI Layout System (WebView)

Canonical rules for all WebView plugin UI geometry, scaling, and the design
contract. Applies to every plugin under `paths.plugins_dir` that uses
`ui_framework: webview`. Read this before writing or modifying plugin UI code.

## The unit system — "authored plate in rem"

The UI is authored on a fixed-size **plate** measured in square **grid cells**.
`1 rem = 1 grid cell`. Scaling is pure CSS; no JavaScript computes geometry:

```css
:root  { --cols: <grid columns>; --rows: <grid rows>; }   /* per-plugin, from ui-map */
html   { font-size: min(calc(100vw / var(--cols)), calc(100vh / var(--rows))); }
body   { margin: 0; min-height: 100vh; display: grid;
         place-items: center; overflow: hidden;
         background: var(--apc-letterbox, #000); }
.apc-plate { position: relative; width: calc(var(--cols) * 1rem);
             height: calc(var(--rows) * 1rem); }
```

- `min()` picks the binding axis: when the window matches the plate aspect the
  plate fills edge-to-edge; on a host-forced aspect mismatch the plate
  letterboxes, centered, and the surround shows `letterbox_fill` — a declared
  token, never an improvised margin or background.
- Every element is positioned absolutely in `rem` from its manifest cell:
  `left/top/width/height` in whole or quarter `rem` (0.25 cell snap).
- **`px` is forbidden in authored markup.** Exceptions live inside the catalog
  (1px hairline borders, device-px shadow offsets). `em` allowed inside
  components for internal proportions.
- Scaling needs zero pointer-math correction: layout is real at every size, so
  hit-testing and `clientX/Y` are correct untouched.
- `devicePixelRatio` is handled by the engine; canvases re-fit via
  `apc-fit.js`'s `fitCanvas()` (`canvas.width = clientWidth * dpr`, redraw in
  CSS px via `setTransform(dpr,0,0,dpr,0,0)`).

**Forbidden mechanisms** (historical, do not reintroduce): `style.zoom`,
`transform: scale()` wrappers for scaling, JS-computed scale variables
(`Math.min(innerWidth…)` driving `--scale`), margin factors (`* .97`),
`cqw`/`cqh` (WebKitGTK < 2.46 lacks them). Breakpoints must use `vw` or JS —
`rem` inside media queries ignores the root font size (spec behavior).

## Layout modes (ui-map `layout.mode`)

| mode | meaning | native side |
|---|---|---|
| `fixed` | plate = window, no resize | `setResizable(false)` |
| `scalable` | uniform scale, aspect locked | `setResizable` + limits + `setFixedAspectRatio` |
| `adaptive` | scalable + declared breakpoint view swaps | same + JS-driven `data-view` class swap |

`layout.aspect_lock` (default true) is enforced in C++ AND re-asserted in
`resized()` via `snapWindowToAspect()` — host-initiated resizes bypass
`ComponentBoundsConstrainer` (known JUCE trap).

`layout.edge_policy`: `letterbox` (default) or `fill`. `letterbox_fill` names
the token shown in the margins. Never emit a scale margin or uncovered body
background.

`layout.resize_handle`: `corner-gripper` (default for resizable modes),
`edge-only`, `none`. The corner gripper is an **in-page** component
(`.apc-grip`, bottom-right, ≥ 2.5 cell hit area, `cursor: nwse-resize`)
forwarding drag deltas through the `resizeDrag` native function. Do NOT rely
on `ResizableCornerComponent` — the heavyweight webview paints over it and
swallows its hit-testing. `setResizable(true,true)` stays as a fallback.

## The contract — `Design/ui-map.json`

Design phase output and the design-lock artifact. Implementation consumes it
read-only; any element not in the map is a defect. Shape (see
`schemas/ui-map.schema.json`):

```json
{ "version": 1, "name": "MyPlugin",
  "layout": { "mode": "scalable", "plate": {"cols": 50, "rows": 27.5},
              "aspect_lock": true, "scale_range": [0.5, 3.0],
              "edge_policy": "letterbox", "letterbox_fill": "--surface",
              "resize_handle": "corner-gripper",
              "presets": [0.5, 0.75, 1.0, 1.5, 2.0], "breakpoints": [] },
  "tokens":   { "--surface": "#1a1a1f", "--ink": "#f0f0f5", ... },
  "sections": [{ "id": "mast", "cell": {"x":0,"y":0,"w":50,"h":4.5} }],
  "controls": [{ "id": "cutoff", "param": "cutoff", "component": "knob",
                 "cell": {"x":2,"y":6,"w":6,"h":6}, "label": "CUTOFF" }],
  "canvases": [{ "id": "meter-l", "kind": "vu-dial",
                 "cell": {"x":2,"y":5,"w":23,"h":14} }],
  "annotations": [] }
```

- `controls[].param` must match a parameter ID in
  `.ideas/parameter-spec.md`; control IDs render as `id="ctl-<param>"`.
- `component` must be a catalog component (`templates/webview/apc-ui/`).
- Cells must lie inside the plate and snap to 0.25 cells; overlaps only where
  `overlay: true` (grip, meter jewels, section chrome).

## Gates

- `apc validate ui --plugin <Name>` — manifest schema, cell bounds/snap,
  overlap, param cross-check vs parameter-spec, forbidden-mechanism scan of
  `Source/ui/public/index.html` (zoom / JS scale / margin factors / raw px),
  control-manifest↔DOM parity, grip presence per `resize_handle`.
- Design approval locks `ui-map.json` (record its hash in `status.json`).
- Test phase screenshots at `scale_range` endpoints + midpoint must match the
  approved golden shots.

## Kit vendoring

`templates/webview/apc-ui/` is the canonical catalog. At impl time it is
**copied** into `Source/ui/public/apc-ui/` of the plugin (frozen per plugin).
Never edit the vendored copy — fix the template and re-vendor.
