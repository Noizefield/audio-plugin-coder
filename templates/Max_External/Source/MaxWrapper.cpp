#include "c74_min.h"
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_core/juce_core.h>

#include "JuceDSP.h"
#include "JuceBridge.h"

using namespace c74::min;

// ============================================
// SHARED JUCE INITIALIZER
// ============================================
// Ensures MessageManager persists across multiple Max Object instances.
class SharedJuceInitializer
{
public:
    SharedJuceInitializer() { initialiser = std::make_unique<juce::ScopedJuceInitialiser_GUI>(); }
    ~SharedJuceInitializer() { initialiser = nullptr; }
private:
    std::unique_ptr<juce::ScopedJuceInitialiser_GUI> initialiser;
};


/**
 * The main Max External Object.
 * Wraps JUCE DSP and UI logic.
 */
class JuceMaxDevice : public object<JuceMaxDevice>, public vector_operator<> {
public:
    MIN_DESCRIPTION {"JUCE-based DSP in Max"};
    MIN_TAGS {"audio, dsp, juce"};
    MIN_AUTHOR {"Your Name"};
    MIN_RELATED {"index~"};

    // Input/Output
    inlet<>  input  { this, "(signal) Input" };
    outlet<> output { this, "(signal) Output" };

    // ==============================================================================
    // CONSTRUCTOR & DESTRUCTOR
    // ==============================================================================

    JuceMaxDevice(const atoms& args = {})
    {
        // 1. Initialize JUCE
        // Ensure the MessageManager is initialized on the main thread via SharedResourcePointer
        // This is safe to call from Max's main thread (where constructor runs).

        // 2. Initialize DSP
        dsp.reset(new JuceDSP());

        // 3. Initialize Bridge (UI)
        bridge.reset(new JuceBridge(dsp.get(), this));
    }

    ~JuceMaxDevice()
    {
        // Cleanup order matters: Bridge -> DSP -> Init
        bridge = nullptr;
        dsp = nullptr;
    }

    // ==============================================================================
    // DSP SETUP
    // ==============================================================================

    message<> dspsetup { this, "dspsetup",
        MIN_FUNCTION {
            double sr = args[0];
            int vec_size = args[1];

            if (dsp)
                dsp->prepareToPlay(sr, vec_size);

            // Pre-allocate buffer to avoid allocation in audio thread
            // Assuming stereo (2 channels) as per JuceDSP.h
            // Check max vector size just in case, but usually current vector size is fine
            // We'll allocate a bit more for safety or just vector size.
            conversionBuffer.setSize(2, vec_size);

            return {};
        }
    };

    // ==============================================================================
    // AUDIO PROCESSING
    // ==============================================================================

    void operator()(audio_bundle input, audio_bundle output)
    {
        int numChannels = input.channel_count();
        int numSamples = input.frame_count();

        // 1. Ensure buffer capacity (Fast check)
        // If vector size changes dynamically without dspsetup (rare but possible in some hosts),
        // we might need to resize. However, allocating here is bad.
        // Ideally rely on dspsetup. For safety, if buffer is too small, we bail or process partial.

        if (conversionBuffer.getNumSamples() < numSamples || conversionBuffer.getNumChannels() < numChannels)
        {
            // Fallback: This allocates, but only happens if configuration is mismatched/changed unexpectedly.
            // In a strict real-time context, we might output silence instead.
            conversionBuffer.setSize(std::max(2, numChannels), std::max(conversionBuffer.getNumSamples(), numSamples));
        }

        if (!dsp) return;

        // 2. Convert Min-API (Double) to JUCE (Float)
        // Note: conversionBuffer is a member variable, so no allocation here.

        for (int c = 0; c < numChannels; ++c)
        {
            auto* min_in = input.samples(c);
            auto* juce_in = conversionBuffer.getWritePointer(c);

            // Convert Double to Float
            for (int s = 0; s < numSamples; ++s)
            {
                juce_in[s] = (float)min_in[s];
            }
        }

        // Process
        juce::MidiBuffer midi; // Dummy
        dsp->processBlock(conversionBuffer, midi);

        // 3. Copy back to Output (Float to Double)
        for (int c = 0; c < output.channel_count(); ++c)
        {
            if (c < numChannels) // Safety
            {
                auto* juce_out = conversionBuffer.getReadPointer(c);
                auto* min_out = output.samples(c);

                for (int s = 0; s < numSamples; ++s)
                {
                    min_out[s] = (double)juce_out[s];
                }
            }
            else
            {
                // Clear extra channels
                auto* min_out = output.samples(c);
                std::fill(min_out, min_out + numSamples, 0.0);
            }
        }
    }

    // ==============================================================================
    // UI MESSAGES
    // ==============================================================================

    message<> open_ui { this, "open", "Open the JUCE UI",
        MIN_FUNCTION {
            if (bridge)
            {
                bridge->attachToMaxWindow();
            }
            return {};
        }
    };

    message<> dblclick { this, "dblclick", "Double click to open UI",
        MIN_FUNCTION {
            if (bridge) {
                bridge->attachToMaxWindow();
            }
            return {};
        }
    };

private:
    juce::SharedResourcePointer<SharedJuceInitializer> juceInitialiser;
    std::unique_ptr<JuceDSP> dsp;
    std::unique_ptr<JuceBridge> bridge;

    // Member buffer for audio conversion to prevent allocation in callback
    juce::AudioBuffer<float> conversionBuffer;
};

MIN_EXTERNAL(JuceMaxDevice);
