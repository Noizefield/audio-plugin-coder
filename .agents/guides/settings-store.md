# Settings store (`apc-settings`)

Backend-only machine-wide `settings.json` (`apc-settings/1.0`, `schemas/apc-settings.schema.json`). No settings page /
UI components here. Decisions: U-05..U-07, U-10, X-08 (`engine.state_scope`), stone rule 2 (settings live once per machine).

File: `common/apc/ApcSettingsStore.h` (C++17, std only, **no JUCE**). Tests: `common/apc/tests/test_settings_store.cpp`,
`test_settings_concurrent.cpp` (4 threads + 4 processes). Depends on `ApcCanonicalJson.h` (JSON tree + atomic file write).

Path: `<AppDataRoot>/<Manufacturer>/<PluginName>/settings.json` (e.g. `juce::File::getSpecialLocation(userApplicationDataDirectory)`).
Resolve it with the repo's path helpers/conventions; do not hardcode a drive or user name.

## What goes where

| Data | Where | Why |
|---|---|---|
| `ui.*` (theme, scale, tooltips, wheel target, `ui.auto_update_check`, ...) | `settings.json` | machine-wide preferences |
| `presets.*`, `update.last_check_unix` | `settings.json` | machine-wide bookkeeping |
| `engine.*` (oversampling, voices, quality) | **DAW project chunk by default**; `settings.json` supplies defaults for NEW instances | option `engine.state_scope` = `chunk` (default) / `machine` |
| Sound state, modulation, selected page | DAW project chunk | per instance (X-02) |
| License secret | `license.lic` (never `settings.json`) | `licensing-seam.md` |

### Engine scope (amends U-06 for sound-affecting settings)

```cpp
auto scope = apc::parseEngineStateScope(option_engine_state_scope);          // "chunk" (default) | "machine"
// chunkValue = what the DAW project restored for this instance, or nullptr for a brand-new instance
JsonValue os = apc::resolveEngineValue(store, "oversampling", scope, chunkValue, /*built-in*/ JsonValue(1));
```

- `chunk`: a restored project keeps **its own** value on any machine (a project recalls identically); a new instance
  starts from `settings.json engine.*`, then the built-in default. Changing the machine default never changes an
  existing project. To let the user "use this as default for new instances" call `setEngineMachineDefault()`.
- `machine`: `settings.json` is authoritative and a chunk value is ignored; the UI must warn "affects all instances".
- Either way, a latency-affecting change must be followed by `setLatencySamples()` (X-03); the store does not know.

## API

```cpp
apc::SettingsStore::Options o; o.filePath = settingsPath;
apc::SettingsStore store(o);
std::string err;
store.load(err);                                  // missing file is fine; never creates the file
store.getBool("ui.tooltips", true); store.getInt(...); store.getDouble(...); store.getString(...); store.get("presets.recents");
store.set("ui.theme", "night", err);              // dotted keys address nested objects; returns false + err on failure
store.setMany({ {"ui.scale", 1.25}, {"ui.tooltips", false} }, err);
store.erase("ui.scale", err);
store.update([](apc::JsonValue& root){ ...; return true; }, err);   // custom merge, runs under the lock - keep it tiny
store.refreshIfChanged();                         // cheap stat poll; call when a plugin window opens (U-06: no hot-sync needed)
store.claimTimeSlot("update.last_check_unix", now, 86400);          // once-per-interval across threads AND processes
for (auto& w : store.takeWarnings()) show(w);     // corrupt file quarantined, claim failures, ...
```

Rules:

- **Failure is visible** (stone rule 1): every write returns `false` with a human-readable `err` - show it. Reads that hit
  a corrupt file queue a warning instead of silently resetting.
- Keys containing `.` are not addressable; arrays are replaced wholesale; `schema` is added if missing.
- Written pretty-printed with sorted keys; doubles stay doubles (`1.0` is written `1.0`).
- Not for the audio thread (file I/O + mutexes). Read once at init/window open and cache values in atomics.
- Floats are fine here (unlike signed documents).

## Concurrency model (several DAW processes / instances, one file)

Every write is: **lock -> re-read the file as it is now -> apply only this caller's keys -> temp file -> atomic rename -> unlock.**

- Per-key **last-writer-wins**; keys nobody touched, including ones this version does not know, are carried over
  from the fresh read - concurrent writers lose nothing. There is no long-lived authoritative in-memory copy.
- Lock = directory `settings.json.lock` created with `create_directory` (atomic everywhere). Older than `staleLockMs`
  (3 s) = abandoned by a crashed holder and broken. Timeout `lockTimeoutMs` (5 s) => the write **fails visibly**.
  Residual risk: a holder stalled > 3 s can have its lock broken, which can lose one update but never corrupts the file.
- Readers do not lock; they retry briefly if a rename is in flight (Windows). `refreshIfChanged()` compares size+mtime.
- The shared update-check timestamp uses `claimTimeSlot` (check-and-set inside the lock): exactly one instance per day wins.
  A stored time in the future (clock moved back) counts as due.

## Robustness

- Unknown keys/sections preserved on every write (forward compatibility, standard rule 5).
- Corrupt JSON -> moved to `settings.json.corrupt-<unix>[-n]` (never deleted, never overwritten), fresh document,
  a warning for the UI.
- `schema` major > 1 -> readable but **never written** (error: "written by a newer version").
- UTF-8 BOM (PowerShell/Notepad) is tolerated on read.
- No fsync: atomic against crashes, not against power loss.

## Do not

- Put sound state or per-project data here, or license secrets.
- Hold the store across the audio callback or add background threads that write on a timer.
- Edit `settings.json` by hand from scripts while plugins may be running; use the store (or accept last-writer-wins races).
