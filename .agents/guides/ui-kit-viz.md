# UI kit viz: graph, envelope, spectrum, waveform, scope, meter, stepseq, xypad, picture

Agent-facing usage for `templates/webview/apc-ui/apc-viz.js` + `apc-viz.css` (+ the mock feed `apc-mock-viz.js`).
Binding contract: `templates/webview/apc-ui/CONTRACT.md`. The complete per-element reference (markup, every `data-*`
option, events, JS API, keyboard map, ARIA) is the **header comment of `apc-viz.js`**: read it before using an element.
Design: "APC Minimal" - flat, square, 1 px hairlines, mono uppercase labels, one signal colour. Layout: `.agents/rules/ui-layout-system.md`.

Never hand-roll graphs, meters, sequencers or pads: use these elements, position them with `.apc-cell` (rem boxes), and
restyle by overriding CSS tokens (never by editing component CSS). The look of every element is specified in
`design_library/apc-minimal/design-system.json` `elements`; `--apc-viz-node` (node / thumb size, .625rem) is a design token,
`--apc-viz-w` / `--apc-viz-h` (standalone size) are per-element overrides. Users may place **many** instances of every element.

## Load order (classic scripts, no modules)

```html
<link rel="stylesheet" href="apc-ui/apc-core.css">
<link rel="stylesheet" href="apc-ui/apc-viz.css">
<link rel="stylesheet" href="design-theme.css">         <!-- tokens (APC Minimal tokens.css or your own), AFTER the kit -->
<script src="apc-ui/apc-fit.js"></script>
<script src="apc-ui/apc-kit.js"></script>
<script src="apc-ui/apc-bridge.js"></script>
<script src="apc-ui/apc-mock.js"></script>               <!-- optional: browser preview / Hub / tests -->
<script src="apc-ui/apc-viz.js"></script>
<script src="apc-ui/apc-mock-viz.js"></script>           <!-- optional: animated MOCK data; never ship in a plugin build -->
<script>APC.mount(document);</script>
```

## Elements at a glance

```html
<div class="apc-cell" data-apc="graph" data-label="EQ" data-xscale="log" data-xmin="20" data-xmax="20000" data-ymin="-18" data-ymax="18"
     data-xunit="Hz" data-yunit="dB" data-nodes='[{"id":"b1","x":"eq_f1","y":"eq_g1","q":"eq_q1","label":"1"}]'></div>
<div class="apc-cell" data-apc="envelope" data-attack="env_a" data-decay="env_d" data-sustain="env_s" data-release="env_r"></div>
<div class="apc-cell" data-apc="spectrum" data-viz="spec" data-label="Spectrum" data-style="fill"></div>
<div class="apc-cell" data-apc="waveform" data-label="Sample"></div>
<div class="apc-cell" data-apc="scope" data-viz="osc" data-label="Scope"></div>
<div class="apc-cell" data-apc="meter" data-meter="out" data-channels="2" data-label="Output"></div>
<div class="apc-cell" data-apc="stepseq" data-count="16" data-rows="4" data-viz="seq" data-param="seq_steps" data-label="Steps"></div>
<div class="apc-cell" data-apc="xypad" data-x="cutoff_hz" data-y="resonance_pct" data-label="Filter pad"></div>
<div class="apc-cell" data-apc="picture" data-alt="Cover art" data-src="art/cover.png" data-fit="cover"></div>
```

| Element | Interactive | Bound to | Feed (`viz` event) |
|---|---|---|---|
| `graph` | nodes (optional) | params per node (`x`, `y`, `q`) | curves |
| `envelope` | ADSR or N-point nodes | `data-attack/decay/sustain/release` | - |
| `spectrum` | no | - | dB bins |
| `waveform` / `scope` | no | - | peak columns / samples |
| `meter` | clip-lamp button | meter id (`data-meter`) | dB level(s), or the `meter` event |
| `stepseq` | paint / keyboard grid | optional array param, `stepseq` event | playhead step |
| `xypad` | drag / keyboard | two params | - |
| `picture` | no | - | overlay spectrum |

Instances expose their JS API on `el.__apcViz` (= `APC.viz.get(el)`): `graph.setCurves([...])`, `setNodes([...])`,
`setRange({...})`, `redraw()`, `spectrum.setData(db)`, `meter.setLevel(db)`, `stepseq.getSteps()/setSteps()/setPlayhead(n)`, ...

## Data feed: the `viz` bridge event

One generic event carries every live display payload: `{ id, data }` (native emits it as `apc.viz`; JS listens through
`APC.bridge.on("viz")`; the kit registers ONE listener and routes by id). `data` is JSON numbers (or Float32Array in JS):

| Consumer | Payload |
|---|---|
| spectrum | `{type:"spectrum", db:[...], fs:48000}` (linear bins 0..fs/2) or `{..., log:true}` (bins already log-spaced over fmin..fmax); a bare array = dB bins |
| meter | `{type:"meter", db: n \| [l,r], peak?}` or a bare dB number / `[l,r]`; the older `meter {id,value}` event also works (`value` linear, or dB with `data-input="db"`) |
| waveform / scope | `{type:"waveform", min:[..], max:[..]}` or `{type:"waveform", samples:[..]}`; static replaces, scroll appends |
| stepseq | `{type:"playhead", step:n}` or `n`; `{type:"steps", steps:[..]}` sets the pattern |
| graph / envelope | `{type:"curve", values|points}` / `{type:"curves", curves:[..]}` |

Native side: send at display rate (about 30 fps), downsample in the DSP/analysis thread (FFT magnitudes in dB, peaks per
column), never per audio buffer. `APC.viz.biquadResponse(...)` exists only to draw a demo curve; **real analysis comes
from the DSP/native side**.

## Mock data for demos and tests

`apc-mock-viz.js` drives every subscribed element at ~30 fps: `APC.mockViz.start({seed, fps, manual, force})`, `stop()`,
`step(n)` (synchronous frames), `seed(n)`. It starts itself unless `prefers-reduced-motion` is set, the bridge is native, or
`window.APC_MOCKVIZ_AUTOSTART === false`; under reduced motion an explicit `start()` emits one static frame. Seeded runs
are deterministic (frame-index time base). Delivery goes through `APC.bridge._dispatch("viz", ...)` so real bridge consumers hear it.

## Rules the elements implement (do not re-implement)

- **Tokens at draw time**: canvas colours come from `--viz-*`, `--meter-*`, `--step-*`, `--led-*`, `--apc-mod-*`, `--ink`,
  `--rule`, `--inset` (read with `getComputedStyle` on the element). They redraw on `data-theme` change (any ancestor), on
  `theme:changed`, on resize / rem-scale change and on `APC.viz.refreshTheme()`. A product restyles by overriding tokens.
- **Hairlines**: grid, frames and zero lines are 1 device pixel (`--stroke`), pixel aligned; the canvas is sized in whole
  device pixels so the compositor never blurs it. Check HiDPI (`--force-device-scale-factor=2`) and fractional rem scales.
- **Performance**: one shared `requestAnimationFrame` (plus a timeout fallback while the page is visible), repaint only when
  dirty, offscreen / hidden views skip, no per-frame allocation in drawing loops, spectrum/waveform columns mapped once.
- **Params**: drags are one `apc.param.begin ... set* (throttled 16 ms) ... end` gesture; host automation arrives as `param`
  events and moves nodes/thumbs unless a gesture is active; Alt/Option+click resets; unknown params raise a visible error.
- **A11y**: roles and names on every element, text alternatives for data viz (`aria-describedby`, updated max once per
  second), real focusable nodes/thumb/lamp/cells, keyboard for every gesture, `prefers-reduced-motion` (no smoothing, no
  fall animation, mock does not auto-run).
- **No network**: pictures accept only relative paths and `data:image/...`; `http(s):`, `//`, `file:`, `javascript:` are
  rejected with a visible error and an `error` event. A picture without `data-alt` shows a warning toast.

## Testing

`templates/webview/apc-ui/tests/kit-viz.html` (+ `harness-viz.js`) runs under `node bin/apc.js kit test`: pixel assertions on
token colours in night and day, theme-change redraw, device-pixel hairline width, DPR 2, node drag/keyboard/wheel param
gestures against a spy bridge, stepseq paint/playhead/modes, meter ballistics and clip latch, picture URL rejection, 22 mixed
instances, RAF/hidden/offscreen behaviour, mock determinism and dispose leaks (observers, RAF, bridge listeners, DOM).
Screenshot / demo plate: `tests/kit-viz.html?demo=1[&theme=day]` (`tests/kit-viz-demo.js`), e.g.
`msedge --headless=new --screenshot=out.png --window-size=1280,704 --virtual-time-budget=8000 file:///.../kit-viz.html?demo=1`.
In headless runs frames and observer callbacks can be late: tests use `APC.viz.flush(true)` and `APC.viz._test.onIntersect`.
