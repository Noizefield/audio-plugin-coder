// apc::dsp::Svf - trapezoidal-integration (TPT) state-variable filter.
//
// Topology after Zavalishin ("The Art of VA Filter Design") in the
// state-update form popularised by Cytomic (Andrew Simper). Zero-delay feedback,
// unconditionally stable for any cutoff and any Q > 0, and well behaved under
// per-sample modulation of cutoff / Q.
//
//   tick() returns all outputs at once: lp, bp (gain Q at resonance), bpUnity
//   (constant 0 dB peak), hp, notch, peak (lp - hp) and allpass.
//
// Cutoff is clamped to [1 Hz .. 0.49*fs] and Q to [0.05 .. 2000]. Tiny states
// (< 1e-30) are flushed to zero so the integrators never go denormal.
//
// Real-time safety: no allocation, no locks. setParams() calls std::tan once;
// call it per block or when a parameter changes rather than per sample if you
// can (per sample is still allocation-free).
//
// Std-only C++17, no JUCE dependency.
#pragma once

#include <algorithm>
#include <cmath>

namespace apc::dsp {

class Svf {
public:
    struct Outputs {
        double lp = 0, bp = 0, bpUnity = 0, hp = 0, notch = 0, peak = 0, allpass = 0;
    };

    /// Set cutoff (Hz) and resonance Q (0.7071 = Butterworth).
    void setParams(double sampleRate, double cutoffHz, double q) noexcept {
        const double pi = 3.14159265358979323846;
        const double fs = sampleRate > 1.0 ? sampleRate : 1.0;
        const double fc = std::min(std::max(cutoffHz, 1.0), 0.49 * fs);
        const double qq = std::min(std::max(q, 0.05), 2000.0);
        g_ = std::tan(pi * fc / fs);
        k_ = 1.0 / qq;
        a1_ = 1.0 / (1.0 + g_ * (g_ + k_));
        a2_ = g_ * a1_;
        a3_ = g_ * a2_;
    }

    void reset() noexcept { ic1_ = ic2_ = 0.0; }

    Outputs tick(double x) noexcept {
        const double v3 = x - ic2_;
        const double v1 = a1_ * ic1_ + a2_ * v3;
        const double v2 = ic2_ + a2_ * ic1_ + a3_ * v3;
        ic1_ = flushTiny(2.0 * v1 - ic1_);
        ic2_ = flushTiny(2.0 * v2 - ic2_);
        Outputs o;
        o.lp = v2;
        o.bp = v1;
        o.bpUnity = k_ * v1;
        o.hp = x - k_ * v1 - v2;
        o.notch = x - k_ * v1;
        o.peak = o.lp - o.hp;
        o.allpass = x - 2.0 * k_ * v1;
        return o;
    }

    float processLowPass(float x) noexcept { return static_cast<float>(tick(x).lp); }
    float processHighPass(float x) noexcept { return static_cast<float>(tick(x).hp); }
    float processBandPass(float x) noexcept { return static_cast<float>(tick(x).bpUnity); }

private:
    static double flushTiny(double v) noexcept { return std::fabs(v) < 1.0e-30 ? 0.0 : v; }

    double g_ = 0.0, k_ = 1.0, a1_ = 1.0, a2_ = 0.0, a3_ = 0.0;
    double ic1_ = 0.0, ic2_ = 0.0;
};

} // namespace apc::dsp
