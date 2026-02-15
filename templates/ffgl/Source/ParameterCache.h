#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <vector>
#include <atomic>

/**
 * A simple cache for strictly type-safe, lock-free parameter access.
 * Stores atomic pointers to the underlying APVTS parameter values.
 */
class ParameterCache
{
public:
    ParameterCache() = default;

    void initialize(juce::AudioProcessorValueTreeState& apvts, const std::vector<juce::String>& paramIDs)
    {
        cache.clear();
        cache.reserve(paramIDs.size());

        for (const auto& id : paramIDs)
        {
            if (auto* param = apvts.getRawParameterValue(id))
            {
                cache.push_back(param);
            }
            else
            {
                // Fallback: Store a dummy atomic if ID not found to prevent crashes
                // In production, log this error.
                static std::atomic<float> dummy(0.0f);
                cache.push_back(&dummy);
            }
        }
    }

    // Fast, lock-free access by index
    float get(size_t index) const
    {
        if (index < cache.size())
            return cache[index]->load(std::memory_order_relaxed);
        return 0.0f;
    }

private:
    std::vector<std::atomic<float>*> cache;
};
