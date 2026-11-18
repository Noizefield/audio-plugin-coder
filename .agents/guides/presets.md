# Presets (`apc-preset/1.0`) - agent guide

Backend for the locked preset standards P-01..P-14. Read `.agents/rules/product-standards.md`
first; every option below is a registry option, never a hardcoded value.

| Piece | Where |
|---|---|
| File/chunk schema | `schemas/apc-preset.schema.json` (`apc-preset/1.0`) |
| PMX/1 vocabulary (slugs, ordered words, contradictions) | `schemas/pmx1-vocabulary.json` |
| CLI | `apc presets validate\|index\|promote\|init\|paths\|check-manifest` (`scripts/apc-presets.js`) |
| C++ reference code (std only, no JUCE) | `common/apc/ApcAtomicFile.h`, `ApcPaths.h`, `ApcDefaultsFirst.h` |
| Tests | `test/presets.test.js`, `test/apc-cpp-presets.test.js`, `common/apc/tests/` |

## 1. End-to-end flow

```bash
apc standards plan --plugin <Name>     # answers preset.hierarchy, the *_ext options, preset.factory_install ...
apc presets init   --plugin <Name>     # Assets/presets/Factory/{pack.json,INIT} + empty _wip/
# author or generate assets into Assets/presets/_wip/ (live-tweak in the DAW, Ctrl/Cmd+S overwrites)
apc presets validate <plugin>/Assets/presets/_wip --factory --plugin <Name> [--manifest param-manifest.json]
apc presets promote  --from <...>/_wip --to <...>/Factory [--ids id1,id2] [--dry-run]
apc presets index    <appDataRoot>     # only needed to inspect the index; promote regenerates it
# ship: the installer places the Factory pack (see section 6)
```

- `init` reads `status.json` -> `standards` through `scripts/apc-standards.js` (`resolveEffective`:
  plugin answer > global default > registry default). Extensions come only from `preset.sound_ext`,
  `kit_ext`, `seq_ext`, `patch_ext`, `preset_ext` (flat). A missing extension is an error that names
  the option; never invent one.
- `preset.hierarchy` = `typed`: the pack uses `sounds/ kits/ sequences/ patches/ samples/`; `flat`:
  assets sit directly in the pack. **Never mix the two inside one pack** (`mixed-layout` error).
- INIT has empty `params` (= "all declared defaults") and `meta.role: "init"`, which exempts it from
  factory metadata completeness. Keep it; the compiled-in fallback must match it.
- `validate` exits 1 on any error (`--strict`: also on warnings). `--json` everywhere.
  Factory strictness applies when `--factory` is passed or `pack.json` has `"license": "factory"`;
  `_wip` and `User` are lenient on completeness but always strict on invalid values and broken refs.
- `promote` lints the selection (and the dependencies it drags in: kits -> sounds, patches -> kits and
  sequences, samples) as factory content, refuses with nothing written if lint fails, copies
  leaves-first with temp+rename and full rollback, appends `changelog.json`, regenerates the index.
  Same id at the destination = update of that file; different id with the same name = refused.

## 2. Where files live (P-03)

`apc presets paths --plugin <Name> [--os win|mac|linux]` prints the layout. Root is
`<Base>/<Manufacturer>/<PluginName>/` with `<Base>` = `%LOCALAPPDATA%` | `~/Library/Application Support`
| `~/.local/share` (machine-wide: `%PROGRAMDATA%` | `/Library/Application Support` | `/usr/local/share`).
`APC_PRESET_ROOT` replaces `<Base>`. Never Program Files or `/Applications`.

```
presets/<Pack>/{pack.json, sounds/ kits/ sequences/ patches/ samples/}   (typed)
presets/<Pack>/{pack.json, <name><preset_ext>, samples/}                 (flat)
presets/_wip/  presets/User/   cache/_index.json   settings.json   user-data.json   license.lic
```

`user-data.json` (ratings/favorites, keyed by asset id, never by name):
`{"schema":"apc-user-data/1.0","assets":{"<id>":{"rating":0-5,"favorite":true,"uses":3}}}`.
It survives rescans and pack updates; `cache/_index.json` is disposable.

## 3. File <-> host chunk: one schema

The DAW state chunk is the same document as a patch/preset file plus `state_version` and
`app_version`. Differences:

- `engine` section (oversampling, quality, voices) exists **only in the chunk** when
  `engine.state_scope=chunk` (default) so a project recalls identically on any machine. Asset files
  must not carry it (`engine-in-asset` warning). With `machine` scope the section is absent.
- Samples are stored as `samples: [{ref, sha256, bytes, pack, embedded_b64?}]`. Restore order:
  relative `ref` (verified by sha256) -> hash lookup -> `embedded_b64` -> visible `[Missing]`
  placeholder. A bare path (`sample_ref`) is fragile and lints as `sample-no-hash`.
- UI preferences (theme, scale, tooltips) are machine settings, never in the chunk.
- Take a full parameter snapshot explicitly when saving; do not depend on which params were touched.

## 4. Rules the linter enforces

- Vocabulary values are lowercase **slugs** from `pmx1-vocabulary.json` (`drum-and-bass`, `dark`,
  `bass`); labels/aliases are accepted on read with a `vocab-noncanonical` warning. Never store indices.
  Effect plugins use the effect categories (`reverb`, `delay`, `modulation`, `dynamics`, `eq-filter`,
  `distortion`, `pitch`, `utility`, `creative-fx`), appended in vocabulary 1.1.0.
- Factory sounds/presets: category, the 6 mandatory axes (`bri war agg wid dep mov`), 1-2 moods, `desc`.
  Patches: category, moods, desc. Kits: category, desc. Sequences: desc. Contradictory words/moods and
  more than 8 tags are errors.
- Values are real-world units. Keys ending `_hz/_db/_s/_ms/_st/_pct` that look normalized (0..1) only
  warn. Choice parameters are label strings (with `--manifest` a numeric choice is an error).
- Param keys are lowercase snake_case immutable ids; ids and choice lists are append-only
  (`apc presets check-manifest released.json current.json`; manifest = `{"schema":
  "apc-param-manifest/1.0","params":[{"id","type":"float|int|bool|choice","default","min","max","choices"}]}`).
  Run it in CI against the manifest of the last shipped version.
- References: path relative to the referencing file (or the pack root), then id lookup anywhere in the
  presets tree (`ref-rebound` warning), then `embedded[id]`, else `ref-missing`. No absolute paths, no
  `..` out of the pack, exact case, `/` separators.
- Filenames are sanitized display names; names unique per kind per pack; ids unique everywhere.

## 5. Using the C++ headers in generated plugin code

Add the repo's `common/` folder to the include path (`target_include_directories(<target> PRIVATE ${APC_ROOT}/common)`).
No JUCE types appear in the headers; convert at the boundary (`juce::String::toStdString()`,
`juce::File::getFullPathName().toStdString()`).

```cpp
#include "apc/ApcAtomicFile.h"
#include "apc/ApcPaths.h"
#include "apc/ApcDefaultsFirst.h"

// Paths: layout of the user data folder (P-03)
const auto layout = apc::makeHostLayout (apc::DataScope::PerUser, "<Manufacturer>", "<PluginName>");
if (! layout.valid) { showError (layout.error); return; }              // never fail silently
const auto file = layout.assetFile ("User", apc::AssetKind::Preset, /*flat*/ true, name, presetExt);

// Save (explicit Save/overwrite): atomic, one .bak
apc::AtomicWriteOptions opt; opt.keepBackup = true;
if (auto r = apc::atomicWrite (file, json, opt); ! r.ok) showError (r.error);   // error text contains the path

// Import: never overwrites ("Name 2.ext", "Name 3.ext")
auto imp = apc::importNoClobber (layout.assetDir ("User", kind, flat), displayName, presetExt, json);

// Restore (file or chunk): defaults first, then the stored values
std::vector<apc::ParamDecl> decls = buildDeclsFromParameterTree();       // derive from the APVTS, don't hand-maintain
std::map<std::string, apc::Value> stored = toValueMap (parsedJson["params"]);   // choice -> std::string label
auto report = apc::applyDefaultsFirst (decls, stored, [&] (const apc::ParamDecl& d, const apc::Value& v) {
    setParameterRealWorld (d.id, v);          // convert real-world value -> normalized + notify host
});
preservedUnknown = std::move (report.unknown);    // write back on the next save via apc::mergeForSave
```

- `Value("saw")` can select `bool` on older compilers; always write `std::string ("saw")`.
- Unit-test your manifest: `apc::checkAppendOnly (releasedDecls, currentDecls)` must return empty.
- Do not load/parse files on the audio thread; host program-change support (`preset.host_program_list`)
  needs a deferred-apply queue, and a restored chunk supersedes any pending selection.
- Show a visible error for every failed save/load/import (fixed rule 1).

## 6. Factory content at install time (P-14)

`preset.factory_install=user-folder` (default): the installer copies the Factory pack into the
*installing user's* `presets/` folder (use the paths above). Caveat: an elevated installer resolves
the installing user's profile, so other accounts have no factory pack until they run
"Restore Factory Layout" in the plugin. `shared-seed`: the installer writes a read-only seed
(`apc presets paths` -> `factory_install.target`) and the plugin copies it into the user folder on
first run. Either way the plugin still ships a compiled INIT so it is never empty (P-08).
