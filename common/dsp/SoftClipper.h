// apc::dsp::SoftClipper - bounded saturation with optional first-order ADAA.
//
//   Shape::Tanh    y = tanh(x)                       (smooth, never exactly 1)
//   Shape::Cubic   y = 1.5*(x - x^3/3) for |x| <= 1, else +-1   (exactly bounded, cheap)
//
// Output is always within [-1, 1].
//
// ADAA-1 (antiderivative anti-aliasing, Parker et al. 2016) evaluates
//   y[n] = (F(x[n]) - F(x[n-1])) / (x[n] - x[n-1])
// with F the exact antiderivative of the shaper. It suppresses aliasing from the
// non-linearity without oversampling, at the cost of half a sample of delay-like
// averaging (a mild treble loss) and one extra state value. Stateful: use one
// SoftClipper instance per channel.
//
// Static helpers (tanhApprox, cubic) are stateless and allocation-free.
//
// Real-time safety: no allocation, no locks. Not thread-safe across threads (state).
//
// Std-only C++17, no JUCE dependency.
#pragma once

#include <cmath>

namespace apc::dsp {

class SoftClipper {
public:
    enum class Shape { Tanh, Cubic };

    explicit SoftClipper(Shape shape = Shape::Tanh, bool adaa = false) noexcept : shape_(shape), adaa_(adaa) {}

    void setShape(Shape s) noexcept { shape_ = s; }
    void setAdaa(bool on) noexcept { adaa_ = on; }
    void reset() noexcept { x1_ = 0.0; }

    double process(double x) noexcept {
        if (!adaa_) return shape(x);
        const double dx = x - x1_;
        double y;
        if (std::fabs(dx) < 1.0e-5) {
            y = shape(0.5 * (x + x1_));          // ill-conditioned: fall back to the midpoint value
        } else {
            y = (antiderivative(x) - antiderivative(x1_)) / dx;
        }
        x1_ = x;
        return y;
    }

    float process(float x) noexcept { return static_cast<float>(process(static_cast<double>(x))); }

    void process(const float* in, float* out, int n) noexcept {
        for (int i = 0; i < n; ++i) out[i] = process(in[i]);
    }

    /// Rational tanh approximation, exact +-1 for |x| >= 3, max error ~2.4e-2.
    static float tanhApprox(float x) noexcept {
        if (x >= 3.0f) return 1.0f;
        if (x <= -3.0f) return -1.0f;
        const float x2 = x * x;
        return x * (27.0f + x2) / (27.0f + 9.0f * x2);
    }

    /// 1.5*(x - x^3/3) inside [-1, 1], hard +-1 outside.
    static double cubic(double x) noexcept {
        if (x >= 1.0) return 1.0;
        if (x <= -1.0) return -1.0;
        return 1.5 * (x - x * x * x / 3.0);
    }

private:
    double shape(double x) const noexcept { return shape_ == Shape::Tanh ? std::tanh(x) : cubic(x); }

    double antiderivative(double x) const noexcept {
        const double ax = std::fabs(x);
        if (shape_ == Shape::Tanh) {
            // ln(cosh(x)) = |x| + ln(1 + e^{-2|x|}) - ln 2   (overflow-safe)
            return ax + std::log1p(std::exp(-2.0 * ax)) - 0.69314718055994531;
        }
        if (ax <= 1.0) return 1.5 * (0.5 * x * x - x * x * x * x / 12.0);
        return ax - 0.375; // continuous with the inner branch at |x| = 1 (value 0.625)
    }

    Shape shape_;
    bool adaa_;
    double x1_ = 0.0;
};

} // namespace apc::dsp
