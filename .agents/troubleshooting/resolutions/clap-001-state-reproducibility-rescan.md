# clap-validator fails state-reproducibility-basic/-binary/-buffered on every JUCE CLAP plugin

**Issue ID:** clap-001
**Category:** build (upstream dependency)
**Severity:** medium
**First Detected:** 2026-10-10 (ClapSmokeTest, JUCE 9.0.1 + clap-juce-extensions 7adee3a)
**Resolution Status:** workaround (upstream fix pending)

---

## Problem Description

`clap-validator validate <plugin>.clap` fails exactly these three tests for any
JUCE plugin built through `_tools/clap-juce-extensions` whose state contains
parameter values (i.e. every APVTS-based APC plugin):

```
FAILED: After reloading the state, these parameter values changed without a
rescan request:
 - gain (...) - <before> vs <after>
```

Typical result line: `44 tests run, 27-28 passed, 3 failed, 1-2 warnings`.

## Root Cause

Upstream: `ClapJuceWrapper::stateLoad` (clap-juce-wrapper.cpp) calls
`AudioProcessor::setStateInformation` and returns `true` without calling
`clap_host_params.rescan(CLAP_PARAM_RESCAN_VALUES)`. CLAP spec requires a
values rescan after a state/preset load so host parameter caches refresh.
Without it, the validator's fresh instance sees changed values it was never
told about.

Confirmed upstream, fix pending:
`free-audio/clap-juce-extensions` PR #189 ("Ask the host to rescan parameter
values after a state load"). Verified unfixed at APC's pinned commit `7adee3a`
(2026-10-06, main HEAD at pin time). This is NOT an APC wiring bug and NOT a
plugin-code bug — the plugin itself restores state correctly; the wrapper
just skips the rescan notification. Real DAWs re-read parameter values on
project load, so shipping is not blocked.

## Solution

### Accept the warning (recommended for now)

`build-and-install` treats clap-validator failures as non-fatal. The three
failures are expected until upstream merges the fix.

### Filter the tests when a green run is needed

```powershell
clap-validator validate --test-filter "state-reproducibility.*" --invert-filter ".\MyPlugin.clap"
```

### Bump the submodule once upstream merges

```powershell
cd _tools/clap-juce-extensions
git fetch origin
git checkout <commit-with-PR-189>
cd ../..
git add _tools/clap-juce-extensions
```

### Patch locally (last resort, dirties the submodule)

Upstream PR #189 is a 3-line change in
`src/wrapper/clap-juce-wrapper.cpp`, `stateLoad`, after
`setStateInformation(...)` / `chunkMemory.reset()`:

```cpp
if (_host.canUseParams())
    _host.paramsRescan(CLAP_PARAM_RESCAN_VALUES);
```

Do NOT commit the dirty submodule; revert after validation.

## Prevention

Track `free-audio/clap-juce-extensions` PR #189. When it merges, advance the
`_tools/clap-juce-extensions` submodule pin and re-run the ClapSmokeTest
build + validator to confirm `state-reproducibility-*` goes green.
