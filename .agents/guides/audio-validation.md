# Audio Validation Pipeline (`apc audio`)

Automated, machine-readable audio gates for a **built** plugin. Used by `/apc-test`
(and CI). Entry point: `node bin/apc.js audio <Plugin> [options]` (implementation:
`scripts/apc-audio.js`; render harness: `templates/audio-test-harness/`).

Rules that apply to every gate:

- A gate that cannot run is **`skipped` with a reason** - never a pass. `skipped` is not
  success: report it to the user and do not claim the plugin was validated by it.
- A gate that runs and is out of threshold is **`fail`**. A plugin or harness *crash*
  during a render is also `fail`. A tooling problem that prevents a verdict (harness
  cannot load the plugin, unreadable output) is **`error`** and counts as a failure.
- Overall result: any `fail`/`error` -> `fail`; else any `pass` -> `pass`; else `skipped`.

## Gate list and thresholds

| Gate | What it checks | Pass condition (default) | Skipped when |
|---|---|---|---|
| `pluginval` | `pluginval --strictness-level 10` on the VST3 (same binary/flags as `scripts/pluginval-integration.ps1`) | exit 0 **and** `SUCCESS` in output | no VST3 built; pluginval not found |
| `clap` | `clap-validator validate --only-failed` on the `.clap` | no `FAILED` test (known upstream `state-reproducibility*`, clap-001, is listed and ignored) | plugin not opted in (`status.json formats.clap != true`); no `.clap`; no clap-validator |
| `null` | offline renders via the harness: (a) **block-size invariance**: `pink` at 44.1/48/96 kHz, blocks 64 and 1024 vs 512 at the *same* rate (no resampling); (b) **baseline compare** of `impulse`, `sweep`, `pink` at 48 kHz/512 against stored WAVs | invariance max-abs-diff <= `1e-4` (-80 dBFS); baseline max-abs-diff <= `1e-3` (-60 dBFS); same shape | no VST3/harness; **no stored baseline -> gate is `skipped`** (other checks still listed), run `--baseline-update` after reviewing the render |
| `nan` | NaN / Inf / denormal scan over `impulse`, `sweep`, `pink`, `fullscale` (+-1 square), `silence-after-signal` at 48 kHz/512 | 0 NaN, 0 Inf, denormals <= `0` | no VST3/harness |
| `tail` | after the input stops, output RMS over a 0.25 s window starting at the declared tail | `tail_db <= -90` dBFS | no VST3/harness |
| `bench` | `pink` 10 s at 48 kHz/512, N=5 runs, realtime factor | **median** >= `20`x realtime | no VST3/harness |

Declared tail (tail gate), first match wins: `--tail-seconds` -> `status.json audio.tail_seconds`
-> the plugin's own `getTailLengthSeconds()` -> 2.0 s. An unbounded reported tail falls back to 2.0 s.

Override thresholds (lowest to highest priority): built-in defaults -> `apc.config.json`
`audio.<gate>.*` -> the plugin's `status.json` `audio.<gate>.*`:

```json
{ "audio": {
    "tail":  { "max_db": -90, "default_tail_seconds": 2 },
    "bench": { "min_realtime_factor": 20, "runs": 5, "seconds": 10 },
    "null":  { "baseline_tolerance": 1e-3, "invariance_tolerance": 1e-4, "invariance": true,
               "sample_rates": [44100, 48000, 96000], "block_sizes": [64, 512, 1024] },
    "nan":   { "max_denormals": 0 },
    "pluginval": { "strictness_level": 10, "skip_gui_tests": false },
    "clap":  { "known_failures": ["state-reproducibility"] } } }
```

Do not loosen a threshold to make a failure go away without telling the user which
threshold moved and why. Plugins with free-running modulation, random generators or
block-size dependent smoothing will legitimately fail the invariance check: either fix
the DSP (make it block-size independent) or set `null.invariance: false` for that plugin
and record the reason.

## Running

```
node bin/apc.js audio <Plugin>                           # all gates
node bin/apc.js audio <Plugin> --gate pluginval,nan      # subset (comma list or repeat --gate)
node bin/apc.js audio <Plugin> --json                    # full report on stdout
node bin/apc.js audio <Plugin> --build-harness           # build the render harness first (once per checkout)
node bin/apc.js audio <Plugin> --baseline-update         # (re)write null-test baselines
node bin/apc.js audio <Plugin> --fail-on-skip            # CI: ANY skipped gate fails the run (use --gate to list only the gates that must run; clap is skipped for non-CLAP plugins)
node bin/apc.js audio <Plugin> --sanitize                # nan gate in stress mode
node bin/apc.js audio <Plugin> --build-dir <D> --report <F> --harness <P> --pluginval <P> --clap-validator <P> --tail-seconds N --runs N
```

Exit codes: `0` no failures and at least one pass; `1` any `fail`/`error` (or any skip with
`--fail-on-skip`); `2` usage error; `3` nothing was validated (everything skipped).

The plugin must already be built (`node bin/apc.js build <Plugin>` or `scripts/build-and-install.*`);
`apc audio` never builds the plugin. It looks for
`<build_dir>/plugins/<Name>/<Name>_artefacts/{Release,RelWithDebInfo,...}/{VST3,CLAP}/`.

### Outputs

- Report: `<plugin dir>/_audio-report.json` (schema `apc-audio-report/1`: `overall`, `counts`,
  per-gate `status`, `reason`, `metrics`, `thresholds`, `details`, `duration_ms`, plus the
  `inputs` that were actually used). Generated, do not hand-edit; add it to the plugin's ignore
  list if you do not want it committed.
- Baselines: `<plugin dir>/Tests/audio-baseline/<signal>-<sr>-<block>.wav` (32-bit float WAV, commit these).
- `status.json` is **not** written by the tool. After a run, record the summary through the
  state script (see the `/apc-test` snippet below) so phase gates stay consistent.

### Baseline workflow

1. First run: `null` is `skipped` (no baseline).
2. Listen to / inspect the renders, then `--baseline-update`. Commit `Tests/audio-baseline/`.
3. Later runs fail if the sound changes beyond `baseline_tolerance`. An *intentional* sound
   change means a reviewed `--baseline-update`, never a silent one.

## Render harness

`templates/audio-test-harness/` is a standalone JUCE 9 console app (`apc_audio_harness`): loads a
VST3 through `AudioPluginFormatManager` (headless formats, no GUI code), renders a signal offline via
`processBlock`, writes a metrics JSON (peak, rms, `nan_count`, `inf_count`, `denormal_count`,
`tail_db`, `max_abs_diff` vs `--reference`, `ms_per_block_*`, `realtime_factor`) and optionally a WAV.
Signals: `impulse`, `sweep`, `sine`, `pink`, `fullscale`, `silence`, `silence-after-signal`.
Instruments (no audio input, accept MIDI) get a note-on at t=0 and note-off at the end of the signal.

- Built by `node bin/apc.js audio <Plugin> --build-harness` into `<build_dir>/audio-harness/` (cmake with
  `APC_ROOT` + `_tools/JUCE`). This is the **one sanctioned cmake invocation outside
  `build-and-install`**: it builds a test tool, not a plugin, and is issued by `scripts/apc-audio.js`, not by
  the agent. Agents still never run raw cmake/msbuild themselves.
- Discovery order: `--harness`, `APC_AUDIO_HARNESS`, `<build_dir>/audio-harness/.../apc_audio_harness(.exe)`.
- Exit codes 2 usage, 3 plugin not loadable, 4 render/reference error (all write an `"ok": false` JSON);
  any other non-zero exit or signal = crash = gate `fail`.
- The harness deliberately does **not** enable flush-to-zero, so denormals produced by the plugin
  are counted; plugin-internal `juce::ScopedNoDenormals` still applies.

## Sanitizers

`cmake/apc-sanitizers.cmake` provides `apc_enable_sanitizers(<target>)` driven by
`-DAPC_SANITIZE=asan|ubsan|tsan|none`.

| Toolchain | asan | ubsan | tsan |
|---|---|---|---|
| clang / gcc | `-fsanitize=address` | `-fsanitize=undefined -fno-sanitize-recover` | `-fsanitize=thread` |
| MSVC | `/fsanitize=address` (needs the VS "C++ AddressSanitizer" component; runtime DLLs on PATH) | not available: warning, target left uninstrumented | not available: **configure error** |

Typical memory/UB run (separate build tree; never ship sanitized binaries):

```
node bin/apc.js audio <Plugin> --build-harness --harness-sanitize asan --build-dir build-asan --gate nan --sanitize
```

The harness is what gets instrumented; the plugin binary it loads is **not** unless you also build
that plugin with the same option (add `include(cmake/apc-sanitizers.cmake)` and
`apc_enable_sanitizers(<Plugin>)` to a throwaway plugin CMakeLists, build in a separate directory).
A sanitizer abort shows up as a harness crash, i.e. gate `fail` with the exit code in `reason`.
`--sanitize` (harness flag) adds a stress pattern - random block sizes down to 1 sample, mid-run
`releaseResources`/`prepareToPlay` cycles, interleaved `processBlockBypassed` - and is useful with or without
a sanitizer build. TSan only makes sense on Linux/macOS with a TSan-instrumented plugin.

## What this does NOT prove

No gate here proves musical quality, correct parameter behaviour, DAW compatibility, preset
recall or UI correctness. The `null` baseline protects against regressions only after a human
approved the render. Offline rendering with default parameter state does not cover automation
or state-restore paths (pluginval strictness 10 covers part of that).

## Proposed replacement for the `/apc-test` skill gate list (NOT applied - for integration)

Replace the TASKS list in `.agents/skills/skill_testing/SKILL.md` (and the "Tests Run" block in
`.agents/workflows/apc-test.md`) with:

```markdown
## TASKS
1.  **Build check:** the plugin must be built (`node bin/apc.js build <Name>`); `apc audio` never builds it.
2.  **Audio gates:** `node bin/apc.js audio <Name> --json` (first time on a checkout: add `--build-harness`).
    Gates: pluginval (strictness 10), clap-validator (only if `formats.clap`), null/baseline +
    block-size invariance, NaN/Inf/denormal scan, tail decay < -90 dBFS, CPU bench (median >= 20x realtime).
    Read `<plugin>/_audio-report.json`. Report each gate as pass / fail / error / **skipped (reason)**;
    never describe a skipped gate as passed. Exit 0 = ok, 1 = failure, 3 = nothing validated.
    A missing baseline means `null` is skipped: review the render, then `--baseline-update`.
3.  **Record result** (only after the gates ran):
    `Update-PluginState -PluginPath $PluginPath -Updates @{ "validation.audio_results" = @{ overall = <overall>; report = "_audio-report.json"; last_run = <iso> } }`
    and set `validation.tests_passed` true only when overall is `pass` AND the user accepts any skips.
4.  **Crash analysis:** if a render crashed, read Documents/APC_CRASH_REPORT.txt, then rerun the failing gate
    with `--build-harness --harness-sanitize asan --build-dir build-asan --gate nan --sanitize`.
5.  **Manual check:** ask the user to load the plugin in a DAW and move knobs (nothing above replaces this).
6.  **Build-error triage:** unchanged (scripts/error-detection.*, known-issues.yaml).
```
