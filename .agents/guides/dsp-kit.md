# DSP Kit (`APC::dsp`) - agent guide

`common/dsp/` is a header-only, std-only C++17 library (namespace `apc::dsp`, no JUCE
dependency). Prefer it over hand-rolling the same primitives in every plugin. Full reference:
`common/dsp/README.md`.

## When to use which component

| Need | Use | Notes |
|---|---|---|
| Any automatable gain / mix / cutoff (avoid zipper noise) | `ParamSmoother` | `Linear` for gains, `Exponential` for frequencies. `skip(n)` for block-rate use |
| First line of every `processBlock` | `DenormalGuard` | Or `juce::ScopedNoDenormals`; the RT validator accepts either |
| Audio thread <-> UI/worker data (meters, commands) | `LockFreeFifo<T>` | Exactly one producer thread and one consumer thread; `T` trivially copyable; `prepare()` in `prepareToPlay` |
| EQ band, tone control, DC blocker, static filter | `Biquad` | Design with `BiquadCoeffs::make(...)`; `magnitudeDb()` to unit-test a design |
| Modulated filter (LFO, envelope, per-sample cutoff) | `Svf` | Zero-delay, stable at any cutoff/Q, all responses from one `tick()` |
| Saturation / output safety clip | `SoftClipper` | `adaa = true` cuts aliasing without oversampling; for heavy drive combine with `Oversampler2x` |
| Dry/wet knob | `DryWet` | Equal-power for uncorrelated wet, `Linear` for parallel-processed copies |
| Non-linear stage that aliases | `Oversampler2x` / `OversamplerCascade` | One instance per channel; report latency with `setLatencySamples()` and delay the dry path |

## Adding it to a plugin

In the plugin `CMakeLists.txt` (APC passes `APC_ROOT`, or derive it from the repo layout):

```cmake
add_subdirectory(${APC_ROOT}/common/dsp ${CMAKE_BINARY_DIR}/apc_dsp)
target_link_libraries(${PLUGIN_TARGET} PRIVATE APC::dsp)
```

```cpp
#include <apc_dsp.h>          // or a single header, e.g. <Biquad.h>
using namespace apc::dsp;
```

Allocate in `prepareToPlay()` (`LockFreeFifo::prepare`, `Oversampler2x::prepare(maxBlock)`),
never in `processBlock()`. Keep one filter / smoother / oversampler instance per channel.

Visage and WebView plugins both use the kit unchanged - it has no UI or framework dependency.

## Real-time rules (enforced by `apc validate rt --plugin <Name>`)

FAIL (allocation, locks, I/O, blocking, threads) in `processBlock` and same-file helpers it calls:

* `new` / `delete` / `malloc` / `free` / `std::make_unique` / `std::make_shared`
* `push_back` / `emplace_back` / `resize` / `reserve`
* `std::string`, `juce::String`, `std::to_string`, string concatenation with literals
* `std::mutex`, `std::lock_guard`, `std::unique_lock`, `juce::CriticalSection`, `juce::ScopedLock`
* `juce::File`, `FileInputStream`, `URL`, `Logger`, `DBG`, `printf`, `std::cout`
* `MessageManager::callSync`, `std::thread`, `std::async`, sleeps

WARN: `std::map` / `std::unordered_map` / other node containers, `dynamic_cast`, `throw`,
`AudioBuffer::setSize` (unless `avoidReallocating = true`), local sized `AudioBuffer`,
`MessageManager::callAsync`, `ScopedTryLock` / `SpinLock`.

FAIL if `processBlock` has no `juce::ScopedNoDenormals` / `apc::dsp::DenormalGuard`.
INFO if the sources mention oversampling / lookahead but never call `setLatencySamples()`.

Suppress a deliberate exception on the offending line (or the line above) - a reason is mandatory:

```cpp
scratch.reserve (n); // apc-rt-ok: first call only, pre-warmed in prepareToPlay
```

The scanner is a heuristic text scan (comments and strings stripped, same-file helpers
followed to depth 4). It cannot see through virtual calls, other translation units or macros,
so a pass is "no known-bad pattern", not a proof. Use it in the test phase next to
`apc validate` runs, and fix FAILs rather than suppressing them.

## Verifying changes to the kit

`npm test` compiles and runs `common/dsp/tests/apc_dsp_tests.cpp` (MSVC via vswhere on Windows,
`c++`/`g++`/`clang++` elsewhere; skipped with a notice when no compiler exists). Add a test for
any new component.
