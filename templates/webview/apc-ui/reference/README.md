# APC Minimal reference pointer

The one visual source of truth for the APC Minimal library is
[`hub/_design/apc_filter_f30_annotate_v006.html`](../../../../../../hub/_design/apc_filter_f30_annotate_v006.html).
It is an annotated, self-contained 120 x 70 design (1 rem per cell). APC Hub 09c serves that file
byte-for-byte; it does not serve a separately assembled kit page as the library reference.

`APC Minimal` is the design-library name shown in the Hub. The source's product face remains APC
FILTER F-30, as authored in v006. Its own day/night, filter, visualization, transport, anatomy and
annotation behaviours remain part of that source.

## Open it in the Hub

Open `http://localhost:4872/#09c-kit`. The reference loads in a sandboxed iframe from the canonical
source. The Hub offers a Night/Day selector, scale, element locator, reload and Open Source controls.
Global token drafts are edited in THEME EDITOR. ELEMENT SPEC exposes validated element geometry and
line tuning, with saved values in `design_library/apc-minimal/design-system.json`.

## What the reference shows

| Area | Elements |
|---|---|
| Header | APC mark and title, preset, A/B, day/night, help and menu controls |
| Input and monitor | waveform, gain, phase, scope and input status |
| Response and filter | hero readout, graph, knobs, type/slope controls and spectrum |
| Output and morph | output meter/readout, radio mode and XY pad |
| Sequence and envelope | transport, step sequence, tempo, pattern list, envelope and sliders |
| Foot | technical stamp and 30/30 coverage indicator |

The source itself declares 30/30 element coverage. The COMPONENTS tab documents and previews the
registered kit elements separately.

## Files

| File | Role |
|---|---|
| `hub/_design/apc_filter_f30_annotate_v006.html` | Sole visual reference source; served unchanged by 09c KIT. |
| `index.html`, `reference.css`, `plate.js` | older F-30 drafts retained for archive; not used as the APC Minimal source. |
| `reference-backend.js`, `reference-plugin.js` | older kit-demo runtime assets; not loaded by the canonical v006 source. |

Do not use this folder's older pages as the APC Minimal visual reference. To update the design, edit
the canonical v006 source and then bring the design tokens and element spec into agreement with it.
