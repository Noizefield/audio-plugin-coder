// apc::dsp::ParamSmoother - click-free parameter smoothing.
//
// Two modes:
//   Linear       a straight ramp that reaches the target exactly after the ramp time.
//   Exponential  a one-pole smoother; the remaining error is <= 0.1 % (-60 dB) of
//                the step after the ramp time, then it snaps to the target.
//
// Real-time safety:
//   * No allocation, no locks, no system calls in any member function.
//   * Every member is safe to call from the audio thread. Share parameter values
//     with the UI thread through an atomic, then call setTarget() on the audio thread.
//   * prepare() / setRampTime() only do arithmetic, so they are safe too.
//
// Std-only C++17, no JUCE dependency.
#pragma once

#include <algorithm>
#include <cmath>

namespace apc::dsp {

class ParamSmoother {
public:
    enum class Mode { Linear, Exponential };

    /// Set sample rate, ramp time (seconds) and mode. Does not change the current value.
    void prepare(double sampleRate, double rampSeconds, Mode mode = Mode::Linear) noexcept {
        fs_ = sampleRate > 1.0 ? sampleRate : 1.0;
        mode_ = mode;
        setRampTime(rampSeconds);
    }

    /// Change the ramp time. A ramp in progress is re-planned from the current value.
    void setRampTime(double seconds) noexcept {
        rampSeconds_ = seconds > 0.0 ? seconds : 0.0;
        rampSamples_ = static_cast<int>(std::lround(rampSeconds_ * fs_));
        // ln(1000) = 6.907755: error falls to 0.1 % after rampSeconds_.
        coeff_ = rampSamples_ > 0 ? std::exp(-6.907755278982137 / (rampSeconds_ * fs_)) : 0.0;
        if (mode_ == Mode::Linear && steps_ > 0) replan();
    }

    /// Jump to `value` immediately (no ramp).
    void reset(double value) noexcept {
        current_ = target_ = value;
        steps_ = 0;
        step_ = 0.0;
    }

    /// Start moving towards `value`.
    void setTarget(double value) noexcept {
        if (value == target_) return;
        target_ = value;
        if (mode_ == Mode::Linear) replan();
    }

    /// Advance one sample and return the smoothed value.
    float next() noexcept {
        if (mode_ == Mode::Linear) {
            if (steps_ > 0) {
                current_ += step_;
                if (--steps_ == 0) current_ = target_;
            }
        } else if (current_ != target_) {
            current_ = target_ + (current_ - target_) * coeff_;
            if (std::fabs(current_ - target_) < snapThreshold()) current_ = target_;
        }
        return static_cast<float>(current_);
    }

    /// Fill `out[0..n)` with consecutive smoothed values.
    void process(float* out, int n) noexcept {
        for (int i = 0; i < n; ++i) out[i] = next();
    }

    /// Advance `n` samples without producing output (block-rate use).
    void skip(int n) noexcept {
        if (n <= 0) return;
        if (mode_ == Mode::Linear) {
            if (steps_ <= 0) return;
            if (n >= steps_) {
                current_ = target_;
                steps_ = 0;
            } else {
                current_ += step_ * n;
                steps_ -= n;
            }
        } else if (current_ != target_) {
            current_ = target_ + (current_ - target_) * std::pow(coeff_, static_cast<double>(n));
            if (std::fabs(current_ - target_) < snapThreshold()) current_ = target_;
        }
    }

    double current() const noexcept { return current_; }
    double target() const noexcept { return target_; }
    bool isSmoothing() const noexcept { return current_ != target_; }
    int rampSamples() const noexcept { return rampSamples_; }

private:
    double snapThreshold() const noexcept { return 1.0e-7 * std::max(1.0, std::fabs(target_)); }

    void replan() noexcept {
        if (rampSamples_ <= 0) {
            current_ = target_;
            steps_ = 0;
            step_ = 0.0;
        } else {
            steps_ = rampSamples_;
            step_ = (target_ - current_) / steps_;
        }
    }

    double fs_ = 44100.0;
    double rampSeconds_ = 0.0;
    double coeff_ = 0.0;
    double current_ = 0.0;
    double target_ = 0.0;
    double step_ = 0.0;
    int rampSamples_ = 0;
    int steps_ = 0;
    Mode mode_ = Mode::Linear;
};

} // namespace apc::dsp
