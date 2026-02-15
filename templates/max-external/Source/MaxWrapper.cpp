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
    // ATTRIBUTES (Parameter Binding)
    // ==============================================================================

    // Example: Bind 'gain' attribute to JUCE parameter
    // Note: In a real plugin, iterate APVTS and create attributes dynamically or manually map them.
    attribute<double> gain { this, "gain", 1.0,
        description {"Master Gain"},
        setter { MIN_FUNCTION {
            double val = args[0];
            // Update JUCE Parameter if available
            // if (dsp) dsp->setParameter("gain", val);
            return args;
        }}
    };

    // ==============================================================================
    // CONSTRUCTOR & DESTRUCTOR
    // ==============================================================================

    JuceMaxDevice(const atoms& args = {})
    {
        // 1. Initialize JUCE
        juceInitialiser.reset(new SharedJuceInitializer()); // Actually pointer manages this, but keeping reset for clarity if explicit init needed

        // 2. Multi-Channel Configuration
        int channels = 2; // Default Stereo
        if (!args.empty()) {
            channels = (int)args[0]; // [juce.dsp~ 4]
        }

        // 3. Initialize DSP
        dsp.reset(new JuceDSP());

        // Configure Bus Layout (if supported by JuceDSP)
        // dsp->setPlayConfigDetails(channels, channels, 44100.0, 512);

        // 4. Initialize Bridge (UI)
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

        if (!dsp) return;

        // OPTIMIZATION: Direct Double Processing
        // Since Max uses doubles and we added processBlock(AudioBuffer<double>) to JuceDSP,
        // we can wrap the Min-API pointers directly without copying!

        // Create a JUCE buffer wrapper around existing data
        // Note: JUCE's AudioBuffer<double> takes an array of pointers (double**).
        // Min-API provides sample_t* (double*) per channel via input.samples(c).
        // We need an array of pointers.

        // Use a small stack array for pointers (Max objects usually have limited channels)
        // or a member vector if high channel count.
        const int maxChannels = 128;
        double* inputPointers[maxChannels];
        double* outputPointers[maxChannels];

        int processChannels = std::min(numChannels, maxChannels);

        for (int c = 0; c < processChannels; ++c)
        {
            inputPointers[c] = input.samples(c);

            // For output, we write directly to Min-API output
            // But JUCE processBlock is usually in-place or separate input/output.
            // If JuceDSP supports separate IO, we are good.
            // If JuceDSP is in-place, we might need to copy input to output first if they are different buffers.
            // In Max, input and output buffers are distinct.

            // Strategy: Copy input to output, then process in-place on output buffer?
            // Or use an AudioBuffer that wraps the *output* pointers, but how do we get input?

            // JUCE AudioProcessor::processBlock(AudioBuffer& buffer) is in-place.
            // So we must copy input to output first.

            auto* in = input.samples(c);
            auto* out = output.samples(c);

            // Memcpy is fast
            std::memcpy(out, in, numSamples * sizeof(double));

            outputPointers[c] = out;
        }

        // Wrap the output buffer (now containing input data)
        juce::AudioBuffer<double> wrapper(outputPointers, processChannels, numSamples);

        // Process In-Place
        juce::MidiBuffer midi;
        dsp->processBlock(wrapper, midi);

        // Zero out unused output channels
        for (int c = processChannels; c < output.channel_count(); ++c)
        {
             std::fill(output.samples(c), output.samples(c) + numSamples, 0.0);
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
    std::unique_ptr<SharedJuceInitializer> juceInitialiser;
    // Note: SharedResourcePointer is usually a value type on stack or member.
    // However, we want to control destruction order precisely.
    // If we use SharedResourcePointer as member, it works.
    // Here we use unique_ptr to manage explicitly if needed, but SharedResourcePointer is safer.
    // Reverting to SharedResourcePointer member usage as per previous commit is cleaner,
    // but constructor code above used 'reset'. Let's fix that.

    // Correct usage:
    juce::SharedResourcePointer<SharedJuceInitializer> sharedInit;

    std::unique_ptr<JuceDSP> dsp;
    std::unique_ptr<JuceBridge> bridge;

    // Member buffer for audio conversion to prevent allocation in callback
    juce::AudioBuffer<float> conversionBuffer;
};

MIN_EXTERNAL(JuceMaxDevice);
