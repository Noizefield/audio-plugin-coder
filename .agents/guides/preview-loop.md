# Preview loop (`apc watch` / `apc screenshot`)

Instant feedback for WebView frontends: edit source, the preview rebuilds and
reloads; render deterministic PNGs for review and visual diff.
Implementation: `scripts/apc-preview.js` (zero deps, Node 18+). Tests:
`test/preview.test.js`. WebView only (Visage plugins exit 2).

## `apc watch <Plugin>`

```bash
apc watch <Plugin>                      # watch + live preview on http://127.0.0.1:4873/
apc watch <Plugin> --once [--json]      # one cycle, no server (CI / agents)
apc watch <Plugin> --port 0 --no-serve --poll --debounce 400
apc watch <Plugin> --restart-standalone <path-to-Standalone.exe>
```

What it does:

1. Watches `<plugin>/Design/` and `<plugin>/Source/ui/` (recursive `fs.watch` on
   Windows/macOS and Node 20+ Linux; automatic polling fallback elsewhere, or
   force with `--poll`). Changes are **debounced** (default 250 ms, `--debounce`).
2. Per cycle: if a `Design/ui-map.json` (or `vN-ui-map.json`) exists, runs
   `scripts/ui-compose.js` (rewrites `Design/vN-test.html`, re-vendors
   `Design/apc-ui/`) then `scripts/ui-lint.js`. Plugins with a hand-written preview
   (no ui-map) skip compose/lint and only reload.
3. Writes `Design/.apc-reload` (JSON stamp: `seq`, `at`, `ok`, `changed`) and
   pushes a Server-Sent Event to subscribed pages.
4. Never retriggers on its own output (stamp, composed preview, vendored kit,
   screenshots, `.bak`/`.tmp`).

`--once` runs exactly one cycle and exits `0` (compose ok, lint clean) or `1`.
Exit `2` = usage/platform (no plugin, Visage plugin, bad flag).

### Live reload

The watcher serves, on loopback only (GET/HEAD, loopback `Host`):

| Path | Content |
|---|---|
| `/` | the newest `Design/vN-test.html` (else `Source/ui/public/index.html`) **with the reload snippet injected** |
| `/reload` | SSE stream; `{"type":"reload"}` after a good cycle, `{"type":"error",...}` after a failed one |
| `/state` | last cycle as JSON |
| `/<file>` | static files next to the preview (`apc-ui/*.css`, images, fonts) |

Open `/` and the page reloads itself on every good cycle. To make **any other**
preview page reload (e.g. the Hub's `/pdesign/<Plugin>/v1-test.html`), paste
this before `</body>` (compose does not inject it; it is a dev-only snippet,
never ship it):

```html
<script>(function(){try{var es=new EventSource("http://127.0.0.1:4873/reload");
es.onmessage=function(e){var d={};try{d=JSON.parse(e.data)}catch(x){}
if(d.type==="reload")location.reload();};}catch(x){}})();</script>
```

CORS: only loopback origins and `null` (a `file://` page) may read the stream.

### Restarting the Standalone build

`--restart-standalone <exe>` launches the executable when the watcher starts and
kills + relaunches it after every successful cycle. Only a process the watcher
started is managed. UNVERIFIED against a real JUCE Standalone (unit-tested with a
fake spawn only).

## `apc screenshot <Plugin>`

```bash
apc screenshot <Plugin>                                   # 100 %, Design/screenshots/<Plugin>.png
apc screenshot <Plugin> --out shots/a.png --scale 50,100,300
apc screenshot <Plugin> --scale endpoints                 # ui-map scale_range endpoints + 100 %
apc screenshot <Plugin> --width 800 --height 440 --dpr 2 --html Design/v3-test.html
apc screenshot <Plugin> --compare golden/a.png [--tolerance 8] [--max-mismatch 0.5] [--diff d.png]
apc screenshot --compare golden/a.png --against new.png   # pure image diff, no browser
```

- **Browser**: Edge, Chrome or Chromium, `--headless=new`. Discovery order:
  `--browser <path>`, `APC_BROWSER`, well-known install paths (Windows Edge
  first), then `PATH`. None found: exit `2` with the searched locations.
- **Size**: base = `ui-map` plate `cols x rows x cell_px` (default cell 16 px),
  else 800x500; `--width/--height` override. `--scale S` is the GUI scale in %
  (viewport = base x S/100, like resizing the plugin window); a list writes
  `<out>-<S>.png` per scale. `--dpr` multiplies output pixels.
- **Deterministic**: fixed viewport inside an exact-size iframe (headless windows
  clamp small sizes), `--force-device-scale-factor`, `--force-color-profile=srgb`,
  no LCD text/hinting, virtual time budget, CSS animations/transitions disabled
  by an injected style (the page file on disk is untouched; a temp copy
  `Design/.apc-shot-*.html` exists only during the render).
- **Compare** (`--compare baseline.png`): pure-JS PNG decode (zlib) and pixel diff.
  A pixel mismatches when any channel differs by more than `--tolerance`
  (default 8 of 255). Exit `1` when mismatched % > `--max-mismatch` (default
  0.5) or sizes differ. The diff image (red = mismatch over a dimmed baseline,
  default `<out>-diff.png`) and the % mismatch are the input for an AI visual
  review. With several scales and a directory as `--compare`, baselines are
  `<dir>/<out-name>-<S>.png`; with a file, `<baseline>-<S>.png`.

Golden shots for the test phase (`ui-layout-system.md`: scale-range endpoints +
midpoint) come from `--scale endpoints`; commit them under the plugin and gate
with `--compare`.

## Observed behaviour (this repo's test run)

Edge 156 and Chrome 156 on Windows rendered the same fixture pixel-identically
(0 differing pixels). Other OSes/fonts will differ: keep baselines per
platform and use `--tolerance`.
