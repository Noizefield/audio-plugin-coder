// apc::dsp::Biquad - RBJ "Audio EQ Cookbook" biquad, transposed direct form II.
//
//   * Types: LowPass, HighPass, BandPass (0 dB peak), Notch, AllPass, Peak, LowShelf, HighShelf.
//   * Coefficients are computed and stored in double precision (BiquadCoeffs).
//   * State is double precision; tiny state values (< 1e-30, i.e. below -600 dB) are
//     flushed to zero so the recursion never wanders into denormals even where the
//     CPU flush mode is not available.
//   * Transposed direct form II keeps its state in the same units as the output, so
//     changing coefficients per sample (modulation / automation) cannot create the
//     large transients that direct form I can.
//   * Design inputs are clamped (frequency to [1e-4*fs/2 .. 0.499*fs], Q >= 0.025), so
//     any argument gives a stable filter; BiquadCoeffs::isStable() lets you check.
//
// Real-time safety: nothing here allocates or locks. Designing coefficients uses
// std::sin/cos/pow, which is fine on the audio thread (no heap, no locks), but is
// cheaper if done once per block rather than per sample.
//
// Std-only C++17, no JUCE dependency.
#pragma once

#include <algorithm>
#include <cmath>

namespace apc::dsp {

enum class BiquadType { LowPass, HighPass, BandPass, Notch, AllPass, Peak, LowShelf, HighShelf };

struct BiquadCoeffs {
    // y = b0*x + s1 ; s1 = b1*x - a1*y + s2 ; s2 = b2*x - a2*y   (a0 normalised to 1)
    double b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0;

    /// Design a filter. `gainDb` is used by Peak / LowShelf / HighShelf only.
    /// For shelves, Q = 0.7071 gives a shelf slope of 1.
    static BiquadCoeffs make(BiquadType type, double sampleRate, double freqHz, double q = 0.70710678118654752,
                             double gainDb = 0.0) noexcept {
        const double pi = 3.14159265358979323846;
        const double fs = sampleRate > 1.0 ? sampleRate : 1.0;
        const double f = std::min(std::max(freqHz, 1.0e-4 * 0.5 * fs), 0.499 * fs);
        const double qq = std::max(q, 0.025);
        const double w0 = 2.0 * pi * f / fs;
        const double cw = std::cos(w0), sw = std::sin(w0);
        const double alpha = sw / (2.0 * qq);
        double b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
        switch (type) {
            case BiquadType::LowPass:
                b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0;
                a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
                break;
            case BiquadType::HighPass:
                b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0;
                a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
                break;
            case BiquadType::BandPass:
                b0 = alpha; b1 = 0; b2 = -alpha;
                a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
                break;
            case BiquadType::Notch:
                b0 = 1; b1 = -2 * cw; b2 = 1;
                a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
                break;
            case BiquadType::AllPass:
                b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha;
                a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
                break;
            case BiquadType::Peak: {
                const double A = std::pow(10.0, gainDb / 40.0);
                b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
                a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
                break;
            }
            case BiquadType::LowShelf: {
                const double A = std::pow(10.0, gainDb / 40.0);
                const double beta = 2.0 * std::sqrt(A) * alpha;
                b0 = A * ((A + 1) - (A - 1) * cw + beta);
                b1 = 2 * A * ((A - 1) - (A + 1) * cw);
                b2 = A * ((A + 1) - (A - 1) * cw - beta);
                a0 = (A + 1) + (A - 1) * cw + beta;
                a1 = -2 * ((A - 1) + (A + 1) * cw);
                a2 = (A + 1) + (A - 1) * cw - beta;
                break;
            }
            case BiquadType::HighShelf: {
                const double A = std::pow(10.0, gainDb / 40.0);
                const double beta = 2.0 * std::sqrt(A) * alpha;
                b0 = A * ((A + 1) + (A - 1) * cw + beta);
                b1 = -2 * A * ((A - 1) + (A + 1) * cw);
                b2 = A * ((A + 1) + (A - 1) * cw - beta);
                a0 = (A + 1) - (A - 1) * cw + beta;
                a1 = 2 * ((A - 1) - (A + 1) * cw);
                a2 = (A + 1) - (A - 1) * cw - beta;
                break;
            }
        }
        BiquadCoeffs c;
        const double inv = 1.0 / a0;
        c.b0 = b0 * inv; c.b1 = b1 * inv; c.b2 = b2 * inv;
        c.a1 = a1 * inv; c.a2 = a2 * inv;
        return c;
    }

    /// Magnitude response |H(e^jw)| in dB at `freqHz`.
    double magnitudeDb(double freqHz, double sampleRate) const noexcept {
        const double w = 2.0 * 3.14159265358979323846 * freqHz / sampleRate;
        const double c1 = std::cos(w), s1 = std::sin(w), c2 = std::cos(2 * w), s2 = std::sin(2 * w);
        const double nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
        const double dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
        const double num = nr * nr + ni * ni, den = dr * dr + di * di;
        return 10.0 * std::log10(std::max(num, 1e-300) / std::max(den, 1e-300));
    }

    /// True if both poles are strictly inside the unit circle.
    bool isStable() const noexcept { return std::fabs(a2) < 1.0 && std::fabs(a1) < 1.0 + a2; }
};

class Biquad {
public:
    void setCoeffs(const BiquadCoeffs& c) noexcept { c_ = c; }
    const BiquadCoeffs& coeffs() const noexcept { return c_; }

    /// Convenience: design + set.
    void set(BiquadType type, double sampleRate, double freqHz, double q = 0.70710678118654752,
             double gainDb = 0.0) noexcept {
        c_ = BiquadCoeffs::make(type, sampleRate, freqHz, q, gainDb);
    }

    void reset() noexcept { s1_ = s2_ = 0.0; }

    float process(float x) noexcept { return static_cast<float>(processD(static_cast<double>(x))); }

    double processD(double x) noexcept {
        const double y = c_.b0 * x + s1_;
        s1_ = flushTiny(c_.b1 * x - c_.a1 * y + s2_);
        s2_ = flushTiny(c_.b2 * x - c_.a2 * y);
        return y;
    }

    /// In-place or out-of-place block processing.
    void process(const float* in, float* out, int n) noexcept {
        for (int i = 0; i < n; ++i) out[i] = process(in[i]);
    }

private:
    static double flushTiny(double v) noexcept { return std::fabs(v) < 1.0e-30 ? 0.0 : v; }

    BiquadCoeffs c_;
    double s1_ = 0.0, s2_ = 0.0;
};

} // namespace apc::dsp
