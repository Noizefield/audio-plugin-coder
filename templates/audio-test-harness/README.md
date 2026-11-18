# APC audio test harness

A small **JUCE 9 console app** (`apc_audio_harness`) that loads a VST3, renders a test signal
offline through `processBlock`, and writes a metrics JSON (and optionally the rendered WAV).
It is the render engine behind the `null`, `nan`, `tail` and `bench` gates of
`node bin/apc.js audio <Plugin>` (see `.agents/guides/audio-validation.md`).

It is **not** part of any plugin build and not linked into plugins. It uses the headless JUCE 9
module (`juce_audio_processors_headless` + `addHeadlessDefaultFormatsToManager`), so no GUI code
is compiled and no plugin editor is ever created.

## How it is built and run (by the node gate)

Agents do not run cmake for this by hand. The gate does:

```
node bin/apc.js audio <Plugin> --build-harness
```

`scripts/apc-audio.js` then runs, from the repo root:

```
cmake -S templates/audio-test-harness -B <build_dir>/audio-harness -DAPC_ROOT=<repo root> -DAPC_SANITIZE=none
cmake --build <build_dir>/audio-harness --config Release --target apc_audio_harness
```

(`<build_dir>` is `paths.build_dir` from `apc.config.json` or `--build-dir`.) JUCE comes from
`_tools/JUCE`; the sanitizer helper from `cmake/apc-sanitizers.cmake`. This is a *test tool* build,
the only cmake call APC issues outside `build-and-install` - see the note in the audio-validation
guide. The gate then finds the binary at
`<build_dir>/audio-harness/apc_audio_harness_artefacts/<Config>/apc_audio_harness[.exe]`
(or `--harness <path>` / `APC_AUDIO_HARNESS`) and invokes it once per render with `--out` pointing
at a temp JSON.

With a sanitizer: `--build-harness --harness-sanitize asan|ubsan|tsan --build-dir <separate dir>`.

## Command line

```
apc_audio_harness --plugin <file.vst3> [options]
  --signal impulse|sweep|sine|pink|fullscale|silence|silence-after-signal   (default pink)
  --sr <Hz> (48000)   --block <n> (512)   --seconds <s> (2)   --tail-seconds <s> (0)
  --seed <n> (1)      --out <metrics.json>   (default: stdout)
  --write-wav <f.wav>    write the rendered output as 32-bit float WAV
  --reference <f.wav>    compare the render with a reference WAV -> max_abs_diff
  --sanitize             stress pattern (random block sizes down to 1, re-prepare cycles, bypass blocks)
  --help
```

Exit codes: `0` rendered; `2` usage error; `3` plugin could not be found/loaded; `4` render or
reference error. Codes 2-4 still write `{"ok": false, "error": "..."}`. Any other non-zero exit, or a
signal, means the plugin (or an attached sanitizer) crashed - the node gate reports that as a gate `fail`.

Signals are generated up-front from a fixed seed, so the input is identical on every platform and
independent of block size:

| Signal | Content |
|---|---|
| `impulse` | single 1.0 sample at frame 0 on every input channel |
| `sweep` | log sine sweep 20 Hz to min(20 kHz, 0.45 sr), -6 dBFS |
| `sine` | 1 kHz, -6 dBFS |
| `pink` | Kellet pink noise, deterministic xorshift, peak-limited to 0.9 |
| `fullscale` | 100 Hz square at +-1.0 (overload / clipping paths) |
| `silence` | zeros |
| `silence-after-signal` | `pink` for `--seconds`, then silent input for `--tail-seconds` plus a 0.25 s measurement window; `tail_db` is the RMS of that window |

Instruments (no audio input channels, accept MIDI) receive a note-on (C4, velocity 100) at frame 0
and the matching note-off at the end of the signal portion.

## Metrics JSON (`"schema": "apc-audio-harness/1"`)

`ok`, `plugin`, `plugin_file`, `signal`, `sample_rate`, `block_size`, `channels_in`, `channels_out`,
`frames`, `signal_frames`, `is_instrument`, `plugin_tail_seconds` (-1 = unbounded), `peak`, `peak_db`,
`rms`, `rms_db` (computed over finite samples; floor -200 dB), `nan_count`, `inf_count`,
`denormal_count`, `tail_db` (null unless `silence-after-signal`), `max_abs_diff` (null without
`--reference`), `reference_note`, `blocks`, `ms_per_block_mean|median|max`, `realtime_factor`
(audio seconds / processing seconds, plugin load and 4 warm-up blocks excluded), `sanitize`,
`reprepare_cycles`, `bypassed_blocks`.

## Behaviour worth knowing

- Default parameter state, one plugin instance per render. Automation, state save/restore and
  editor paths are not exercised (pluginval covers some of that).
- The harness never enables flush-to-zero/denormals-are-zero, so subnormal outputs are counted
  rather than hidden; a plugin's own `juce::ScopedNoDenormals` still takes effect inside `processBlock`.
- `--sanitize` is a *stress pattern*; memory/UB detection comes from building the harness (and ideally the
  plugin) with `-DAPC_SANITIZE=asan|ubsan`. See `cmake/apc-sanitizers.cmake`.
- Only VST3 is loaded (`JUCE_PLUGINHOST_VST3=1`). CLAP has no host path in JUCE; use clap-validator.

## Verification status

Compiled with MSVC Build Tools 2022 (VS generator, x64, Release) against `_tools/JUCE` 9.0.1 and run
against installed third-party and APC-built VST3s on Windows 11: load, render, WAV write,
`--reference` diff, tail measurement, `--sanitize`, error exit codes. **Not verified:** macOS, Linux,
AU/LV2 (not supported), instruments/MIDI path, ASan/UBSan/TSan builds on any toolchain unless
stated in the audio-validation guide.
