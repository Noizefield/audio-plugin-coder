// apc::dsp::Oversampler2x / OversamplerCascade - linear-phase half-band 2x resampling.
//
// FILTER (documented design)
//   One 63-tap linear-phase half-band FIR, designed at 2x rate:
//     h[n] = 0.5 * sinc((n - 31) / 2) * kaiser(n; beta = 8.96),  n = 0..62
//   Even taps around the centre are exactly zero and the centre tap is exactly 0.5.
//   Measured (see tests/): passband ripple < 0.01 dB up to 0.4*fs (fs = BASE rate),
//   stopband (>= 0.6*fs) attenuation > 80 dB, DC gain 0 dB.
//   Polyphase form: one 32-tap FIR branch plus a pure delay branch, so cost is about
//   32 MACs per base-rate sample per direction (symmetric taps are not folded).
//
// LATENCY
//   Up + down through one Oversampler2x delays the signal by exactly
//   latencySamples() == 31 samples at the BASE rate (impulse peak lands on sample 31).
//   Report it with setLatencySamples() and delay-compensate the dry path.
//   OversamplerCascade (4x/8x) runs the same filter at each stage; the total latency is
//   31 * (1 + 1/2 + 1/4) base samples, which is not an integer for 4x/8x:
//   latencySamplesExact() gives the exact value, latencySamples() rounds up.
//
// USAGE (one instance per channel; the filters are stateful)
//   prepare(maxBlock);                                    // allocates (prepareToPlay)
//   const float* os = up.upsample(in, n);                 // 2n samples, internal buffer
//   ... process os[0 .. 2n) in place ...                  // non-linear / aliasing-prone stuff
//   up.downsample(os, out, n);                            // back to n samples
//
// Real-time safety: prepare() allocates; upsample()/downsample()/per-sample calls do not
// allocate, lock, or call anything non-deterministic. n must be <= maxBlock.
//
// Std-only C++17, no JUCE dependency.
#pragma once

#include <cmath>
#include <cstddef>
#include <vector>

namespace apc::dsp {

namespace detail {

constexpr int kHbK = 15;                 // half-band parameter: taps = 4K+3
constexpr int kHbTaps = 4 * kHbK + 3;    // 63
constexpr int kHbBranch = 2 * kHbK + 2;  // 32 non-trivial taps (h[0], h[2], ... h[62])

inline double besselI0(double x) noexcept {
    double sum = 1.0, term = 1.0;
    const double q = 0.25 * x * x;
    for (int k = 1; k < 64; ++k) {
        term *= q / (static_cast<double>(k) * k);
        sum += term;
        if (term < 1e-18 * sum) break;
    }
    return sum;
}

/// Even-indexed taps h[2j], j = 0..31 of the half-band design above (unity DC gain).
struct HalfBandTaps {
    float h[kHbBranch];
    HalfBandTaps() noexcept {
        const double pi = 3.14159265358979323846;
        const double beta = 8.96;
        const int c = kHbTaps / 2; // 31
        const double i0b = besselI0(beta);
        for (int j = 0; j < kHbBranch; ++j) {
            const int n = 2 * j;
            const int m = n - c;                       // odd, never 0
            const double ideal = std::sin(pi * m / 2.0) / (pi * m);
            const double r = static_cast<double>(m) / c;
            const double w = besselI0(beta * std::sqrt(1.0 - r * r)) / i0b;
            h[j] = static_cast<float>(ideal * w);
        }
    }
};

/// Doubled ring buffer: win() returns the newest-first contiguous window of kHbBranch samples.
struct Ring {
    float d[2 * kHbBranch] = {};
    int p = 0;
    void push(float v) noexcept {
        p = (p == 0) ? kHbBranch - 1 : p - 1;
        d[p] = d[p + kHbBranch] = v;
    }
    const float* win() const noexcept { return d + p; }
    void clear() noexcept {
        for (float& v : d) v = 0.0f;
        p = 0;
    }
};

} // namespace detail

class Oversampler2x {
public:
    static constexpr int kLatencySamples = detail::kHbK * 2 + 1; // 31, at the base rate

    /// Allocate the internal 2x buffer for blocks of up to `maxBlock` base-rate samples.
    void prepare(int maxBlock) {
        buffer_.assign(static_cast<std::size_t>(maxBlock > 0 ? maxBlock : 1) * 2, 0.0f);
        reset();
    }

    void reset() noexcept {
        upHist_.clear();
        dnA_.clear();
        dnB_.clear();
    }

    /// Latency of upsample -> downsample, in base-rate samples.
    int latencySamples() const noexcept { return kLatencySamples; }

    /// Internal 2x buffer (size 2*maxBlock). Valid after prepare().
    float* buffer() noexcept { return buffer_.data(); }
    int maxBlock() const noexcept { return static_cast<int>(buffer_.size() / 2); }

    // ---- per-sample -------------------------------------------------------
    void upsample(float x, float& y0, float& y1) noexcept {
        upHist_.push(x);
        const float* w = upHist_.win();
        float acc = 0.0f;
        for (int j = 0; j < detail::kHbBranch; ++j) acc += w[j] * taps_.h[j];
        y0 = 2.0f * acc;                  // y[2n]   : FIR branch (gain 2 for zero-stuffing)
        y1 = w[detail::kHbK];             // y[2n+1] : centre tap = pure delay of K samples
    }

    float downsample(float a, float b) noexcept {
        dnA_.push(a);
        dnB_.push(b);
        const float* wa = dnA_.win();
        float acc = 0.0f;
        for (int j = 0; j < detail::kHbBranch; ++j) acc += wa[j] * taps_.h[j];
        return acc + 0.5f * dnB_.win()[detail::kHbK + 1];
    }

    // ---- block ------------------------------------------------------------
    /// Upsample n samples into the internal buffer and return it (2n samples).
    const float* upsample(const float* in, int n) noexcept {
        float* o = buffer_.data();
        for (int i = 0; i < n; ++i) upsample(in[i], o[2 * i], o[2 * i + 1]);
        return o;
    }

    /// Downsample 2n samples to n. `in2x` may be buffer() (in place with respect to the
    /// oversampled data); `out` must not alias `in2x`.
    void downsample(const float* in2x, float* out, int n) noexcept {
        for (int i = 0; i < n; ++i) out[i] = downsample(in2x[2 * i], in2x[2 * i + 1]);
    }

private:
    detail::HalfBandTaps taps_;
    detail::Ring upHist_, dnA_, dnB_;
    std::vector<float> buffer_;
};

/// 2x, 4x or 8x oversampling by cascading Oversampler2x stages.
class OversamplerCascade {
public:
    /// log2Factor: 1 -> 2x, 2 -> 4x, 3 -> 8x. Allocates.
    void prepare(int log2Factor, int maxBlock) {
        stages_.clear();
        if (log2Factor < 1) log2Factor = 1;
        if (log2Factor > 3) log2Factor = 3;
        stages_.resize(static_cast<std::size_t>(log2Factor));
        int blockAtStage = maxBlock > 0 ? maxBlock : 1;
        for (auto& s : stages_) {
            s.prepare(blockAtStage);
            blockAtStage *= 2;
        }
    }

    void reset() noexcept {
        for (auto& s : stages_) s.reset();
    }

    int factor() const noexcept { return 1 << static_cast<int>(stages_.size()); }

    /// Exact latency (base-rate samples) of upsample -> downsample.
    double latencySamplesExact() const noexcept {
        double total = 0.0, scale = 1.0;
        for (std::size_t i = 0; i < stages_.size(); ++i) {
            total += Oversampler2x::kLatencySamples * scale;
            scale *= 0.5;
        }
        return total;
    }

    /// Latency rounded up to a whole number of base-rate samples (for setLatencySamples).
    int latencySamples() const noexcept { return static_cast<int>(std::ceil(latencySamplesExact() - 1e-9)); }

    /// Returns factor()*n oversampled samples (internal buffer, valid until next call).
    float* upsample(const float* in, int n) noexcept {
        const float* src = in;
        int count = n;
        float* dst = nullptr;
        for (auto& s : stages_) {
            s.upsample(src, count);
            dst = s.buffer();
            src = dst;
            count *= 2;
        }
        return dst;
    }

    /// `osData` must be the pointer returned by upsample() (or any factor()*n buffer that
    /// does not alias `out` or the intermediate stage buffers except the last stage's).
    void downsample(const float* osData, float* out, int n) noexcept {
        const float* src = osData;
        int count = n * factor();
        for (std::size_t i = stages_.size(); i-- > 0;) {
            count /= 2;
            float* dst = (i == 0) ? out : stages_[i - 1].buffer();
            stages_[i].downsample(src, dst, count);
            src = dst;
        }
    }

private:
    std::vector<Oversampler2x> stages_;
};

} // namespace apc::dsp
