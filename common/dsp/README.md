# apc::dsp - golden DSP building blocks

Header-only, std-only C++17, **no JUCE dependency**, namespace `apc::dsp`. One header per
component; `apc_dsp.h` includes everything. Every file starts with a comment stating its
real-time guarantees. Use these instead of re-deriving the same filters, smoothers and
FIFOs in every plugin.

| Header | What it is | Typical use |
|---|---|---|
| `ParamSmoother.h` | Linear or exponential (one-pole) smoother, `next()`, `process()`, `skip(n)`, `reset()`; ramp time in seconds, sample-rate aware | Gain, mix, cutoff - anything automatable |
| `DenormalGuard.h` | RAII FTZ/DAZ (x86 SSE, ARM64 FPCR; no-op elsewhere), `flushDenormal(x)`, `isDenormal(x)` | First line of `processBlock` |
| `LockFreeFifo.h` | SPSC ring, power-of-two capacity, trivially-copyable `T`, `tryPush` / `tryPop` | Audio -> UI meters, UI -> audio commands |
| `Biquad.h` | RBJ cookbook LP/HP/BP/notch/allpass/peak/low-shelf/high-shelf, TDF-II, double coefficients, `magnitudeDb()`, `isStable()` | EQ bands, tone controls, DC blockers |
| `Svf.h` | Trapezoidal (TPT) state-variable filter, LP/BP/HP/notch/peak/allpass in one `tick()` | Modulated filters, synth filters, resonance |
| `SoftClipper.h` | Tanh or cubic shaper, optional first-order ADAA, `tanhApprox()` | Saturation, output safety clip |
| `DryWet.h` | Equal-power or linear mix law with a smoothed mix parameter, mono/stereo block | Mix knob on any effect |
| `Oversampler2x.h` | Linear-phase 63-tap half-band polyphase 2x up/down, `OversamplerCascade` for 4x/8x, reports latency | Wrap non-linear stages to reduce aliasing |

## Quick start

```cmake
# plugin CMakeLists.txt  (APC_ROOT = path to the audio-plugin-coder checkout)
add_subdirectory(${APC_ROOT}/common/dsp ${CMAKE_BINARY_DIR}/apc_dsp)
target_link_libraries(MyPlugin PRIVATE APC::dsp)
```

```cpp
#include <apc_dsp.h>

struct Voice {
    apc::dsp::ParamSmoother gain;
    apc::dsp::Svf           filter;
    apc::dsp::SoftClipper   clip { apc::dsp::SoftClipper::Shape::Tanh, /*adaa*/ true };

    void prepare(double fs) {                 // allocation / setup is fine here
        gain.prepare(fs, 0.02);               // 20 ms linear ramp
        gain.reset(1.0f);
        filter.setParams(fs, 1000.0, 0.7071);
    }
    void process(float* x, int n) {           // audio thread
        apc::dsp::DenormalGuard guard;        // FTZ/DAZ for this callback
        for (int i = 0; i < n; ++i)
            x[i] = clip.process(filter.processLowPass(x[i]) * gain.next());
    }
};
```

Oversampling around a non-linearity (one instance per channel):

```cpp
apc::dsp::Oversampler2x os;                  // prepare(): os.prepare(maxBlockSize);
setLatencySamples(os.latencySamples());      // 31 samples at the base rate
const float* up = os.upsample(in, n);        // 2n samples in an internal buffer
float* w = os.buffer();                      // process w[0 .. 2n) in place, e.g. clip
for (int i = 0; i < 2 * n; ++i) w[i] = clip.process(w[i]);
os.downsample(up, out, n);
```

## Real-time rules

| Rule | Why | In this library |
|---|---|---|
| No heap allocation in the audio callback (`new`, `malloc`, `std::vector` growth, `std::string`) | Allocator can take a lock or page-fault | Allocation only in `prepare()` (`LockFreeFifo::prepare`, `Oversampler2x::prepare`, `OversamplerCascade::prepare`) |
| No locks (`std::mutex`, `CriticalSection`, `ScopedLock`) | Priority inversion -> dropouts | Only atomics; `LockFreeFifo` is wait-free |
| No file, network, logging or message-thread calls | Unbounded latency | None used |
| Denormals must not reach the DSP loop | 10-100x slower on x86 | `DenormalGuard` at the top of `processBlock`; filters also flush their own state |
| Parameters are smoothed | Zipper noise and clicks | `ParamSmoother`, `DryWet` |
| Share data between threads via atomics or a FIFO | Race-free without locks | `LockFreeFifo` (exactly 1 producer + 1 consumer) |
| Report latency | Host delay compensation | `Oversampler2x::latencySamples()` -> `setLatencySamples()` |

`scripts/validators/rt.js` (`apc validate rt --plugin <Name>`) statically scans a plugin's
`processBlock` for violations of the table above.

## Verified characteristics (from `tests/apc_dsp_tests.cpp`)

* Oversampler: passband ripple 0.0004 dB up to 0.4 x fs (base rate), alias/image rejection
  better than 90 dB, impulse latency equals `latencySamples()` (31 at 2x; 4x/8x cascades report
  a rounded-up value, exact in `latencySamplesExact()`).
* Smoother: linear reaches target exactly at the ramp time and is monotonic; exponential is
  within 0.1 % at the ramp time.
* Biquad LP: -3.01 dB at fc, 0 dB at DC. Svf: stable under per-sample random cutoff/Q over 1e6 samples.
* `LockFreeFifo`: 3 million messages across two threads with no loss, reordering or tearing.
* `DenormalGuard`: a decaying feedback loop produces denormals unguarded and none guarded (x86).
  The ARM64 path is written but was not compiled by the APC test-suite.

## Building the tests

`npm test` compiles and runs them automatically (skips when no compiler is installed). Manually:

```
cl /std:c++17 /EHsc /O2 /I common/dsp common/dsp/tests/apc_dsp_tests.cpp        # MSVC
c++ -std=c++17 -O2 -pthread -I common/dsp common/dsp/tests/apc_dsp_tests.cpp    # clang/gcc
```

Or configure with `-DAPC_DSP_BUILD_TESTS=ON`.
