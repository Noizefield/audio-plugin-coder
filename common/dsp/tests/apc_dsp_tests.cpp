// apc::dsp test-suite. Plain C++17, std only, no framework.
// Build: any C++17 compiler, include path = common/dsp. Link -pthread on POSIX.
// Exit code 0 = all passed. Driven by test/dsp.test.js, or by CMake (APC_DSP_BUILD_TESTS).
#include "../apc_dsp.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <complex>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <random>
#include <thread>
#include <vector>

using namespace apc::dsp;

static int g_failures = 0;
static int g_checks = 0;

#define CHECK(cond)                                                                       \
    do {                                                                                  \
        ++g_checks;                                                                       \
        if (!(cond)) {                                                                    \
            ++g_failures;                                                                 \
            std::printf("    FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);               \
        }                                                                                 \
    } while (0)

#define CHECK_MSG(cond, ...)                                                              \
    do {                                                                                  \
        ++g_checks;                                                                       \
        if (!(cond)) {                                                                    \
            ++g_failures;                                                                 \
            std::printf("    FAIL %s:%d  %s  -> ", __FILE__, __LINE__, #cond);            \
            std::printf(__VA_ARGS__);                                                     \
            std::printf("\n");                                                            \
        }                                                                                 \
    } while (0)

static const double kPi = 3.14159265358979323846;

static void runTest(const char* name, void (*fn)()) {
    const int before = g_failures;
    fn();
    std::printf("[%s] %s\n", g_failures == before ? "PASS" : "FAIL", name);
}

// Amplitude of the sinusoid component at bin `bin` of an N-point DFT (exact-bin signals only).
static double binAmplitude(const float* x, int N, int bin) {
    std::complex<double> acc = 0.0;
    for (int n = 0; n < N; ++n) acc += static_cast<double>(x[n]) * std::polar(1.0, -2.0 * kPi * bin * n / N);
    return 2.0 * std::abs(acc) / N;
}

static double toDb(double ratio) { return 20.0 * std::log10(std::max(ratio, 1e-30)); }

// ---------------------------------------------------------------------------
static void test_smoother_linear() {
    const double fs = 48000.0;
    ParamSmoother s;
    s.prepare(fs, 0.01, ParamSmoother::Mode::Linear); // 480 samples
    CHECK(s.rampSamples() == 480);
    s.reset(0.0);
    s.setTarget(1.0);
    float prev = 0.0f;
    bool mono = true;
    for (int i = 0; i < 480; ++i) {
        const float v = s.next();
        if (v < prev) mono = false;
        prev = v;
    }
    CHECK(mono);
    CHECK_MSG(std::fabs(prev - 1.0f) < 1e-6f, "value after ramp = %g", prev);
    CHECK(!s.isSmoothing());
    // midpoint
    s.reset(0.0);
    s.setTarget(2.0);
    for (int i = 0; i < 240; ++i) s.next();
    CHECK_MSG(std::fabs(s.current() - 1.0) < 1e-6, "midpoint = %g", s.current());
    // downward and monotone
    s.reset(1.0);
    s.setTarget(-1.0);
    prev = 1.0f;
    mono = true;
    for (int i = 0; i < 480; ++i) {
        const float v = s.next();
        if (v > prev) mono = false;
        prev = v;
    }
    CHECK(mono);
    CHECK(prev == -1.0f);
    // skip(n) == n x next()
    ParamSmoother a, b;
    a.prepare(fs, 0.01);
    b.prepare(fs, 0.01);
    a.reset(0.2); b.reset(0.2);
    a.setTarget(0.9); b.setTarget(0.9);
    for (int i = 0; i < 100; ++i) a.next();
    b.skip(100);
    CHECK_MSG(std::fabs(a.current() - b.current()) < 1e-9, "skip mismatch %g vs %g", a.current(), b.current());
    b.skip(100000);
    CHECK(b.current() == 0.9);
    // zero ramp time = immediate
    ParamSmoother z;
    z.prepare(fs, 0.0);
    z.reset(0.0);
    z.setTarget(0.5);
    CHECK(z.next() == 0.5f);
    // retarget mid-ramp starts from the current value (no jump)
    ParamSmoother r;
    r.prepare(fs, 0.01);
    r.reset(0.0);
    r.setTarget(1.0);
    for (int i = 0; i < 100; ++i) r.next();
    const double before = r.current();
    r.setTarget(0.0);
    const double after = r.next();
    CHECK_MSG(std::fabs(after - before) < 1.0 / 480.0 + 1e-9, "jump on retarget: %g -> %g", before, after);
}

static void test_smoother_exponential() {
    const double fs = 48000.0;
    ParamSmoother s;
    s.prepare(fs, 0.01, ParamSmoother::Mode::Exponential);
    s.reset(0.0);
    s.setTarget(1.0);
    float prev = 0.0f;
    bool mono = true;
    for (int i = 0; i < 480; ++i) {
        const float v = s.next();
        if (v < prev) mono = false;
        if (v > 1.0f) mono = false; // never overshoots
        prev = v;
    }
    CHECK(mono);
    CHECK_MSG(1.0 - prev < 0.0011 && 1.0 - prev > 0.0, "error after ramp time = %g (want ~1e-3)", 1.0 - prev);
    for (int i = 0; i < 48000; ++i) s.next();
    CHECK(s.next() == 1.0f);
    CHECK(!s.isSmoothing());
    // skip(n) matches n x next()
    ParamSmoother a, b;
    a.prepare(fs, 0.02, ParamSmoother::Mode::Exponential);
    b.prepare(fs, 0.02, ParamSmoother::Mode::Exponential);
    a.reset(-1.0); b.reset(-1.0);
    a.setTarget(3.0); b.setTarget(3.0);
    for (int i = 0; i < 777; ++i) a.next();
    b.skip(777);
    CHECK_MSG(std::fabs(a.current() - b.current()) < 1e-9, "exp skip mismatch %g vs %g", a.current(), b.current());
    // sample-rate aware: same wall-clock ramp time at a different rate
    ParamSmoother hi;
    hi.prepare(96000.0, 0.01, ParamSmoother::Mode::Exponential);
    hi.reset(0.0);
    hi.setTarget(1.0);
    for (int i = 0; i < 960; ++i) hi.next();
    CHECK_MSG(std::fabs((1.0 - hi.current()) - (1.0 - prev)) < 2e-4, "rate dependence: %g vs %g", 1.0 - hi.current(),
              1.0 - prev);
}

// ---------------------------------------------------------------------------
static double measureSineGain(Biquad& f, double fs, double freq) {
    // steady-state gain of a sine through the filter
    const int total = static_cast<int>(fs);
    double peak = 0.0;
    for (int n = 0; n < total; ++n) {
        const double y = f.processD(std::sin(2.0 * kPi * freq * n / fs));
        if (n > total / 2) peak = std::max(peak, std::fabs(y));
    }
    return peak;
}

static void test_biquad_response() {
    const double fs = 48000.0, fc = 1000.0;
    const auto lp = BiquadCoeffs::make(BiquadType::LowPass, fs, fc, 0.70710678118654752);
    CHECK(lp.isStable());
    const double atFc = lp.magnitudeDb(fc, fs);
    const double atDc = lp.magnitudeDb(0.01, fs);
    CHECK_MSG(std::fabs(atFc + 3.0103) < 0.05, "LP at fc = %g dB", atFc);
    CHECK_MSG(std::fabs(atDc) < 0.001, "LP at DC = %g dB", atDc);
    CHECK(lp.magnitudeDb(10000.0, fs) < -35.0); // 2nd order: ~ -40 dB/decade past fc
    // time domain agrees with the analytic response
    Biquad f;
    f.setCoeffs(lp);
    const double g = measureSineGain(f, fs, fc);
    CHECK_MSG(std::fabs(g - 0.70710678) < 0.01, "LP time-domain gain at fc = %g", g);
    f.reset();
    float y = 0;
    for (int i = 0; i < 20000; ++i) y = f.process(1.0f);
    CHECK_MSG(std::fabs(y - 1.0f) < 1e-5f, "LP DC gain = %g", y);

    const auto hp = BiquadCoeffs::make(BiquadType::HighPass, fs, fc);
    CHECK_MSG(std::fabs(hp.magnitudeDb(fc, fs) + 3.0103) < 0.05, "HP at fc");
    CHECK(hp.magnitudeDb(0.01, fs) < -100.0);
    CHECK_MSG(std::fabs(hp.magnitudeDb(20000.0, fs)) < 0.1, "HP passband");

    const auto bp = BiquadCoeffs::make(BiquadType::BandPass, fs, fc, 2.0);
    CHECK_MSG(std::fabs(bp.magnitudeDb(fc, fs)) < 0.001, "BP peak is 0 dB");

    const auto nt = BiquadCoeffs::make(BiquadType::Notch, fs, fc, 2.0);
    CHECK(nt.magnitudeDb(fc, fs) < -100.0);
    CHECK(std::fabs(nt.magnitudeDb(100.0, fs)) < 0.5);

    const auto ap = BiquadCoeffs::make(BiquadType::AllPass, fs, fc, 1.0);
    for (double fr : {50.0, 500.0, 1000.0, 5000.0, 15000.0}) CHECK(std::fabs(ap.magnitudeDb(fr, fs)) < 1e-6);

    const auto pk = BiquadCoeffs::make(BiquadType::Peak, fs, fc, 1.0, 9.0);
    CHECK_MSG(std::fabs(pk.magnitudeDb(fc, fs) - 9.0) < 0.001, "peak gain %g", pk.magnitudeDb(fc, fs));
    CHECK(std::fabs(pk.magnitudeDb(30.0, fs)) < 0.2);

    const auto ls = BiquadCoeffs::make(BiquadType::LowShelf, fs, fc, 0.70710678, 6.0);
    CHECK_MSG(std::fabs(ls.magnitudeDb(0.01, fs) - 6.0) < 0.001, "low shelf DC %g", ls.magnitudeDb(0.01, fs));
    CHECK_MSG(std::fabs(ls.magnitudeDb(fc, fs) - 3.0) < 0.05, "low shelf mid-gain %g", ls.magnitudeDb(fc, fs));
    CHECK(std::fabs(ls.magnitudeDb(20000.0, fs)) < 0.1);
    const auto hs = BiquadCoeffs::make(BiquadType::HighShelf, fs, fc, 0.70710678, -6.0);
    CHECK_MSG(std::fabs(hs.magnitudeDb(23000.0, fs) + 6.0) < 0.1, "high shelf top %g", hs.magnitudeDb(23000.0, fs));
    CHECK(std::fabs(hs.magnitudeDb(0.01, fs)) < 0.001);
}

static void test_biquad_stability() {
    const double fs = 48000.0;
    // Extreme designs stay stable (inputs are clamped).
    const BiquadType types[] = {BiquadType::LowPass,  BiquadType::HighPass, BiquadType::BandPass, BiquadType::Notch,
                                BiquadType::AllPass,  BiquadType::Peak,     BiquadType::LowShelf, BiquadType::HighShelf};
    for (BiquadType t : types)
        for (double f : {0.0, 1.0, 20.0, 1000.0, 20000.0, 24000.0, 1e9})
            for (double q : {0.0, 0.05, 0.7, 10.0, 100.0})
                CHECK(BiquadCoeffs::make(t, fs, f, q, 12.0).isStable());

    // 1e6 samples of noise through a filter whose cutoff sweeps per sample
    // (log sweep 20 Hz..20 kHz at 0.5 Hz, Q up to 8, +/-12 dB gain).
    std::mt19937 rng(1234);
    std::uniform_real_distribution<float> noise(-1.0f, 1.0f);
    for (BiquadType t : types) {
        Biquad f;
        double worst = 0.0;
        bool finite = true;
        for (int n = 0; n < 1000000 / 8; ++n) {
            const double lfo = 0.5 + 0.5 * std::sin(2.0 * kPi * 0.5 * n / fs);
            const double fc = 20.0 * std::pow(1000.0, lfo);
            f.set(t, fs, fc, 0.5 + 7.5 * lfo, 12.0 * std::sin(2.0 * kPi * 0.7 * n / fs));
            const double y = f.processD(noise(rng));
            if (!std::isfinite(y)) finite = false;
            worst = std::max(worst, std::fabs(y));
        }
        CHECK(finite);
        CHECK_MSG(worst < 1000.0, "type %d output peak %g", static_cast<int>(t), worst);
    }
    // Decaying ring-out ends at exactly 0 (no denormal tail) even without the FTZ flag.
    Biquad d;
    d.set(BiquadType::LowPass, fs, 500.0, 0.7);
    d.process(1.0f);
    bool anyDenormal = false;
    float y = 1.0f;
    for (int i = 0; i < 200000; ++i) {
        y = d.process(0.0f);
        if (isDenormal(y)) anyDenormal = true;
    }
    CHECK(!anyDenormal);
    CHECK(y == 0.0f);
}

// ---------------------------------------------------------------------------
static void test_svf() {
    const double fs = 48000.0;
    Svf s;
    s.setParams(fs, 1000.0, 0.70710678);
    // LP gain at fc is -3 dB
    double peak = 0.0;
    for (int n = 0; n < 48000; ++n) {
        const double y = s.tick(std::sin(2.0 * kPi * 1000.0 * n / fs)).lp;
        if (n > 24000) peak = std::max(peak, std::fabs(y));
    }
    CHECK_MSG(std::fabs(peak - 0.70710678) < 0.01, "SVF LP gain at fc = %g", peak);
    // Structural identity of the SVF: lp + (k * bp) + hp == input, for any Q
    s.reset();
    s.setParams(fs, 2000.0, 3.0);
    double maxErr = 0.0;
    for (int n = 0; n < 5000; ++n) {
        const double x = std::sin(0.01 * n) + 0.3 * std::sin(1.7 * n);
        const auto o = s.tick(x);
        maxErr = std::max(maxErr, std::fabs(o.lp + o.bpUnity + o.hp - x));
    }
    CHECK_MSG(maxErr < 1e-9, "lp + bp(k) + hp identity error %g", maxErr);
    // BP unity gain at fc
    s.reset();
    s.setParams(fs, 3000.0, 4.0);
    peak = 0.0;
    for (int n = 0; n < 48000; ++n) {
        const double y = s.tick(std::sin(2.0 * kPi * 3000.0 * n / fs)).bpUnity;
        if (n > 24000) peak = std::max(peak, std::fabs(y));
    }
    CHECK_MSG(std::fabs(peak - 1.0) < 0.01, "SVF BP gain at fc = %g", peak);

    // Static grid at extreme cutoff / Q
    std::mt19937 rng(99);
    std::uniform_real_distribution<double> noise(-1.0, 1.0);
    bool finite = true;
    double worst = 0.0;
    for (double fc : {0.0, 1.0, 20.0, 1000.0, 20000.0, 23999.0, 1e7})
        for (double q : {0.0, 0.05, 0.5, 0.7071, 5.0, 100.0, 2000.0, 1e9}) {
            Svf g;
            g.setParams(fs, fc, q);
            for (int n = 0; n < 20000; ++n) {
                const auto o = g.tick(noise(rng));
                const double all[] = {o.lp, o.bp, o.bpUnity, o.hp, o.notch, o.peak, o.allpass};
                for (double v : all) {
                    if (!std::isfinite(v)) finite = false;
                    worst = std::max(worst, std::fabs(v));
                }
            }
        }
    CHECK(finite);
    CHECK_MSG(worst < 1e6, "static grid peak %g", worst);

    // 1e6 samples, cutoff and Q re-randomised every sample (worst-case modulation)
    Svf m;
    std::uniform_real_distribution<double> u(0.0, 1.0);
    finite = true;
    worst = 0.0;
    for (int n = 0; n < 1000000; ++n) {
        const double fc = std::pow(10.0, u(rng) * 4.4);        // 1 Hz .. 25 kHz
        const double q = 0.05 * std::pow(10.0, u(rng) * 4.6);   // 0.05 .. 2000
        m.setParams(fs, fc, q);
        const auto o = m.tick(noise(rng));
        const double all[] = {o.lp, o.bp, o.bpUnity, o.hp, o.notch, o.peak, o.allpass};
        for (double v : all) {
            if (!std::isfinite(v)) finite = false;
            worst = std::max(worst, std::fabs(v));
        }
    }
    CHECK_MSG(finite, "NaN/inf during random modulation");
    CHECK_MSG(worst < 1e9, "random modulation peak %g", worst);
}

// ---------------------------------------------------------------------------
struct Msg {
    std::uint64_t seq;
    std::uint64_t check;
};

static void test_fifo() {
    LockFreeFifo<Msg> fifo(1000);
    CHECK(fifo.capacity() == 1024);
    Msg m{};
    CHECK(!fifo.tryPop(m));
    CHECK(fifo.tryPush({1, ~std::uint64_t(1)}));
    CHECK(fifo.tryPop(m) && m.seq == 1 && m.check == ~std::uint64_t(1));

    // full / empty behaviour
    LockFreeFifo<int> small(4);
    int pushed = 0;
    while (small.tryPush(pushed)) ++pushed;
    CHECK(pushed == 4);
    int v = -1;
    for (int i = 0; i < 4; ++i) CHECK(small.tryPop(v) && v == i);
    CHECK(!small.tryPop(v));

    // two-thread stress: no loss, no reorder, no torn values
    const std::uint64_t kCount = 3000000;
    LockFreeFifo<Msg> q(256);
    std::atomic<bool> ok{true};
    std::thread producer([&] {
        for (std::uint64_t i = 0; i < kCount;) {
            if (q.tryPush({i, ~i}))
                ++i;
            else
                std::this_thread::yield();
        }
    });
    std::thread consumer([&] {
        std::uint64_t expect = 0;
        while (expect < kCount) {
            Msg x;
            if (q.tryPop(x)) {
                if (x.seq != expect || x.check != ~expect) {
                    ok = false;
                    break;
                }
                ++expect;
            } else {
                std::this_thread::yield();
            }
        }
    });
    producer.join();
    consumer.join();
    CHECK(ok.load());
    CHECK(q.emptyApprox());
}

// ---------------------------------------------------------------------------
static void test_soft_clipper() {
    for (auto shape : {SoftClipper::Shape::Tanh, SoftClipper::Shape::Cubic})
        for (bool adaa : {false, true}) {
            SoftClipper c(shape, adaa);
            std::mt19937 rng(7);
            std::uniform_real_distribution<double> u(-1.0, 1.0);
            double maxAbs = 0.0;
            bool finite = true;
            for (int n = 0; n < 200000; ++n) {
                const double x = u(rng) * std::pow(10.0, u(rng) * 3.0); // up to +-1000
                const double y = c.process(x);
                if (!std::isfinite(y)) finite = false;
                maxAbs = std::max(maxAbs, std::fabs(y));
            }
            CHECK(finite);
            CHECK_MSG(maxAbs <= 1.0 + 1e-12, "shape %d adaa %d max |y| = %.12f", static_cast<int>(shape), adaa, maxAbs);
        }
    // closed-form shapes
    SoftClipper t(SoftClipper::Shape::Tanh, false), cu(SoftClipper::Shape::Cubic, false);
    CHECK(std::fabs(t.process(0.5) - std::tanh(0.5)) < 1e-12);
    CHECK(cu.process(0.0) == 0.0);
    CHECK(std::fabs(cu.process(1.0) - 1.0) < 1e-12 && cu.process(5.0) == 1.0 && cu.process(-5.0) == -1.0);
    // small-signal gain is 1 (tanh) / 1.5 (cubic)
    CHECK(std::fabs(t.process(1e-4) / 1e-4 - 1.0) < 1e-6);
    CHECK(std::fabs(cu.process(1e-4) / 1e-4 - 1.5) < 1e-6);
    // tanhApprox bounded and close
    float worstErr = 0.0f;
    for (float x = -10.0f; x <= 10.0f; x += 0.01f) {
        const float y = SoftClipper::tanhApprox(x);
        CHECK(std::fabs(y) <= 1.0f);
        worstErr = std::max(worstErr, std::fabs(y - std::tanh(x)));
    }
    CHECK_MSG(worstErr < 0.03f, "tanhApprox worst error %g", worstErr);
    // ADAA: a constant input converges to the plain shaper value
    for (auto shape : {SoftClipper::Shape::Tanh, SoftClipper::Shape::Cubic}) {
        SoftClipper a(shape, true), p(shape, false);
        double ya = 0;
        for (int i = 0; i < 10; ++i) ya = a.process(0.7);
        CHECK(std::fabs(ya - p.process(0.7)) < 1e-9);
    }
    // ADAA is continuous across the |x|=1 knee of the cubic (antiderivative continuity)
    SoftClipper k(SoftClipper::Shape::Cubic, true);
    k.process(0.999);
    const double y1 = k.process(1.001);
    CHECK(std::fabs(y1 - 1.0) < 1e-2);
}

// ---------------------------------------------------------------------------
static void test_dry_wet() {
    const double fs = 48000.0;
    for (auto law : {DryWet::Law::EqualPower, DryWet::Law::Linear}) {
        for (float m : {0.0f, 0.25f, 0.5f, 0.75f, 1.0f}) {
            float d, w;
            DryWet::gains(law, m, d, w);
            if (law == DryWet::Law::EqualPower)
                CHECK_MSG(std::fabs(d * d + w * w - 1.0f) < 1e-6f, "power %g", d * d + w * w);
            else
                CHECK(std::fabs(d + w - 1.0f) < 1e-6f);
        }
        float d, w;
        DryWet::gains(law, 0.0f, d, w);
        CHECK(d == 1.0f && w == 0.0f);
        DryWet::gains(law, 1.0f, d, w);
        CHECK(std::fabs(d) < 1e-6f && w == 1.0f);
    }
    float d, w;
    DryWet::gains(DryWet::Law::EqualPower, 0.5f, d, w);
    CHECK(std::fabs(d - 0.70710678f) < 1e-5f && std::fabs(w - 0.70710678f) < 1e-5f);

    DryWet dw;
    dw.prepare(fs, 0.01);
    dw.resetMix(0.0f);
    CHECK(dw.mix(0.3f, 0.9f) == 0.3f);
    dw.setMix(1.0f);
    float prevW = -1.0f, maxStep = 0.0f;
    float out = 0.0f;
    for (int i = 0; i < 480; ++i) {
        out = dw.mix(0.0f, 1.0f); // pure wet signal -> output is the wet gain
        CHECK(out >= prevW);
        if (prevW >= 0.0f) maxStep = std::max(maxStep, out - prevW);
        prevW = out;
    }
    CHECK_MSG(std::fabs(out - 1.0f) < 1e-5f, "end of ramp wet gain %g", out);
    CHECK_MSG(maxStep < 0.01f, "mix ramp step too large (%g) - clicks", maxStep);
    // block form, in place
    std::vector<float> dry(64, 1.0f), wet(64, 2.0f);
    dw.processBlock(dry.data(), wet.data(), dry.data(), 64);
    CHECK(std::fabs(dry[63] - 2.0f) < 1e-5f);
}

// ---------------------------------------------------------------------------
static void test_oversampler() {
    const int N = 4096;
    const int lat = Oversampler2x{}.latencySamples();
    CHECK(lat == 31);

    // -- passband flatness of up->down chain, and image rejection of the up stage --
    double worstRippleDb = 0.0, worstImageDb = -300.0;
    int tested = 0;
    for (int k = 8; k <= static_cast<int>(0.4 * N); k += 41) {
        Oversampler2x os;
        os.prepare(N);
        std::vector<float> in(N + 512), mid2x, out(N + 512);
        // run 2 consecutive blocks: first settles filter state, second is measured
        const int total = N + 512;
        for (int i = 0; i < total; ++i) in[i] = static_cast<float>(std::sin(2.0 * kPi * k * i / N));
        // process in chunks of 512 to also exercise the block API
        std::vector<float> up2x(2 * total);
        for (int off = 0; off < total; off += 512) {
            const float* u = os.upsample(in.data() + off, 512);
            std::copy(u, u + 1024, up2x.begin() + 2 * off);
            os.downsample(u, out.data() + off, 512);
        }
        // exact-bin measurement over N samples starting at a multiple of the period offset
        const int start = 512; // k*512/N is not an integer in general -> use phase-free DFT magnitude
        const double amp = binAmplitude(out.data() + start, N, k);
        const double rip = std::fabs(toDb(amp));
        worstRippleDb = std::max(worstRippleDb, rip);
        // image of the 2x stream: fundamental at bin k, image at bin N-k of a 2N-point DFT
        const double fund = binAmplitude(up2x.data() + 2 * start, 2 * N, k);
        const double img = binAmplitude(up2x.data() + 2 * start, 2 * N, N - k);
        CHECK_MSG(std::fabs(toDb(fund)) < 0.1, "up fundamental gain k=%d: %g dB", k, toDb(fund));
        worstImageDb = std::max(worstImageDb, toDb(img));
        ++tested;
    }
    std::printf("    oversampler: %d freqs to 0.4*fs, worst chain ripple = %.5f dB, worst image = %.1f dB\n", tested,
                worstRippleDb, worstImageDb);
    CHECK(tested > 20);
    CHECK_MSG(worstRippleDb < 0.1, "passband ripple %g dB", worstRippleDb);
    CHECK_MSG(worstImageDb <= -60.0, "image rejection %g dB", worstImageDb);

    // -- stopband attenuation of the down stage (aliasing rejection) --
    double worstAlias = -300.0;
    for (int k = static_cast<int>(0.6 * N) + 3; k < N - 1; k += 37) {
        Oversampler2x os;
        os.prepare(N);
        const int total = N + 512;
        std::vector<float> x2(2 * total), out(total);
        // sine at k/(2N) cycles per 2x-sample == 'k/N of the base rate' (>0.6*fs: stopband)
        for (int i = 0; i < 2 * total; ++i) x2[i] = static_cast<float>(std::sin(2.0 * kPi * k * i / (2.0 * N)));
        for (int off = 0; off < total; off += 512) os.downsample(x2.data() + 2 * off, out.data() + off, 512);
        const int aliasBin = (2 * k) % N == 0 ? 0 : std::min((2 * k) % N, N - (2 * k) % N);
        // measure total RMS of the settled output instead of one bin: any leakage counts
        double e = 0.0;
        for (int i = 512; i < total; ++i) e += static_cast<double>(out[i]) * out[i];
        const double rms = std::sqrt(e / (total - 512));
        const double atten = toDb(rms / 0.70710678);
        (void)aliasBin;
        worstAlias = std::max(worstAlias, atten);
    }
    std::printf("    oversampler: worst stopband (alias) level = %.1f dB\n", worstAlias);
    CHECK_MSG(worstAlias <= -60.0, "stopband attenuation only %g dB", -worstAlias);

    // -- impulse latency --
    {
        Oversampler2x os;
        os.prepare(256);
        std::vector<float> in(256, 0.0f), out(256, 0.0f);
        in[0] = 1.0f;
        const float* u = os.upsample(in.data(), 128);
        os.downsample(u, out.data(), 128);
        int peak = 0;
        for (int i = 0; i < 128; ++i)
            if (std::fabs(out[i]) > std::fabs(out[peak])) peak = i;
        CHECK_MSG(peak == os.latencySamples(), "impulse peak at %d, reported latency %d", peak, os.latencySamples());
        // peak of (h_up * h_down) is below 1: the transition band carries impulse energy (the
        // passband gain itself is flat, see above); it must be positive and close to 1.
        CHECK_MSG(out[peak] > 0.9f && out[peak] < 1.01f, "impulse peak amplitude %g", out[peak]);
    }
    // -- cascades --
    for (int stages = 1; stages <= 3; ++stages) {
        OversamplerCascade c;
        c.prepare(stages, 256);
        CHECK(c.factor() == (1 << stages));
        std::vector<float> in(256, 0.0f), out(256, 0.0f);
        in[0] = 1.0f;
        float* u = c.upsample(in.data(), 128);
        c.downsample(u, out.data(), 128);
        int peak = 0;
        for (int i = 0; i < 128; ++i)
            if (std::fabs(out[i]) > std::fabs(out[peak])) peak = i;
        const double exact = c.latencySamplesExact();
        CHECK_MSG(std::fabs(peak - exact) <= 1.0, "%dx: peak at %d, exact latency %g", c.factor(), peak, exact);
        CHECK(c.latencySamples() >= static_cast<int>(exact));
        // 8x cascade passband sanity at 0.2*fs
        OversamplerCascade c2;
        c2.prepare(stages, 512);
        std::vector<float> sig(4096 + 512), res(4096 + 512);
        for (std::size_t i = 0; i < sig.size(); ++i) sig[i] = static_cast<float>(std::sin(2.0 * kPi * 0.2 * i));
        for (std::size_t off = 0; off < sig.size(); off += 512) {
            float* uu = c2.upsample(sig.data() + off, 512);
            c2.downsample(uu, res.data() + off, 512);
        }
        double e = 0.0;
        for (int i = 1024; i < 4096 + 512; ++i) e += static_cast<double>(res[i]) * res[i];
        const double g = toDb(std::sqrt(e / (4096 + 512 - 1024)) / 0.70710678);
        CHECK_MSG(std::fabs(g) < 0.1, "%dx cascade gain at 0.2fs = %g dB", c.factor(), g);
    }
}

// ---------------------------------------------------------------------------
#if defined(APC_DSP_DENORMAL_X86)
static int countDenormalsInDecay() {
    volatile float x = 1.0e-30f;
    int denormals = 0;
    for (int i = 0; i < 400; ++i) {
        x = x * 0.5f;                  // decaying feedback loop
        const float v = x;
        if (isDenormal(v)) ++denormals;
    }
    return denormals;
}
#endif

static void test_denormal_guard() {
    CHECK(flushDenormal(1.0e-40f) == 0.0f);
    CHECK(flushDenormal(1.0f) == 1.0f);
    CHECK(flushDenormal(-1.0e-310) == 0.0);
    CHECK(isDenormal(1.0e-40f) && !isDenormal(1.0e-30f) && !isDenormal(0.0f));
#if defined(APC_DSP_DENORMAL_X86)
    CHECK(DenormalGuard::kSupported);
    const int unguarded = countDenormalsInDecay();
    CHECK_MSG(unguarded > 10, "baseline decay produced only %d denormals (test would be vacuous)", unguarded);
    unsigned int csrBefore = _mm_getcsr();
    {
        DenormalGuard g;
        CHECK((_mm_getcsr() & 0x8040u) == 0x8040u);
        const int guarded = countDenormalsInDecay();
        CHECK_MSG(guarded == 0, "%d denormals with guard active", guarded);
    }
    CHECK_MSG(_mm_getcsr() == csrBefore, "MXCSR not restored");
    CHECK(countDenormalsInDecay() > 10);
    std::printf("    denormals in 400-step decay: unguarded=%d guarded=0\n", unguarded);
#else
    std::printf("    DenormalGuard: no x86 SSE here - only the software helpers were verified\n");
#endif
}

int main() {
    std::printf("apc::dsp tests\n");
    runTest("ParamSmoother linear", test_smoother_linear);
    runTest("ParamSmoother exponential", test_smoother_exponential);
    runTest("Biquad frequency response", test_biquad_response);
    runTest("Biquad stability / denormal-free", test_biquad_stability);
    runTest("Svf response + stability (1e6 samples)", test_svf);
    runTest("LockFreeFifo (two-thread stress)", test_fifo);
    runTest("SoftClipper", test_soft_clipper);
    runTest("DryWet", test_dry_wet);
    runTest("Oversampler2x / cascade", test_oversampler);
    runTest("DenormalGuard", test_denormal_guard);
    std::printf("%d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
