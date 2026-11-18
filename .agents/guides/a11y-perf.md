# Accessibility + performance budget (`apc validate a11y`)

```bash
apc validate a11y --plugin <Name> [--json] [--html Source/ui/public/index.html]
```

Static analysis of the plugin UI source; implementation
`scripts/validators/a11y.js`, tests `test/a11y-validator.test.js`. Exit `1` on any
`fail`, `0` otherwise (`warn`/`info` never fail). Nothing is rendered or executed:
controls created by JavaScript at runtime are invisible to it, so this does
not replace a manual keyboard/screen-reader pass.

## What is analysed

WebView: the UI entry document is the shipped `Source/ui/public/index.html`, else
the newest `Design/vN-test.html`, else any `*.html` (override with `--html`),
plus its linked/inline CSS and JS (`apc-ui/*` links fall back to
`templates/webview/apc-ui/`). Visage: INFO plus the statically possible
checks (contrast of `Design/ui-map.json` tokens, `startTimerHz`, keyboard
handlers in `Source/`, reduced-motion handling).

## Checks

| Check | fail when | warn when |
|---|---|---|
| `contrast-text` | a resolvable text/background pair is under **4.5:1** (3:1 for large text: >= 24 px, or >= 18.66 px bold) in any theme | - |
| `contrast-ui` | focus ring or `--accent` indicator under **3:1** | control borders / svg fill-stroke under 3:1 (WCAG 1.4.11 exempts controls identified by text, so heuristic) |
| `keyboard-reach` | custom control (`data-param`, `role=slider/button..`, `onclick`) lacks `tabindex>=0` | `tabindex=-1` on native control; positive tabindex |
| `accessible-names` | interactive element has no `aria-label`/`aria-labelledby`/label/text/`title` | - |
| `focus-visible` | outline removed and no `:focus-visible` replacement | - (info = relies on default ring) |
| `hover-only-info` | non-interactive element carries info only in `title` | `:hover` reveal with no `:focus` twin; control named only by `title` |
| `non-text-alternatives` | - | `<canvas>` meter without `aria-label`/`role=img` |
| `reduced-motion` | `@keyframes`/`animation` and no `prefers-reduced-motion` override (CSS or `matchMedia`) | only transitions / rAF loops |
| `perf-animated-elements` | - | > 12 animated elements |
| `perf-backdrop-filter` | - | > 2 `backdrop-filter` rules (info for 1-2) |
| `perf-shadows` | - | > 4 shadow layers with blur > 24 px |
| `perf-meter-rate` | declared meter/UI rate or `startTimerHz` **> 60 Hz** (also `setInterval` < 16 ms) | none declared although meters/canvases exist |
| `perf-webview-overhead` | measured value > budget | - (info: budget + "no measured value") |

**Themes.** Custom properties are resolved (`var()` chains, fallbacks; hex,
`rgb()/rgba()`, `hsl()/hsla()`, named colours, alpha composited over the
background). Theme overlays are detected from `[data-theme=x]`, `.theme-x`,
`.night/.day/.dark/.light` and `@media (prefers-color-scheme)`; the base theme
and **every declared theme** are evaluated and the message lists them. Pairs
that cannot be resolved statically (gradients, `color-mix`, JS-set) are
reported as skipped.

## `perf_budget` in `status.json` (optional)

```json
{
  "perf_budget": {
    "webview_overhead_mb": 120,
    "meter_hz": 30,
    "measured": { "webview_overhead_mb": 95, "at": "2026-11-07" }
  }
}
```

Default budget 120 MB. Record `measured.webview_overhead_mb` after measuring the
host/Standalone process with WebView2 loaded vs. the same build without UI;
the validator compares it against the budget but never measures. A bare number
(`"perf_budget": 150`) is read as the MB budget.

## Fixing the common findings

- Custom knobs/faders (APC kit `div.apc-knob`): add `tabindex="0"`,
  `role="slider"`, `aria-label`, `aria-valuemin/max/now`, and arrow-key handling.
- Keep a visible focus ring: `:focus-visible { outline: 2px solid var(--accent); }`.
- Wrap animation in `@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }`.
- Help text belongs in visible text or `aria-describedby`, not only `title`.
- Meter redraw <= 60 Hz: `const METER_HZ = 30;` and drive from the native timer.
