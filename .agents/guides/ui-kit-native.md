# UI kit - native side (`common/apc/juce`)

How a generated JUCE 9 WebView plugin gets the preset store, the settings, license and update glue and the JS <-> C++ bridge
behind the UI kit in `templates/webview/apc-ui/` (contract: `templates/webview/apc-ui/CONTRACT.md`, which is binding).
Read `.agents/rules/product-standards.md` first; options like `preset.hierarchy` or `engine.state_scope` come from the standards
registry, never from this file. Related guides: [presets](presets.md), [settings-store](settings-store.md), [updater](updater.md),
[licensing-seam](licensing-seam.md), [crash-diagnostics](crash-diagnostics.md).

| Piece | File | Needs |
|---|---|---|
| Preset store (scan, index, list, load/save, A/B, chunk, import/export) | `common/apc/juce/ApcPresetStore.h` | `juce_core` + the std-only `common/apc/*.h` |
| Lock-free "prepare off-thread, swap on the audio thread" | `common/apc/juce/ApcPendingSwap.h` | std only |
| Bridge dispatcher, events, URL allow-list, `addApcNativeFunctions` | `common/apc/juce/ApcWebBridge.h` | `juce_core`, `juce_events`; `juce_gui_extra` for the WebView part |
| APVTS -> descriptors + `LiveState` | `common/apc/juce/ApcApvtsParams.h` | `juce_audio_processors` |
| JS side | `templates/webview/apc-ui/apc-bridge.js` | classic script, falls back to `apc-mock.js` |
| Tests | `common/apc/tests/juce/`, `test/apc-cpp-juce.test.js` | CMake + MSVC/c++, JUCE in `_tools/JUCE` |

Include path: `<repo>/common` (`target_include_directories(<target> PRIVATE ${APC_ROOT}/common)`; the WebView CMake template does it
when its `UI_KIT` option is ON). Namespaces: `apc::presets` (store), `apc::web` (bridge), `apc::PendingSwap`.

## 1. Wire it into a plugin

### Processor (lives as long as the plugin; the editor only borrows)

```cpp
#include "apc/juce/ApcWebBridge.h"
#include "apc/juce/ApcApvtsParams.h"

class MyProcessor : public juce::AudioProcessor
{
public:
    // ... existing parameters / apvts ...
    apc::web::ApcBackend apcBackend;                       // read by the editor's ApcBridge
private:
    apc::web::ParamTable paramTable;                       // ONE help-text source, see section 3
    std::unique_ptr<apc::web::ApvtsParams> apcParams;
    std::unique_ptr<apc::presets::Store> presets;
    std::unique_ptr<apc::SettingsStore> settings;          // optional; ApcSettingsStore.h
    // optional: apc::LicenseManager, apc::UpdateFlow (and the IHttp / ISignatureVerifier they need)
};

// in the constructor, AFTER the APVTS exists:
const auto layout = apc::makeHostLayout (apc::DataScope::PerUser, "<Manufacturer>", "<PluginName>");   // standards: preset.* options
apc::presets::StoreConfig cfg;
cfg.layout = layout;                       // check layout.valid; on failure show layout.error, never fall back silently
cfg.flat = false;                          // preset.hierarchy
cfg.soundExt = ".<ext>"; cfg.kitExt = ".<ext>"; cfg.seqExt = ".<ext>"; cfg.patchExt = ".<ext>";   // or cfg.presetExt for flat
cfg.pluginName = "<PluginName>";
cfg.appVersion = JucePlugin_VersionString;
cfg.engineInChunk = true;                  // engine.state_scope == "chunk" (default)
cfg.gate = [this] (apc::presets::Gate g)   // L-02: the only enforcement point for save / import / export
{
    using V = apc::Verb;
    const V v = g == apc::presets::Gate::Save ? V::PresetSave : g == apc::presets::Gate::PackInstall ? V::PackInstall : V::PackExport;
    return licenseManager == nullptr || licenseManager->isAllowed (v);
};
presets = std::make_unique<apc::presets::Store> (cfg);

apcParams = std::make_unique<apc::web::ApvtsParams> (apvts, paramTable, modulationFor /* optional */);
auto live = apcParams->liveState();        // decls + snapshot + apply + "this is a preset apply, not a user edit"
live.snapshotExtras = [this] { return buildExtras(); };           // modulation, structured chunks, macros, samples ... (optional)
live.applyExtras    = [this] (const juce::var& doc, const juce::var& refs) { applyExtras (doc, refs); };   // {} = reset to defaults
live.getEngine = [this] { return engineAsVar(); };                // oversampling / quality / voices (X-08)
live.setEngine = [this] (const juce::var& e) { applyEngine (e); };   // report latency afterwards (setLatencySamples)
presets->setLiveState (std::move (live));

apcBackend.info.product = "<Product>"; apcBackend.info.manufacturer = "<Manufacturer>"; apcBackend.info.version = JucePlugin_VersionString;
apcBackend.info.links = { { "company", "<url or empty>" }, { "product", "..." }, { "docs", "..." }, { "support", "..." }, { "update", "..." } };
apcBackend.info.features = /* juce::var object: themeEnabled, helpMode, ... from the standards options */;
apcBackend.params = apcParams.get();
apcBackend.presets = presets.get();
apcBackend.settings = settings.get();
apcBackend.license = { licenseManager.get(), layout.licenseFile, "signed-file" };   // + activateOnline / offlineRequest hooks if the backend exists
apcBackend.update = updateFlow.get();
apcBackend.engineGet = [this] (const juce::var&) { return engineAsVar(); };
apcBackend.engineSet = [this] (const juce::var& patch) { mergeEngine (patch); return engineAsVar(); };
// apcBackend.modSet / modRemove / modClear / midiLearn / ... : leave null if the plugin has no such feature -> { error:"unsupported" }

// getStateInformation / setStateInformation: section 5
```

Fill `apcBackend` completely BEFORE the first editor opens. Hooks are read lazily, but `params`, `presets`, `settings`,
`license`, `update` pointers are used by the first call.

### Editor / CMake / index.html

The WebView templates already contain everything, behind `#if APC_UI_KIT` (see `templates/webview/README.md`, "UI kit bridge"):

1. CMake: replace `{{APC_UI_KIT_ENABLED}}` with `ON`. That defines `APC_UI_KIT=1`, adds `<repo>/common`, and injects the kit bundle into `index.html`.
2. `Source/ui/public/index.html`: add `<!-- APC_KIT_SCRIPTS -->` once, after the inlined JUCE interop block (webview-008: all JS inline).
3. Editor member order stays `relays -> apcBridge -> webView -> attachments`. `node bin/apc.js validate webview-order --plugin <Name>` must still pass.
4. `apcBridge.attach (*webView)` goes AFTER `goToURL`.

## 2. Wire format (what `apc-bridge.js` and `ApcWebBridge.h` agree on)

- JS calls `APC.bridge.call ("apc.x.y", argsObject)`. The native function receives ONE parameter, the object (`{}` when none).
- Success = the value shaped as in `CONTRACT.md`. Failure = `{ "error": "<code>", "message": "<text>", "path": "<file>" }`. Codes are snake_case and use the
  spellings the kit and `apc-mock.js` already use: `gated` (+ `verb`: PresetSave | PackInstall | PackExport; the UI opens the activation sheet), `exists` (Save As onto another
  file; retry with `replace:true`), `unknown_function`, `unknown_param`, `not_found`, `readonly`, `io` (read or write failed; `path` set), `invalid`, `empty` (A/B slot),
  `unsupported`, `invalid_state`, `bad_json`, `bad_schema`, `unverified` / `invalid_file` (license rejected), `url_not_allowed`, `busy`, and the issuer's codes
  (`invalid_serial`, `seat_limit`, ...) passed through from `OnlineReply`.
- The JS promise never rejects. A plugin error is a returned VALUE: the calling component presents it (every kit component checks `r.error` and either
  emits `APC.emit ("error", ...)` or shows it inline, e.g. `exists` offers "overwrite"); `apc-bridge.js` does not toast it a second time.
  Infrastructure failures (no answer within the per-call timeout, a function the plugin build does not have, transport error, no backend) resolve
  `{ error, message, infra: true }` and `apc-bridge.js` emits the visible `error` event for those itself (pass `{ quiet: true }` to suppress).
  A failed call never also produces a native `error` event; native `error` events are for unsolicited failures (worker threads, background rescans, settings file damage).
- Events (C++ -> JS) use the id `apc.<name>`: `param {id,value}`, `preset {state}`, `license {status}`, `update {state}`, `meter {id,value}`, `error {message,detail?,source}`.
- Values are real-world units. A choice parameter travels as its INDEX on the bridge (the descriptor carries `choices`) and as its LABEL in
  preset files. `normalized: true` in the `ParamTable` entry is the only way 0..1 values reach the UI.
- Beyond CONTRACT.md (the kit already calls these and `apc-mock.js` implements them; CONTRACT.md should list them): `apc.presets.info` (`{root, assets, builtAt, devRoot?,
  factoryInstall, hierarchy, packs:[{name,readOnly,count}], writablePacks}`), `apc.presets.restoreFactory` (`{ok, restored, path}`), `apc.update.cancel`.
- Shapes the kit relies on (same as the mock): `apc.presets.load/revert/init/ab` return the flat preset state `{ current:{id,name,dirty,readOnly,kind,pack,missing:[names]}, ab, loadBehavior }`
  plus `applied, defaulted, warnings, unresolved`; INIT is `current.id === "init"` (read-only, no file). `apc.presets.save` returns `{ ok, id, path, file, name, pack, kind, copiedFromReadOnly, state }`;
  a call with no `name` is Quick Save, any `name` is Save As. `apc.presets.import` takes `{path}` or `{name, data, encoding:"base64"}` (dropped files) and returns `{ ok, imported:<count>, items, pack }`;
  `exportPack` `{ ok, count, path, file }`; `rescan` `{ ok, count, builtAt }`; list items add `missing:[names]`, `readOnly` and the file's `author` inside `meta`, and the result adds `totalAll`.
  `apc.diagnostics.copy` returns `{ text }`. `apc.update.check` / `.download` answer at once (`state` forced to `Checking` / `Downloading`); the outcome arrives as `update` events
  (`error` is the code name such as `Network`, `message` the text).

### `apc.presets.list` query

```json
{ "scope": "everything | patches | sounds | kits | sequences | presets | pack:<Name> | <Name>",
  "filters": { "kind": ["sound"], "category": ["bass", "pad"], "subcategory": [], "genre": ["drum-and-bass"],
               "mood": ["dark", "tense"], "tag": ["reese"], "axes": { "bri": { "word": "muted", "op": "gte" }, "war": "warm" },
               "pack": ["Factory"], "favorite": true, "rating": 3 },
  "search": "text", "sort": "name | type | rating | recent | bpm | used | path", "limit": 50, "offset": 0 }
```

Semantics (plans `tagging-filtering.md` section 7, identical to what the Node tools index): OR inside one group, AND across groups; an `axes`
entry is a THRESHOLD on the ordered word list (`"muted"` or `{word:"muted", op:"gte"}` = muted or brighter, `op:"lte"` = muted or darker; the UI kit sends the object form); untagged assets pass only groups left at `any`/empty;
unknown axis names/words and unknown sort keys are errors, not empty lists; genre aliases (`drum&bass`) are normalised to slugs; search is a
case-insensitive substring over `name subcategory desc category author tags moods` (query capped at 64 characters). Sort is a real sort,
factory entries included. `type` = category then name (uncategorised last), `rating` = stars desc then name, `recent` = last loaded
(else file time) desc, `bpm` ascending with missing last, `used` = load count desc. `path` is the index order (tools/tests).

## 3. Parameters and help text

`ApvtsParams` walks the APVTS once: descriptors (`min/max/default/value` real-world, `skew`, `step`, `choices`, `unit` from the parameter label), the
`apc::ParamDecl` list for defaults-first restore, and the full-state snapshot. Ids are the immutable APVTS ids (X-01).

Help text lives in ONE table (`ParamTable`), authored once, e.g. `Design/param-help.json` embedded as binary data:

```json
{ "filter_cutoff_hz": { "name": "Cutoff", "unit": "Hz", "group": "Filter", "midiCc": 74,
                        "help": { "what": "Cutoff frequency of the low-pass filter.", "effect": "Higher opens the sound.", "how": "Drag, or click the value and type 800 or 1.2k." } } }
```

`ParamTable::fromJsonText (...)`, then pass it to `ApvtsParams`. Tooltip, info bar, F1 help and the context panel all read the descriptor `help` - never write
help text anywhere else. CI check: `paramTable.missingHelp (apcParams->ids())` must be empty.

## 4. Threading - what runs where

| Where | What |
|---|---|
| Audio thread | Nothing from these headers except `PendingSwap::acquire()` and your own atomics. The APVTS listener inside `ApvtsParams` only flips an atomic per parameter. |
| Message thread | Native-function callbacks (JUCE guarantees it), `Store::load/save/revert/init/ab/serializeChunk/restoreChunk/notifyParamChanged`, `LiveState` callbacks, all event delivery. |
| Worker lanes inside `ApcBridge` | `apc.presets.rescan/import/exportPack` (I/O lane), `apc.license.activate/loadFile/deactivate` (license lane), `apc.update.check/download` (update lane). Their completions arrive from the worker; JUCE marshals them. |
| Any thread | `Store::rescan()`, `index()`, `list()`, `setRating/setFavorite` (internally locked; the user-data file uses merge-on-write under a lock directory), `ApcBridge::emit*` (delivery is posted to the message thread). |

Known limit: the lanes belong to the editor-owned bridge, so closing the editor while an update manifest request is in flight waits for it
(`UpdateFlow::cancel()` stops downloads promptly, but not a running `IHttp::get`): keep `UpdateConfig::checkTimeoutMs` short (default 8 s).

Rules: never block the message thread on the network (activation and update calls run on lanes and answer by event); never parse
or allocate on the audio thread; the bridge dies before the stores it points at (the editor owns it); call `apcBridge.shutdown()` first if you
ever outlive them. `ApcBackend::post` defaults to `MessageManager::callAsync`; tests inject their own.

### Handing parsed state to the audio thread

Parse and validate on the message thread (`LiveState::applyExtras` is the hook), build an immutable object, publish it:

```cpp
apc::PendingSwap<ModMatrix> modSwap;                              // member of the processor
// message thread, inside applyExtras:
modSwap.publish (std::make_unique<ModMatrix> (parse (doc)));      // allocation happens here
modSwap.collectGarbage();                                         // also from a timer
// audio thread, once per block:
const ModMatrix* m = modSwap.acquire();                           // wait-free; valid until the next acquire(); null before the first publish
```

The old object goes back through a fixed trash ring and is deleted on the message thread. If the ring is full the swap is postponed, never blocked.
`Store::generation()` / `PendingSwap::generation()` let a deferred host program change drop itself when a state restore arrived first (P-12).

## 5. The host chunk (DAW project state)

```cpp
void getStateInformation (juce::MemoryBlock& dest) override
{
    const auto r = presets->serializeChunk();                     // the apc-preset/1.0 document + state_version + engine + session
    if (r.ok) dest.append (r.value.data(), r.value.size());
    else reportError (r.error);                                   // visible, never swallowed
}
void setStateInformation (const void* data, int size) override
{
    if (apc::presets::Store::looksLikeChunk (data, (size_t) size))
    {
        const auto r = presets->restoreChunk (data, (size_t) size);   // defaults first, then the stored values
        if (! r.ok) reportError (r.error);                            // bad chunk -> plugin stays on its defaults
        return;
    }
    restoreLegacyXml (data, size);                                // projects saved before the kit (APVTS XML)
}
```

- Same document as a patch/preset file plus `state_version`, `app_version` and (only when `engine.state_scope = chunk`) an `engine` section, so a
  project sounds identical on any machine (X-08). Asset files never carry `engine`/`state_version`; with `machine` scope the chunk has no `engine` either and a
  chunk `engine` is ignored on restore (set `cfg.engineInChunk = false`).
- The chunk stores a FULL parameter snapshot (explicit, not "whatever was touched"), unknown keys of newer builds survive a round trip, and a `session`
  member keeps the current preset id/name, the dirty flag and both A/B slots. UI preferences are NOT in it (they live in `settings.json`, U-06).
- `state_version` newer than the build: restored anyway (defaults-first) with a warning in `ChunkReport`. Schema major > 1: `bad-schema`.
- Samples: use `Store::makeSampleEntry` / `resolveSample` (relative ref verified by sha256, then hash lookup, then `embedded_b64`, then `[Missing: ...]`).

## 6. Store behaviour in one place

- Scan = same rules as `apc presets index` (rows `id kind name pack path meta mtime size hash rating favorite [uses]`, sorted by path); the cache is `cache/_index.json`,
  invalidated by mtime+size, safe to delete. Rows add `author`. A bad file is reported in `Index::errors` (never silently skipped).
- Save: `SaveRequest { name, pack, kind, meta, saveAs, overwrite }`. Quick Save (no name) overwrites the loaded file (one `.bak`); anything read-only (pack `license:"factory"`, or in
  `cfg.readOnlyPacks`) is copied to `User` with a new id and `derived_from` (the kit routes read-only and INIT through its Save As sheet first). Any explicit name is a Save As: a
  collision with an existing file is error `exists` until `overwrite:true` (the kit sends `replace:true`; both work); the replaced file keeps its id.
  The full parameter snapshot is written in declaration order; keys this build does not declare are carried over; references found only by id are rewritten on save
  when the target is inside the pack. Writes are `apc::atomicWrite` (temp + rename), so a crash leaves the previous file.
- Load: defaults first, then the file (`apc::applyDefaultsFirst`); invalid/clamped values and unresolved references are in `LoadReport` (and `warnings`), never a crash:
  a missing referenced asset yields a `[Missing: <name>]` placeholder entry for the UI. A preset apply never marks the preset dirty; a later user edit does.
- A/B: `toggle` (first use copies A to B), `copyAtoB`, `copyBtoA`; dirty is recomputed against what the last load/save applied. `revert` reloads from disk; `init` applies the
  declared defaults and calls `applyExtras ({})`.
- Import never overwrites (`Name 2.ext`); a colliding id gets a fresh one. Pack archives (zip, `pack.json` at the root) are validated entry by entry before anything is written
  (zip-slip, absolute paths, drive letters, size cap), a pack with the same id and version is a no-op, a newer version updates only that pack's files.
  `exportPack` bundles the selection plus everything it references (kits -> sounds, samples) into `<root>/exports/<Name>.zip`.
- Restore Factory Layout: `cfg.restoreFactory` (extract your embedded archive, e.g. with `Store::restoreFromZip`) or the shared seed folder; `User/` and `_wip/` are never touched.
- Gates: `cfg.gate` is called for save, import and export. A denied verb returns `gated`; ratings, favorites and loading stay free (L-02).

## 7. Security notes

- `apc.openUrl` opens only `https://` URLs equal to, or under, one of the configured `info.links`; nothing auto-launches, and every open is a result of a JS call (user click).
- The license text a server returns is re-verified locally by `LicenseManager::activateFromText`; the bridge adds no trust to the issuer. No telemetry, no background network.
- "Copy diagnostics" returns text only; the bridge redacts the home folder, user name and the app-data root (extend with `ApcBackend::diagnosticsExtra`, which is redacted too).
- The kit never calls `fetch`; the native side adds no HTTP either. `IHttp` for the updater and the online-activation hook are yours.

## 8. What is verified (and what is not)

Verified in `test/apc-cpp-juce.test.js` (real MSVC build, real JUCE 9, real files): store scan/list/filters/sort, load/save/atomic fault injection, user-data, A/B/dirty/revert,
copy-on-write, references and placeholders, defaults-first golden file, chunk round trip incl. `engine`, import/export/zip-slip, factory restore, the dispatcher for every
CONTRACT function, license/update glue, URL allow-list, redaction, `PendingSwap` under contention, the APVTS adapter on a real `AudioProcessorValueTreeState`, cross-check
against `apc presets index` (identical rows, Node reuses the C++ cache), `apc-bridge.js` against JUCE's own interop library and together with the real `apc-mock.js`, a drift guard
(every `apc.*` function the kit JS mentions is implemented natively), and the CMake kit block (configure + bundle injection into `index.html`). The `WebBrowserComponent` wiring is
compiled and linked against JUCE 9 (WebView2 static linking when the SDK is available) but never run.

NOT verified: a real DAW host, a live WebView2/WKWebView/WebKitGTK page calling the functions, macOS and Linux builds, the on-page behaviour of the generated `index.html`.

## 9. Do not

- Do not register your own `apc.*` native functions or rename the contract ones; add plugin features through the `Hook` members.
- Do not write help text, units or ids anywhere but the `ParamTable` / the APVTS.
- Do not call store methods that touch `LiveState` from the audio thread or a worker.
- Do not bypass `cfg.gate` by writing preset files yourself; do not add network code to make a link "work".
- Do not hardcode paths or extensions: `apc::makeHostLayout` and the standards options decide them.
