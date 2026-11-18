// apc::dsp::DryWet - dry/wet mixing with a smoothed mix parameter.
//
// Laws:
//   Law::EqualPower  dry = cos(mix*pi/2), wet = sin(mix*pi/2)   (constant power for
//                    uncorrelated signals; -3 dB each at mix = 0.5)
//   Law::Linear      dry = 1 - mix, wet = mix                   (constant amplitude; use
//                    for correlated / parallel-processed signals, e.g. parallel compression)
//
// The mix value is smoothed with ParamSmoother (linear ramp) so automation never clicks.
// Latency-compensate the dry path yourself if the wet path has latency (e.g. oversampling).
//
// Real-time safety: no allocation, no locks. In-place processing is allowed
// (out may alias dry or wet).
//
// Std-only C++17, no JUCE dependency.
#pragma once

#include "ParamSmoother.h"

#include <cmath>

namespace apc::dsp {

class DryWet {
public:
    enum class Law { EqualPower, Linear };

    void prepare(double sampleRate, double rampSeconds = 0.02, Law law = Law::EqualPower) noexcept {
        law_ = law;
        smoother_.prepare(sampleRate, rampSeconds, ParamSmoother::Mode::Linear);
        smoother_.reset(smoother_.target());
        lastMix_ = -1.0f;
    }

    void setLaw(Law law) noexcept { law_ = law; lastMix_ = -1.0f; }

    /// Set the target mix in [0, 1] (0 = dry only, 1 = wet only).
    void setMix(float mix) noexcept { smoother_.setTarget(clamp01(mix)); }

    /// Jump to a mix value without ramping (e.g. on prepareToPlay).
    void resetMix(float mix) noexcept { smoother_.reset(clamp01(mix)); lastMix_ = -1.0f; }

    /// Stateless gain computation.
    static void gains(Law law, float mix, float& dryGain, float& wetGain) noexcept {
        mix = clamp01(mix);
        if (law == Law::Linear) {
            dryGain = 1.0f - mix;
            wetGain = mix;
        } else {
            const float a = mix * 1.57079632679489662f;
            dryGain = std::cos(a);
            wetGain = std::sin(a);
        }
    }

    /// One sample (advances the smoother).
    float mix(float dry, float wet) noexcept {
        advanceGains();
        return dry * dryGain_ + wet * wetGain_;
    }

    /// Mono block.
    void processBlock(const float* dry, const float* wet, float* out, int n) noexcept {
        for (int i = 0; i < n; ++i) out[i] = mix(dry[i], wet[i]);
    }

    /// Stereo block sharing one mix ramp across both channels.
    void processBlock(const float* dryL, const float* dryR, const float* wetL, const float* wetR, float* outL,
                      float* outR, int n) noexcept {
        for (int i = 0; i < n; ++i) {
            advanceGains();
            outL[i] = dryL[i] * dryGain_ + wetL[i] * wetGain_;
            outR[i] = dryR[i] * dryGain_ + wetR[i] * wetGain_;
        }
    }

    float currentMix() const noexcept { return static_cast<float>(smoother_.current()); }

private:
    static float clamp01(float v) noexcept { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }

    void advanceGains() noexcept {
        const float m = smoother_.next();
        if (m != lastMix_) {
            gains(law_, m, dryGain_, wetGain_);
            lastMix_ = m;
        }
    }

    ParamSmoother smoother_;
    Law law_ = Law::EqualPower;
    float dryGain_ = 1.0f, wetGain_ = 0.0f;
    float lastMix_ = -1.0f;
};

} // namespace apc::dsp
