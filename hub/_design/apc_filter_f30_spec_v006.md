# APC FILTER F-30 - ZEICHNUNG 2030 - design spec v006

Status: DRAFT for review - Date: 2026-11-10 - File: `apc_filter_f30_mockup_v006.html`
Supersedes: `apc_filter_f30_spec_v005.md` (kept). This is the ten-note review pass on v005,
plus the palette correction it asked for. Composition logic, engine and grid are unchanged.

## 1. The ten notes, and what was done

| # | Note | v006 |
|---|---|---|
| 01 | logo too small | wordmark 1.4 -> 1.75 rem, mark box 4.6 -> 6 cells |
| 02 | F/F not on one X, lines too far apart, claim needs a real name | header rebuilt (section 2) |
| 03 | `03` does not line up because RESPONSE/PHASE are tabs in open space | card now starts with a caption row (section 3) |
| 05 | Q / SLOPE / LEVEL float somewhere in between | three boxes became one right-aligned spec line |
| 06 | cutoff knob smaller | 11 -> 8.8 cells (-20%) |
| 07 | reso and drive bottom-aligned, smaller | 6 -> 4.8 cells (-20%), bottom edges flush with cutoff |
| 08 | spectrum squeezed against the curve, dead black area on the right, want bars | spectrum rewritten and given the space (section 4) |
| 09 | fader cap: no line, a bit taller and narrower; no red box when active | thumb 0.85x1.15 -> 0.7x1.35, `::after` rule removed (section 5) |
| 10 | same for every knob | pointer never draws a focus box; subtle halo while dragging |
| 11 | the question mark is ugly | stroked `?`, 1.6 stroke, round caps |
| - | replace the night orange with a redder palette colour | `--sig` `#ED7941` -> `#FB543D` (section 6) |

## 2. Header

```
[APC]  FILTER                (2.3 rem, tracking .06 em, line-height .98)
       USER INTERFACE SAMPLE  (micro, tracking .12 em, ink-3)
```

Both lines are flex children of one column, so their left edges are identical by
construction (measured: 118.8 px / 118.8 px at a 1240 px window). The gap between them is
0.1 rem - the two lines now read as one lockup instead of two labels. The claim line is no
longer a serial number: the plate is a **user interface sample**. Round 2 then removed the
model number from the header as well, so the plate introduces itself as `FILTER` and nothing
else; `F-30` survives in the footer stamp and the page title.

## 3. The instrument card

v005 had `03` floating at the panel's top-left while RESPONSE/PHASE started 1.6 cells right
and 0.1 cell above it - the one caption in the design that did not sit on the caption grid.
It is now a real caption like every other card:

```
03 FILTER   RESPONSE  PHASE
```

`FILTER` is the headline (mono index + ink-2 label, same as 01 INPUT), and RESPONSE / PHASE
are the investment of that headline, sitting on the caption's baseline. The CHARACTER
selector moved down into the bottom row, where it belongs with the other voice settings:
`TYPE | SLOPE | KEY TRACK | CHAR`.

Below the caption:

```
CUTOFF FREQUENCY                      Q 2.40   SLOPE 24   LEVEL +6.2 dB
1.20 kHz
[ response graph 36.2 x 13.6 ]  |  (cutoff 8.8)  (reso 4.8)  (drive 4.8)
SPECTRUM -----------------------------------------------------------------
[ 96-bin bar spectrum, 63 x 9.2 ]
```

The three secondary figures are now **one spec line**, right-aligned to the card's inner
edge, each as `label value unit` on a shared baseline. Why not three boxes: three
right-aligned boxes above three knobs read as a second control column, and the knob labels
landed inside it. A single line cannot be mistaken for a column.

Side effect fixed: `#ro-lv` used to be written with `textContent`, which silently dropped the
`dB` unit on the first update. The unit is now a sibling of the value, outside the updated
node.

## 4. Spectrum, rewritten

v005 drew a soft filled area using the *graph's* plot box, which is 36.2 cells wide inside a
63-cell well - hence the black field on the right. v006:

- Draws across the well's own inner width (no shared lattice with the graph).
- **Bars**: 96 log-spaced bins, slot/0.62 px stems, body `--sig-2` at 30-72% by level, and a
  1 px cap at 92% so the top of each bar is crisp. This reads as a measurement, not a mood.
- Two interior rules at 33% and 66%, a baseline, and 20 / 100 / 1k / 10k / 20k labels under
  the bars, so the strip is self-describing.
- A dashed marker at the current cutoff, which ties the strip to the hero readout.
- Height 4.8 -> 9.2 cells (about double), then 8.8 in the alignment pass. The height came out
  of the graph (17.4 -> 13.6, then 12.6), so the card's rhythm is: big number, graph, spectrum,
  row.
- The `1/12 oct - fft 4096` caption moved out of the card: it sat on the same baseline as the
  knob values and read as if it belonged to them. `SPECTRUM` labels the rule alone.

Verified by pixel count: the right third of the canvas carries painted pixels (9.6% coverage
- the low-pass tail - not 0%), and the bars reach the 20k edge.

## 5. Knobs, fader, focus

- Sizing rule unchanged and enforced: **height = width + 3.8 cells** (the dial is a square,
  plus a label line and a value line). cutoff 8.8 x 12.6, reso and drive 4.8 x 8.6.
- RESO and DRIVE are **bottom-aligned** with CUTOFF (measured delta: 0.0 px on both), so the
  three value labels share one baseline with the graph's frequency labels.
- Fader cap: no index line, 0.7 x 1.35 cells - narrower and taller than the old 0.85 x 1.15.
- **The red box is gone.** It was the focus ring: the factories called `.focus()` on
  `pointerdown`, so a mouse click could leave a `:focus-visible` outline behind. Now a
  document-level pointer flag (`html[data-pointer="1"]`) suppresses outlines for the duration
  of any pointer interaction, and the keyboard keeps a neutral 1 px ring.
- Active state is on the control itself: knobs get a 0.55 rem `--halo` glow on the face (no
  border colour change), the fader cap gets a 1 px `--sig` edge plus a 0.45 rem halo.

## 6. Palette: night turns red

| | v005 | v006 |
|---|---|---|
| `--sig` night | `#ED7941` orange | `#FB543D` red |
| `--halo` night | orange 22% | red 24% |
| `--sig` day | `#D9482F` | `#D9482F` (unchanged) |

`#ED7941` is now unused. In night, signal and limit therefore share `#FB543D`; they are
separated by position and by form (a curve and an arc are not a meter zone), not by hue. Day
keeps its darkened stroke so 3:1 on paper is preserved.

## 7. Unchanged / verified

Plate 120 x 70, 0.6-cell visual gaps, 2-3 px radii, boxless numbered sections, one square
mark language, specimen index (`A`), keys, 30/30 elements, 8/8 canvases.

Probe on the final file: 30 element types, 59 `data-el` nodes, 8 canvases, 0 console errors,
no horizontal or vertical overflow, night `--sig` = `#FB543D`, title lines flush,
knob widths -20%, reso/drive bottom delta 0, spectrum canvas 831 x 121 px painted to the
right edge, thumb 0.7 x 1.35 with no `::after`.

Reviewing this version: use `apc_filter_f30_annotate_v006.html` - same plate, plus the pin
sheet (`N` to open, click to pin, `Copy notes` to export).

## 8. Alignment pass (review round 2)

Eight notes, all about alignment. The fix was to stop placing things by eye and give the card
one arithmetic: **one inner box, one gutter**. All numbers are plate cells measured from the
plate's top-left corner.

| # | Note | after the pass |
|---|---|---|
| 01 | remove `F-30` from the label | title is `FILTER` / `USER INTERFACE SAMPLE` |
| 02 | Monitor not aligned; SIGNAL too far from its LED | lamp + caption are one flex row (gap .7, shared centre line); scope, trigger rule and the bottom row sit on 1.5 gutters |
| 03 | cutoff a tad left | `--x 41.1 -> 40.0` |
| 04 | drive a tad right | `--x 56.7 -> 59.8`, right edge on the card's inner edge |
| 05 | values awkward, hero too close to the graph, rules too close to things | rhythm rebuilt (below), vertical rule removed, `SPECTRUM` rule given 1.5 above and 1.9 below |
| 06 | toggle closer to its label | `.toggle--tight` (flex-start, 1 rem gap), box 12 wide so the cap fits inside |
| 07 | selector must end with the spectrum | right edge 63.48 -> 64.67, the card's inner right |
| 08 | morph window higher | XY well 13.8 -> 15.2 cells, bottom padding 2.8 -> 1.4 |

### The instrument card, measured

Inner box: `x 1.6 ... 64.6`, `y 2.5 ... 39.6` (panel 66 x 41).

```
cap          0.0  ..  2.5
gutter       1.5
hero + spec  4.1  ..  9.1    (h 5.0)
gutter       1.5
display     10.6  .. 23.2    (h 12.6)   graph 36.2 wide, knobs to its right
rule        25.6              hairline, label centred on it
gutter       1.9
spectrum    26.7  .. 35.5    (h 8.8)
gutter       1.4
row         36.9  .. 39.7    (h 2.8)
```

Every full-width band starts at `x 1.6` and ends at `64.6`. The only element that does not
is the graph, which ends at 37.8 because the knob strip starts there.

### The two rows

Bottom row, evenly spaced to 2.73-cell gaps, `CHAR` flush to 64.6:

```
TYPE      1.6 .. 15.2   (13.6)
SLOPE    17.9 .. 30.5   (12.6)
KEY TRK  33.3 .. 43.3   (12.0)
CHAR     46.0 .. 64.6   (18.6)
```

Knob strip, equal 3.1-cell gaps, right edge on 64.6: `CUTOFF 40.0`, `RESO 51.9`,
`DRIVE 59.8`. All three dials share a bottom edge (delta 0.0 px), all three values share a
baseline, and that baseline is the graph's frequency label row.

**The vertical rule between graph and knobs is gone.** It sat 0.6 cells from the graph and
2.7 from the knobs - exactly the kind of almost-aligned that reads as a mistake. With even
gaps it has no job to do, and removing it gives the strip the air the note asked for.

### What was actually wrong in the Monitor

The lamp and its caption were two separately positioned cells: the lamp in a 2.4-wide box at
`y 44.2`, the caption at `y 44.3` in a 7-wide box. A tenth of a cell is invisible alone, but
two text baselines a tenth apart read as sloppy, and the 1.4-cell gap read as unrelated
objects. Both are now one flex row: `gap .7`, `align-items:center`, so the spacing and the
centre line are properties of the group, not of two separate guesses. The same treatment went
to CLIP and GATE, and the rail's RUN lamp was already built that way - so all four lamps in
the plate now share one construction.

### Verified after the pass

30/30 element types, 8/8 canvases, 0 console errors, no overflow.
Right edges, relative to the panel's left edge: spec line `64.67`, knob strip `64.68`,
spectrum `64.67`, bottom row `64.67` - everything that should be flush is flush to 0.01 cell.
The hero (`15.97`) and the graph (`37.87`) are left-anchored by design.
Bottom-row gaps: 2.74 / 2.74 / 2.73. Knob gaps: 3.10 / 3.10.
Dial bottoms: cutoff 30.07, reso 30.07, drive 30.07. Lamp rows: signal, clip, gate and run all
`gap 0.7` with identical centre lines.

## 9. The knob name was never the problem (review round 3)

The last note asked for the knob names to be centred on the knobs. They already were: the
name, the value and the cell shared one centre line to 0.01 cell, and the label's box was the
dial's centre line to within the tracking compensation described in section 5.

What was off was the **disc**. `.square` was sized by *height*
(`height:100%; aspect-ratio:1/1; max-width:100%`). The dial is 99 px tall and 88.6 px wide, so
the square resolved to 99 x 99, `max-width` did not clamp it, and it hung 10 px over the dial's
right edge - carrying the ring, the face and the pointer with it. Measured on the rendered
plate at 2x: ring centre 1534, name centre 1514. The name looked off-centre because the dial
was.

The fix is a construction that cannot drift:

```css
.knob .dial{display:block;}                  /* position:relative comes from section 05 */
.knob .square{position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
              width:100%; aspect-ratio:1/1;} /* square by width, centre by transform */
```

The name and the value are `width:100%; text-align:center`, so the type and the disc are each
centred by an independent mechanism that resolves to the cell's centre line. Verified: knob,
dial, square and svg all report the same centre (745.93 px), and the painted ring sits on the
same line as the word.

Rule to keep: **a dial's square comes from its width, never its height.** It is the same class
of bug as "height = width + 3.8 cells" in section 5, and it survived two rounds because the
thing that was off - the ring - was the thing nobody measured.




