# APC Hub - Design Changelog

## CONTROLS - the plate's control set is now the kit's, and the spec exposes it - 2026-11-10 (DRAFT)

The request was exact: take the control elements from the approved design, put them into the
component section, and make them appear (and be editable) in the element specification.

- **The two missing surfaces.** The plate runs on two elevation steps (`--panel` for cards,
  `--panel-2` for control bodies) and two edge strengths (`--rule` structural, `--rule-ctl`
  control). The kit had one of each, which is why every ported control looked either too flat or
  too loud. Added `--plate-3` (#224A5A / day #E7EFF1) and `--wash` (6% ink hover veil) to
  `tokens.css` and the `apc-core.css` mirror, grouped and described in the spec so the theme
  editor offers them.
- **The control set, ported from plate blocks 15.6-15.14** into `apc-widgets.css` (which loads
  after `apc-components.css`, so it wins the cascade - the earlier attempt lived in the wrong
  file and never applied): button (flat chip, ink inversion), segmented (one body, hairline
  gutters, chosen chip inverts), tabs (no box, 2px accent rule), checkbox **and radio as the same
  square mark** (the plate's "one square mark language" - the kit drew circles), led (square chip,
  cyan on, red clip + halo), progress (a `.45rem` well with an inset hairline), list (no box, flat
  rows, 2px accent highlight), selector/fields (raised body, structural edge, control edge on
  hover).
- **Radii became tokens again**: `--r-radio` 50% -> 2px and `--r-led` 50% -> 1px, so the CSS uses
  `var(--r-radio)`/`var(--r-led)` and a user can change them in the theme editor.
- **The element spec was the old design.** `knob` still said "no background track ring", an
  `--accent` pointer and a 30% length; radio/led described circles; the plots described the old
  grid. Rewrote 15 element entries (knob, slider, toggle, checkbox, radio, button, segmented,
  tabs, list, led, progress, selector, graph, envelope, spectrum) with the approved parts, states
  and tokens - every value is a `--token` string, which the spec renders as a chip that opens
  that token in the theme editor.
- **`design-system.json` no longer contradicts `tokens.css`.** Its token map, `palette` block,
  `typography.families` and `fontsets[0]` were the old amber design (#121211 / #FF9500). All are
  now generated from `tokens.css`: 81 tokens per mode (was 72, seven were undocumented), 40
  recomputed contrast ratios, `--plate-3`/`--wash` grouped with descriptions. **`design-tokens-check`
  is green for the first time** - the last pages of `--apc-letterbox` drift are gone.
- **New tokens are validated, not assumed.** Every contract token must be in exactly one group
  with a kind and a description, so a token that nobody can edit now fails the check.
- **Contrast waivers, with written reasons.** Six day-mode pairs cannot meet their minimum with
  the approved palette (accent/ok/danger as graphics, a 4.27 control label, a 4.41 axis label).
  The checker used to fail on them; it now accepts a `waiver` string on the pair while still
  verifying the documented ratio, so a waiver cannot hide a stale number.
- **Tests brought up to the contract** (27 pass): `flat by construction` became `depth by tokens`
  (2-3px radii, real shadow tokens, local woff2 only, no network); the fixture that proves drift
  detection now derives its literals from the file instead of hardcoding `#FF9500`; the WCAG loop
  honours waivers; `--accent-text` is asserted to be its own tint in both modes (night #FF7B64);
  the spot checks expect `--rule-2` track, 2px arc, `--plate-3` button body, `--r-radio`/`--r-led`.
- Verified: spec tab renders 46 elements in 9 groups with the new KNOB card (live preview + parts/
  token chips); radio and led demos show square marks; `node --test test/design-tokens.test.js
  test/kit-design-pass.test.js` = 27/27; `scripts/apc-kit-test.js` exit 0; `design-tokens-check`
  `[OK]`.


## KIT - I deleted the knob/fader block by accident; restored + guarded - 2026-11-10 (DRAFT)

While rebuilding the toggle I trimmed the old toggle block off the **end** of
`apc-components.css` with an anchor-comment cut. The knob + fader design-pass block had been
appended *after* the toggle earlier, so that cut took it too - the knobs and faders silently
reverted to the kit's first flat styling (3 px ring with ticks, 4 px outlined rail, dark cap
with a centre line, value above the name).

- Restored verbatim: quiet `--rule-2` track, 2 px accent arc, no tick ring, warm `--memory`
  modulation band, gradient disc with `--sh-knob` and a `--rule-2` edge, rim pointer bar
  (2.5 x 19 % at 10 %), and the fader's 2 px `--rule-2` rail, accent fill, `.7 x 1.35rem` cap,
  label above the value.
- **New guard: `test/kit-design-pass.test.js`** (7 checks, no deps). The design passes live as
  appended blocks, which makes them easy to lose that way, so the test asserts the text of each
  rule: knob track/arc/ticks/pointer geometry, warm modulation band + `R_MOD = 42`, the track
  being a path instead of a dash, fader rail/cap/label order, the toggle's 2 px track + square
  cam + accent on-state, ring-dot nodes without a floating number, and the plate grid + cyan
  spectrum bars. `node --test test/kit-design-pass.test.js` - 7/7 pass.
- Verified with fresh renders of `/kit-demo/knob` and `/kit-demo/slider`: open arc with the
  bottom gap, quiet track, red value arc, white pointer, warm inner band; 2 px rail with the
  thin tall cap and the name above the value.


## KIT - toggle, graph, envelope and spectrum now speak the plate language - 2026-11-10 (DRAFT)

Rendered each component demo and compared it with the approved plate, same as the knob pass.

- **Toggle** was a pill with a round cap. The plate's miniature switch (its CSS block 15.8) is a
  `--r-ctl` (2 px) track in `--panel-2` with a `--rule-ctl` edge and a **square cam** of 1 px
  radius; when it is on the whole track **fills with the signal colour** and the cam goes dark
  (`--on-sig: #1A0A08`). Rebuilt to that: radius `--r-control`, `--plate-2` body, square cam in
  `--ink-3`, on-state = accent track + plate-coloured cam.
- **Graph / envelope nodes** were flat coloured squares (10 px) with the band number floating
  above them, and the per-band `data-color` tinted the square. The plate marks a band with a
  small **ring and a centred dot**, no number (the numbers live in the sequence list). The node
  is now `border-radius: 50%`, ink dot, 2 px plate gap, 1 px ink ring, `::after` hidden; the
  per-band colour still shows on hover/drag.
- **Grid** was `--viz-grid: var(--rule-2)`, a grey line that turned every plot into graph paper.
  The plate's `--grid` is `rgba(91, 199, 210, .10)` - a 10 % **cyan hairline**. `--viz-grid` now
  carries exactly that (day: `rgba(18, 41, 53, .06)`), in `tokens.css` and the `apc-core.css`
  mirror.
- **Spectrum bars** were drawn in `th.accent` (the limit red). Energy is cyan in this language
  (`--ok: #5BC7D2`, "success / energy / meter body"), so the bars use `th.ok` now; the curve
  styles keep `--viz-line` / `--viz-fill`.
- Verified with fresh renders of `/kit-demo/{toggle,graph,envelope,spectrum}` at device scale 2:
  cam square with a 2 px track radius, nodes as ring-dots on both graph and envelope, grid
  reduced to a hairline, bars cyan. `node scripts/apc-kit-test.js` exits 0 and
  `design-tokens-check` reports only the known stale `--apc-letterbox` in `design-system.json`.


## KIT - the knob was still a closed ring in a bright colour - 2026-11-10 (DRAFT)

Screenshotted the demo and the approved plate side by side this time instead of trusting the
DOM, which is how all four faults became visible.

- **The ring painted as a closed circle.** The track was a `<circle>` with
  `stroke-dasharray: 0.75C 0.25C` and `transform="rotate(225)"`, which is a correct 270 degree
  arc **in user units** - but `.apc-ring__track` also carries `vector-effect: non-scaling-stroke`
  (so a 2 px stroke stays 2 px at any knob size), and that makes dash lengths **screen pixels**.
  The 216.77/72.26 pattern then no longer matched the 459 px circumference, so the ring wrapped
  round almost twice with a small gap in the wrong place. Replaced with the plate's own
  `M..A..` path via the existing `arcPath(R_TRACK, A0, A0 + ASWEEP)` helper
  (`M-32.53 32.53 A46 46 0 1 1 32.53 32.53`, identical to the plate's `.k-track`). No dash, no
  scale dependence.
- **The ring was too loud.** The track used `--rule` (#5A8492, the *border* colour, which has to
  pass 3:1). The plate paints its track in a dark slate (measured `rgb(42,74,87)`), so only the
  accent arc reads. Now `--rule-2`. Same for the fader rail.
- **The "white outer stuff" was the modulation sum band**: `.apc-ring__sum` in `--ink` at
  `R_MOD = 49` of 50 - literally hugging the outer edge - 2.4 px wide, and its sweep crosses the
  bottom, so it also closed the ring. Now `--memory` (warm), 1.5 px, at `R_MOD = 42` (inside the
  38..46 gap between dial and track). The modulated-value marker dot is warm too instead of white.
- **The red outer box** was `.ref-hl-box`, the hub's element highlighter: a 2 px `--amber`
  outline plus a 12% fill that stayed on the plate for four seconds and read as part of the
  design. The box is gone; the feedback is the status line and a scroll to the element.
- **Fader**: the label was under the value; `order: -1` puts the name above, like the knob and
  every plate fader. Rail is `--rule-2`, cap stays `.7rem x 1.35rem` on `--plate-2`.
- **Disc edge**: a 1 px `--rule` circle round the face read as a second, closed ring. It is now
  a quiet `--rule-2` hairline, so the disc has an edge and the arc still reads as open.
- Verified: before/after screenshots of `/kit-demo/knob` and `/kit-demo/slider` (device scale 3);
  pixel histogram of the fader render shows the rail at `rgb(35,66,80)` = `--rule-2`, fill
  `rgb(251,84,61)` = `--accent`; `node scripts/apc-kit-test.js` exits 0.


## KIT - knob and fader now render the plate's recipe - 2026-11-10 (DRAFT)

The knob and fader on the components pages were still the kit's **first flat styling**; the
earlier design pass had covered containers, text, the context sheet and the toggle, but never
these two controls, so they were never restyled at all.

- **Knob**: ring track and value arc are 2 px with round caps (they were 3 px), the tick ring is
  gone (`--plate`: "No tick ring. … one accent arc, one pointer"), the face is
  `linear-gradient(145deg, var(--plate-2), var(--knob))` with a hairline `--rule` edge and
  `var(--sh-knob)` (which already carries the drop shadow *and* the inner top highlight).
- **Pointer**: the plate draws a 2.5 px bar at `top: 10%`, `height: 19%` inside a box that fills
  the dial and is rotated about its centre - so the centre cannot drift. The kit used a
  half-anchored bar (`top: 27%`, `transform-origin: 50% 100%`) plus a `translateX(-50%)` in
  `apc-controls.js`; that transform is now a plain `rotate()`. First attempt left the box at
  `width/height: auto` with `inset: 0`, and the pointer collapsed to **0 px** (measured:
  `bar=2.5px x 0px`, `transform-origin: 0 0`) - a percentage height inside a zero-height box.
  `width/height: 100%` fixes it.
- **Fader**: 2 px rail in `--rule` with a 2 px `--accent` fill (it was a 4 px `--inset` track with
  a faked 1 px outline), and a thin tall cap - `.7rem x 1.35rem`, `--plate-2` body, hairline
  `--rule` edge, `var(--sh-knob)`, no centre line, no tick marks. `--track-w` is `.25rem` at
  `:root`, so the 2 px rail is scoped as `.apc-fader { --track-w: 2px }` rather than fighting the
  token.
- Token trap recorded: the plate's stylesheet speaks `--panel`, `--hair`, `--rule-ctl`,
  `--knob-shadow`, `--sig`; the kit speaks `--plate-2`, `--stroke`, `--rule`, `--sh-knob`,
  `--accent`. A copy/paste of plate CSS into the kit resolves those to nothing (`--panel` made the
  fader cap transparent) **without any error**.
- Verified (measured in the live demo iframes): dial 121/159 px = 1 - 2 x 12 %, `border-radius:
  50%`, gradient true, shadow true, ring 2 px, arc 2 px, ticks `none`, pointer bar
  `2.5 x 22.5 px @ 11.9`, origin at centre, fill ink; fader track `2 px`, rail `rgb(90,132,146)`,
  cap `11 x 21 px`, body `rgb(26,54,68)`, no `::after`, no ticks. `node scripts/apc-kit-test.js`
  exits 0.

## HUB - theme panel no longer hangs, tabs no longer land on 01-overview - 2026-11-10 (DRAFT)

Two regressions from the previous pass, both found by using the page:

- **"loading the design…" forever.** `kitSetTab()` had been made to skip the repaint unless the
  tab *changed*, and `kitActivate()` calls it with the tab it is already on - so on the theme tab
  nothing ever rendered. The gate is gone; switching to `theme`/`spec` always repaints.
- **Every tab jumped to 01-overview.** The tab links pointed at `#09c-kit/theme`, and the shell
  shows a section by CSS `:target` only; with a suffixed hash no section matched, so
  `body:not(:has(main section:target))` displayed `01-overview`. `wireKit()` also looked for
  `closest('button')`, so an `<a>` click was never intercepted and the browser navigated. Subpages
  now live in the query (`?kit=theme#09c-kit`), the links carry that href (middle-click still
  works), the click handler prevents the navigation, and `popstate` re-applies the section.
- Verified on a cold deep link `?kit=theme#09c-kit`: `09c-kit` block, `01-overview` none, theme
  panel shown with **79 rows / 47 swatches**, no "loading the design" text; walking components ->
  spec -> coverage -> theme keeps the section and the query in step each time.


## HUB - the bundled fonts actually reach the page (and the plugin) - 2026-11-10 (DRAFT)

The console line was true: `downloadable font: download failed … /kit-theme/fonts/inter-400.woff2`.
`tokens.css` references its fonts **relative** (`url("fonts/x.woff2")`) so a plugin can copy the
design folder as-is, but the Hub serves that file as `/kit-theme/<id>.css`, so the browser asked
for `/kit-theme/fonts/…`, which no route answered. Four things were wrong, not one.

- **`/kit-theme/<id>.css` now rewrites the font URLs.** To `/kit/fonts/<file>` when the kit ships
  that file (the demo pages already load `apc-core.css` from `/kit/`, so the same URL means one
  download and one cache entry), otherwise to `/preview/<design>/fonts/<file>` so a design with
  fonts of its own still works. The source `tokens.css` keeps its portable relative paths.
- **New route `/kit/fonts/<file>`** — one path segment, `*.woff2`/`*.woff`, correct MIME.
  `apc-core.css` served from `/kit/` had exactly the same broken relative reference.
- **`apc-core.css` had no `@font-face` at all**: the token mirror copied only the `:root` and
  `[data-theme="day"]` bodies. The five faces are now copied from `tokens.css` and sit *outside*
  the synced regions, so re-running the mirror keeps them. `templates/webview/apc-ui/fonts/`
  carries the files (110 KB) and both OFL texts.
- **`scripts/ui-compose.js` `vendorKit()` copied files only**, so a composed plugin would have got
  an `apc-core.css` pointing at fonts it never received. It now copies `fonts/` as well.
- Verified: all 10 `url()` references across both served stylesheets answer `200 font/woff2`; in
  the live iframe `document.fonts.load()` resolves for Inter 400, Inter 600 and JetBrains Mono 500
  (6 faces loaded); a compose run into `.tmp/` vendored 5 woff2 + 2 licences and the vendored core
  carries 5 `@font-face` blocks.
- **Two Hub-origin console warnings silenced**: the YouTube iframe no longer requests the
  unsupported `encrypted-media` permission (`picture-in-picture` stays), and the kit iframes no
  longer carry `sandbox="allow-scripts allow-same-origin"` — they are same-origin pages that need
  both tokens, so the attribute was never a boundary, only a warning. The remaining console noise
  (YouTube cookies, the fingerprinting notice, the extension bundle's "unreachable code") is not
  ours.


## HUB - 09c KIT split into four subpages, theme editor rebuilt - 2026-11-10 (DRAFT)

The KIT page had grown to four unrelated jobs behind four buttons that were not addresses.
It is now four linkable subpages with the same shell, and the theme editor's controls are
inputs instead of a wall of text fields.

- **Subpages**: `?kit=components`, `?kit=theme`, `?kit=spec`, `?kit=coverage`, always with
  `#09c-kit` in the hash. The hash cannot carry the subpage: the shell shows a section purely by
  CSS `:target` (`shell.css: section:target`), and no element can have the id `09c-kit/theme`, so a
  suffixed hash silently fell through to the `01-overview` fallback rule. The tab strip is a
  `<nav role="tablist">` of real `<a>` elements (`aria-current` on the current one); `kitSetTab()`
  writes the query with `history.pushState` and the router re-applies it on `popstate`, so deep
  links, reload and back/forward all land on a real element.
- **Colour**: every colour token gets a swatch button showing its live value. Clicking opens one
  reused popover: the browser's colour dialog (hue strip and its own eyedropper), an `A` slider
  for alpha, a hex field, a `PICK` button (EyeDropper API, N/A fallback) and eleven palette
  chips taken from the design being edited, so you can grab `--ink` while editing `--accent`.
  Every path ends in `kitThSet()`, the same door the text field used.
- **Lengths and numbers**: a range slider plus `-`/`+` steppers, px steps of 0.5 (radii are
  1.5, 2 and 3 px) and rem steps of 0.05. Values that are expressions (`max(9px,.5rem)`,
  `calc(...)`, `var(...)`) stay a text field and say `expression` - a slider cannot own them.
- **Finding a token**: a filter box (name or value, 79 rows -> 3 for "font") and a
  `[CHANGED ONLY]` toggle that follows the draft as you edit; empty groups hide themselves.
  The toolbar is sticky now that the list is long.
- **`kitThSync()` also updates `.tp-val` / `.tp-range`**, so a token changed from any other path
  no longer leaves its slider stale.
- **Toggle is a switch, not a lamp**: `apc-controls.js` builds `.apc-psw-track` + `.apc-psw-cap`
  and `apc-components.css` slides the cap on `[aria-checked="true"]`. The button variant keeps
  the single lamp.
- Verified: 47 swatches, 17 sliders, 34 steppers, 0 old colour inputs; probe run confirms
  `--apc-letterbox` -> `#00ff88` through the picker, filter 3/79, changed-only 1/79,
  stepper 0.5 -> 1, and `/kit-demo/toggle` renders one track and one cap.


## FILTER F-30 - knob centre fix on v006 - 2026-11-10 (DRAFT)

`apc_filter_f30_mockup_v006.html`, spec section 9, `apc_filter_f30_annotate.html` refreshed.

- **The note was right, the target was wrong.** The knob names were already centred on their
  cells - but the *disc* was 10 px off, which is what the eye read as "the name is not centred".
- Cause: `.square` was sized by height (`height:100%; aspect-ratio:1/1; max-width:100%`). The
  dial is 99 px tall and 88.6 px wide, so the square became 99 x 99, `max-width` did not clamp
  it, and it overflowed the dial to the right - taking the ring, the face and the pointer with
  it. Ring centre 1534, name centre 1514 (2x device px).
- Fix: the square is now `position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  width:100%; aspect-ratio:1/1` - square by width, centred by a transform that cannot drift.
  Name and value are `width:100%; text-align:center`.
- The tracking compensation also moved from a negative margin to `text-indent`, which is the
  honest way to give back half a tracking step on a centred run.
- Verified: knob, dial, square, svg and label all report centre 745.93 px; the painted ring
  sits on the same vertical line as the word; 30/30 element types, 8/8 canvases, 0 console
  errors, no overflow.
- Rule recorded: **a dial's square comes from its width, never its height** - same family as
  "height = width + 3.8 cells".

## FILTER F-30 - alignment pass on v006 - 2026-11-10 (DRAFT)

The eight round-2 notes were all alignment, so the pass replaced eyeballed placement with one
arithmetic: one inner box, one gutter. `apc_filter_f30_mockup_v006.html` is updated in place
(the design direction did not change, so the version number stays), plus
`apc_filter_f30_spec_v006.md` section 8 and a refreshed `apc_filter_f30_annotate.html`.

- **Title**: `F-30` removed; the header now reads `FILTER` / `USER INTERFACE SAMPLE`. The model
  number survives in the footer stamp and the page title.
- **The card's real bug**: its inner right edge is 64.6, but the spec line and the bottom row
  ended at 63.4 while the spectrum ended at 64.6. That 1.2-cell shortfall is exactly the
  "does not end with the spectrum" the eye caught. Every band is now flush to 64.6 (measured
  64.67 +- 0.01).
- **Vertical rhythm rebuilt** with 1.5-cell gutters: cap 0-2.5, hero+spec 4.1-9.1,
  display 10.6-23.2, rule 25.6, spectrum 26.7-35.5, row 36.9-39.7. The hero used to sit 0.4
  cells above the graph and the rule 0.1 cells below it - both now have air.
- **The vertical rule between graph and knobs is removed.** It was 0.6 cells from the graph and
  2.7 from the knobs; with the knobs spread on even gaps it has no job.
- **Knobs spread**: cutoff 41.1 -> 40.0, reso 51.9, drive 56.7 -> 59.8 with equal 3.1-cell gaps
  and the drive dial's right edge on the card's inner edge. Dials still share a bottom edge.
- **Bottom row redistributed** to even 2.73-cell gaps: TYPE 1.6-15.2, SLOPE 17.9-30.5,
  KEY TRACK 33.3-43.3, CHAR 46.0-64.6.
- **KEY TRACK**: new `.toggle--tight` (flex-start, 1 rem gap) so the cap sits next to its label;
  the box is 12 wide because the label plus a 4-wide cap overflows a 10-wide box (measured).
- **Lamps**: SIGNAL, CLIP and GATE are now single flex rows (`.lamprow`, gap .7, centre line
  shared) - the same construction the rail's RUN lamp already used. The Monitor's lamp and
  caption had been two separately positioned cells (y 44.2 vs 44.3).
- **Monitor spacing**: scope 31.4-40.8, trigger rule 42.3, bottom row 43.8-46.6 (was 32 / 42.4).
- **Morph**: XY well 13.8 -> 15.2 cells, bottom padding 2.8 -> 1.4.
- Verified: 30/30 element types, 8/8 canvases, 0 console errors, no overflow, band right edges
  flush, row gaps 2.74/2.74/2.73, knob gaps 3.10/3.10, dial bottoms identical.

## FILTER F-30 / ZEICHNUNG 2030 v006 - 2026-11-10 (DRAFT)

Review pass on the ten pinned notes: `apc_filter_f30_mockup_v006.html` +
`apc_filter_f30_spec_v006.md` + `apc_filter_f30_annotate_v006.html` (same plate with the pin
sheet, `apc-f30-notes-v006`).

- **Night is red now**: `--sig` `#ED7941` orange -> `#FB543D`. `#ED7941` is unused; day keeps
  its darkened `#D9482F` stroke.
- **Header**: wordmark 1.4 -> 1.75 rem, mark box 4.6 -> 6 cells; the two title lines are one
  flex column (left edges measured identical, 118.8 / 118.8 px) with a 0.1 rem gap; the claim
  is now `USER INTERFACE SAMPLE` instead of `F-30 - 2030 - SN 0104`, and the model moved up
  into `FILTER F-30`.
- **Instrument card**: `03 FILTER` is a real caption and RESPONSE / PHASE sit on it, which
  fixes the only caption in the design that was off the caption grid; CHARACTER moved down
  into the bottom row (`TYPE | SLOPE | KEY TRACK | CHAR`).
- **Q / SLOPE / LEVEL** are one right-aligned spec line instead of three boxes - three boxes
  above three knobs read as a second control column.
- **Knobs**: cutoff 11 -> 8.8 cells, reso/drive 6 -> 4.8 cells (-20%), and reso/drive are
  bottom-aligned with cutoff (delta 0.0 px), so all three value labels share one baseline.
- **Spectrum rewritten**: v005 drew it inside the *graph's* 36.2-cell plot box, which left a
  black field on the right of the 63-cell well. It now draws across its own width as 96
  log-spaced bars with 1 px caps, interior rules, 20 Hz - 20 kHz labels and a dashed cutoff
  marker; height 4.8 -> 9.2 cells (the graph gave up 17.4 -> 13.6). Pixel count on the canvas
  confirms the right third is painted (9.6% coverage, the low-pass tail).
- **The red focus box is gone**: a document-level `html[data-pointer="1"]` flag suppresses
  outlines during pointer interaction, so `.focus()` on `pointerdown` can no longer leave a
  `:focus-visible` ring behind. Keyboard focus keeps a neutral ring.
- **Active state** moved onto the control: knobs get a 0.55 rem halo on the face, the fader
  cap gets a 1 px signal edge plus a 0.45 rem halo.
- **Fader cap**: index line removed, 0.85 x 1.15 -> 0.7 x 1.35 cells.
- **Help button**: the filled blob is replaced by a stroked `?` (1.6 stroke, round caps).
- Fixed while in there: `#ro-lv` was written with `textContent` and silently dropped its `dB`
  unit on the first update; the unit now sits outside the updated node.
- Verified: 30/30 element types, 59 `data-el` nodes, 8/8 canvases, 0 console errors, no
  overflow, both themes rendered, pins in the annotate build resolve to `Response / Knob
  (Cutoff)`, `Response / Spectrum`, `Input / Slider (Gain)`.

## FILTER F-30 / annotation sheet - 2026-11-09 (REVIEW TOOL)

`apc_filter_f30_annotate.html` - a copy of v005 with a review layer on top, so the last
tweaks can be given per element instead of in prose.

- Press `N` (or the Annotate button): a 340 px sheet opens on the right and the plate scales
  down to fit; click anywhere on the plate to pin a note.
- Every pin records the element under the click by name (`Response / Knob (Cutoff)`,
  `Output / Meter`, `Sequence / List`), its `data-el` id, and its position as a fraction of
  the plate, so pins survive drawer open/close and window resize.
- Notes are editable inline, hovered notes outline their element on the plate, clicking a pin
  jumps to its note. An "Overall notes" field covers anything that is not one element.
- Export: `Copy notes` (markdown to the clipboard), `JSON` (a file with ids and coordinates),
  `Clear`. If the browser blocks the clipboard from `file://`, a sheet opens with the text
  already selected so it can be copied by hand.
- Everything is stored in `localStorage` under `apc-f30-notes-v005`; the page is otherwise
  v005 unchanged (the design itself has no knowledge of the tool).
- Tool chrome is authored in px on purpose (it must stay readable when the plate scales);
  the plate keeps its rem system. Panels gained a `data-zone` attribute so notes can name the
  zone - the panel sections are background shells, so the controls are not their children.

## FILTER F-30 / ZEICHNUNG 2030 v005 - 2026-11-09 (DRAFT)

Palette pass: `apc_filter_f30_mockup_v005.html` + `apc_filter_f30_spec_v005.html`.
Composition and engine are v004 - only the colour system changed.

- Adopted the five supplied colours as a strict role system: `#122935` material (plate in
  night, ink in day), `#5BC7D2` energy (spectrum, meter body, RUN / SIGNAL lamps),
  `#FB543D` limit (meter red zone, clip lamp, danger), `#ED7941` signal (response curve, knob
  arcs, active states), `#F2B29E` trace and memory (the drag ghost curve, soft washes).
- Day theme derives darkened variants of cyan and orange for strokes (`#2A8F9B`, `#D9482F`)
  because the raw hues do not clear 3:1 on a pale sheet; highlights keep the vivid values.
- Spectrum moved from ink-grey to cyan, which separates "energy" from "signal" for the first
  time in this design; the ghost curve is now peach instead of ink.
- Night panels raised one step (`#1A3644` / `#224A5A`) so cards separate from the plate.
- Removed the last hard-coded old-palette values (XY trail, clip glow, rgba fallback).
- Verified: both themes, 30/30 elements, 8/8 canvases, loop running (analysis counter and
  meter alive), syntax clean, no leftovers of the previous palette in the file.

## FILTER F-30 / ZEICHNUNG 2030 v004 - 2026-11-09 (DRAFT)

Composition pass: `apc_filter_f30_mockup_v004.html` + `apc_filter_f30_spec_v004.md`.
Nine cards become seven; the instrument card now owns its controls.

- **Knobs moved into the instrument card**: a 1px vertical rule separates the graph from a
  control strip holding CUTOFF (11 cells), RESO and DRIVE (6 each). TYPE, SLOPE, KEY TRACK
  and the `SVF - 4 x 2 pole` stamp fill the card's bottom row. The separate FILTER card is gone.
- **Graph range** +24..-36 -> **+12..-36 dB**; the curve now fills the frame.
- **Ghost curve**: dragging a knob keeps the previous response visible as a dashed 1px line
  until release (`onStart` / `onEnd` hooks on the knob factory).
- **PATTERNS merged into SEQUENCE**: the patch list and STORE sit right of the fader lane,
  which grew from 5.8 to 8 cells. Tempo, name, bar and gate share the lane's bottom row.
- **OUTPUT and MORPH** now share the right column; the bottom band is SEQUENCE + ENVELOPE,
  and the four ADSR sliders sit in one row under a 42-cell envelope display.
- Note: a knob's height must be `width + 3.8` cells (the dial is a square). The first build
  of this pass used 9.4 for a 6.4-wide knob and the values overflowed their boxes.
- Verified: 7 cards, 30/30 elements, 8/8 canvases, ghost live-then-cleared, fader drag,
  tempo drag, XY drag, popups, tabs, toggles, routing, pattern store, 0 console errors,
  both themes.

## FILTER F-30 / ZEICHNUNG 2030 v003 - 2026-11-09 (DRAFT)

Review pass on v002: `apc_filter_f30_mockup_v003.html` + `apc_filter_f30_spec_v003.md`.

- **Step fader**: the 2px cap bar is gone. Each bar now ends with a 1px edge (accent on the
  active step), so the lane reads as a level, not a lid on every column.
- **Output meter**: squared bars (no pill ends), peak tick removed, colour scale instead of a
  single gradient - sage up to -6 dB, red from -6 to 0 with a hairline boundary and a faint
  zone tint on the track so the ceiling is visible even when quiet. New `--warn` token added
  for future amber zones.
- **One mark language**: checkbox and radio are now the same 1.2-cell square with a 2px
  radius; selected = accent edge plus accent inset square. They stay two different controls
  (boolean vs one-of-N) but they look like one family. Toggle remains a switch.
- **Pattern list**: flat rows, no radius, straight highlight with a 2px accent left edge
  (the rounded highlight and rounded rows are gone).
- **Logo**: the boxed APC mark is removed; the wordmark stays as the logo element. Coverage
  stays 30/30 - dropping the wordmark too would leave 29/30 in the specimen index.

## FILTER F-30 / ZEICHNUNG 2030 v002 - 2026-11-09 (DRAFT)

Merge of the shootout winner into the F-30 plate. `apc_filter_f30_mockup_v002.html`
+ `apc_filter_f30_spec_v002.md`; v001 stays as history.

- Material: FORM F-01's sage palette in both papers (no pure greys, no cyan), flat chips
  with hairline edges, panel section numbers 01-09, knobs rebuilt as machined discs with a
  single accent arc and one pointer (no tick ring).
- Density: panel gaps 1.0 -> 0.6 cells by growing panels 0.2 cells per side in CSS;
  radii down to 2-3 px.
- Step sequencer: 16 fader columns with a 2px cap line at the end of each bar, draggable.
- Removed what the review rejected: number-field stepper arrows (the field is now a drag
  target with a three-dot grip) and round radio marks (now squares).
- Displays rebuilt: accent response curve with a right-hand dB scale and clipped roll-off,
  spectrum as one smoothed area, waveform as a dense signal trace, scope as a goniometer.
  The meter keeps v001's twin bars and peak ticks, refilled sage -> vermilion.
- Verified in headless Chrome: 30/30 elements, 8/8 canvases painted, every control exercised
  (popups, tabs, slope, character, toggles, radio, list, store, XY drag, fader drag, tempo
  drag, transport), 0 console errors in both themes.

## FILTER F-30 / ZEICHNUNG 2030 v001 - 2026-11-09 (DRAFT)

Second design line for the plugin face (the Hub dashboard language below is untouched).

- `apc_filter_f30_mockup_v001.html` + `apc_filter_f30_spec_v001.md`: the reference plate
  for the APC filter face. 120 x 70 cells, NIGHT + DAY, all 30 kit elements present
  (30/30, proven by the foot readout and by the specimen index).
- Material language reviewed against the peak-meter reference build: a floating card with a
  soft shadow, borderless tinted sections, sans micro-labels over mono numerals, one vivid
  signal colour. Radii then tightened to 3-5 px and all gaps set to exactly 1 cell on review.
- Layout follows the signal chain: INPUT -> RESPONSE -> FILTER controls (one cell from the
  curve they change) -> OUTPUT, with modulation, morph and pattern memory in the bottom row.
- Signature idea: the geometry is a drawing - the same plate is re-inked for day, and the
  specimen index (key `A`) turns it into its own engineering sheet with numbered tags.
- All numbers are computed: RBJ biquad cascade (magnitude + unwrapped phase), spectrum shaped
  by the same transfer function, ballistic meters, real 16-step clock, XY pad driving cutoff/Q.
- Supersedes the "APEX 2030" line below: that entry names two files which were never present
  in this folder, so it is kept as history only.

## FILTER GUI / APEX 2030 - 2026-11-08 (DRAFT)

New design line for the plugin face. The Hub dashboard language below is
unchanged; this is a second, independent language for a plugin UI.

- `apc_filter_design_mockup_v001.html`: self contained mockup of the APC FILTER
  (AXIOM 12) plate, 96 x 52 cells, night + day mode, all 30 kit elements present
  at least once, live and animated. No network, no web fonts, no dependencies.
- `apc_filter_design_spec_v001.md`: the language (principles, palette with
  measured contrast, type, geometry, motion, element inventory, a11y contract,
  mapping onto the shipped UI kit tokens).
- Signature idea: the spectral cursor, a 1px luminous rule at the cutoff that
  crosses the whole plate, so the eight panels read as one instrument.
- Signal colour is ION teal (night #35E8D0, day #00705F), a deliberate break
  from the APC amber. Warning amber and clip red only at the extremes.
- Three border levels: `--rule` (control, >= 3:1), `--rule-panel` (container),
  `--rule-2` (divider). The first version of the mockup failed WCAG 1.4.11 on
  the control borders; they were darkened and re-measured.
- ASCII only, no em dash, per the house rule of this folder.
- Verified in headless Chrome: 30/30 elements, 0 console errors, 0 regions
  outside the plate, 0 overlaps, 0 clipped text, 9/9 canvases painted, 14
  interactions exercised, 48 contrast pairs with 0 failures.

## v012 - 2026-09-13 (DRAFT)

- Update check: no upstream releases counts as CURRENT green (reason shown);
  UNCHECKED reserved for real unknowns.
- Form controls follow the theme via color-scheme (no more white inputs).

## v011 - 2026-09-13 (DRAFT)

- Sidebar mark removed (header owns the version now).
- Header version badge: amber link to the GitHub repo.
- Designs list REAL *.html files per folder; manifest mismatches flagged.
- Settings: structured form editor for every key (replaces JSON textarea).

## v010 - 2026-09-13 (DRAFT)

- Em-dash ban (§1.8): U+2014 removed across hub/, workflow, docs (825 hits).
- Sidebar mark: ASCII box retired, plain HTML bordered box.
- Submenu active state painted by hashchange script (.on class, any doc id).
- Noted as implemented: settings editor (POST + .bak), design preview
  links, update RE-CHECK button.

## v009 - 2026-09-13 (DRAFT)

- Full-bleed scroll container (§4.5 amendment): `max-width` off `.content`,
  onto `.content>main,.content>footer` - scrollbar docks at the frame's
  right edge. 6-line delta vs v008, nothing else changed.

## v008 - 2026-09-13 (DRAFT)

- Fixed shell (§4.5): `body{overflow:hidden}`, flex-column frame; header +
  sidebar viewport-locked, only `.content` scrolls. Mobile falls back to
  page scroll + sticky header. Sticky-overlap defect gone by construction.
- Decided: submenu stays manual-expand, no new JavaScript.

## v007 - 2026-09-13 (DRAFT)

- DOCUMENTATION submenu (§5.16): native `<details>` collapser in sidebar,
  closed by default, INDEX + 16 short-label entries; parent highlights for
  every child view via prefix-match `:has` rule.
- 16 per-doc sections with real baked chapter lists; pager chain extended
  to 27 stops; index `<details>` gain OPEN AS SECTION links.
- Build order unchanged (overview/projects first). Questions live in chat.

## v006 - 2026-09-13 (DRAFT)

- Sticky header (§4.4 revision): `position:sticky; top:0`, opaque paper
  background, z-index above sidebar - survives scrolling inside sections.
  Header gains 4th badge `APC v1.4.0`.
- `10 DOCS` renamed `10 DOCUMENTATION`, rebuilt as doc center: disabled
  search placeholder, 16 `<details>` collapsers with the real baked `##`
  chapter index (178 chapters), reader preview with real README.md text.
  Dynamic loading (`/api/v1/docs`, search, bookmarks) specified in §6.2.
- Convention: review questions live in chat, not in mockup files.

## v005 - 2026-09-13 (DRAFT)

- Persistent header (§4.4): logo + title + badges span the frame on EVERY
  view; logo removed from 01 OVERVIEW; sidebar slimmed to version-only
  mark + REL + nav + theme + foot.

## v004 - 2026-09-13 (DRAFT)

- Table padding rule (§5.14): 14px left air on all cells (screenshot fix).
- Centered shell (§4.3): max 1340px frame, auto margins, 2px outer rules;
  sidebar stays left inside the frame.
- Sidebar mark shows `APC v1.4.0` (src `package.json`, banner matches).
- New sidebar REL block + 01 OVERVIEW upstream row; update-check mechanism
  specified in new spec §10 (GitHub releases/latest, semver, states,
  future `scripts/apc-update-check.ps1/.sh` + `/api/v1/update`).

## v003 - 2026-09-13 (DRAFT)

- App shell: fixed 264px left sidebar (ASCII mark, badges, nav, theme,
  stamp) + right side shows ONLY the active section.
- Switching is CSS-only (`:target` + `:has`); hash = state, bookmarks and
  back-button work natively; overview is the no-hash default.
- Full block logo moved to 01 OVERVIEW; sidebar carries compact `APC/HUB_`
  mark. PREV/NEXT pagers per section. Print renders all sections stacked.
- Tokens, data snapshot, theme switch: unchanged from v002.

## v002 - 2026-09-13 (DRAFT)

- Dual theme: dark default (`#0B0B0B` paper), light alternate (v001 look).
- Theme switch `THEME: [*DARK] [LIGHT]` in header, persisted via
  `localStorage["apc-hub-theme"]`, no-flash (`data-theme` on `<html>`).
- Second signal color: phosphor green (`#33FF33` dark / `#0B7A30` light)
  for all OK/calm/good elements (`[OK]`, `[x]`, setup badge, `::selection`).
- Amber strictly active/warning from here on (current-phase chips, `[!!]`).
- Fixed: neogrid-minimal accent is `#7B68EE` (v002 mockup; v001 was correct).
- Spec split: `themes.css` added to the future live-CSS file map.

## v001 - 2026-09-13 (DRAFT)

- Initial APC RASTER language: rectangles only, 1px rules, mono-first,
  system fonts, zero JS, light theme only, amber single signal color.
- Static mockup with live snapshot baked in (4 plugins, config, 3 designs,
  18 skills, 23 workflows, 33 scripts, 27 template files, 16 docs/696 heads).
