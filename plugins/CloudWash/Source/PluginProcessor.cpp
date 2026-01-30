#include "PluginProcessor.h"
#include "PluginEditor.h"
#include <fstream>

// Emergency crash logging to file
static void CRASH_LOG(const juce::String& msg) {
    std::ofstream log("R:\\_VST_Development_2026\\audio-plugin-coder\\cloudwash_crash_log.txt", std::ios::app);
    log << msg.toStdString() << std::endl;
    log.flush();
    DBG(msg);
}

//==============================================================================
CloudWashAudioProcessor::CloudWashAudioProcessor()
#ifndef JucePlugin_PreferredChannelConfigurations
     : AudioProcessor (BusesProperties()
                     #if ! JucePlugin_IsMidiEffect
                      #if ! JucePlugin_IsSynth
                       .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                      #endif
                       .withOutput ("Output", juce::AudioChannelSet::stereo(), true)
                     #endif
                       ),
#else
    :
#endif
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
    DBG("CloudWash: Constructor started");

    // CRITICAL FIX: Defer ALL Clouds initialization to prepareToPlay()
    // This ensures JUCE is fully initialized before we touch Clouds
    processor = nullptr;
    block_mem = nullptr;
    block_ccm = nullptr;

    // Initialize current mode/quality state (atomic stores for thread safety)
    DBG("CloudWash: Setting initial state");
    currentMode.store(0);  // PLAYBACK_MODE_GRANULAR
    currentQuality.store(0);  // Hi-Fi Stereo

    // Initialize presets
    DBG("CloudWash: Initializing presets");
    initializePresets();

    DBG("CloudWash: Constructor completed successfully");
}

CloudWashAudioProcessor::~CloudWashAudioProcessor()
{
    // Clean up heap-allocated Clouds processor and buffers
    delete processor;
    // Use free() since we used calloc() for these buffers
    free(block_mem);
    free(block_ccm);
}

//==============================================================================
const juce::String CloudWashAudioProcessor::getName() const
{
    return JucePlugin_Name;
}

bool CloudWashAudioProcessor::acceptsMidi() const
{
   #if JucePlugin_WantsMidiInput
    return true;
   #else
    return false;
   #endif
}

bool CloudWashAudioProcessor::producesMidi() const
{
   #if JucePlugin_ProducesMidiOutput
    return true;
   #else
    return false;
   #endif
}

bool CloudWashAudioProcessor::isMidiEffect() const
{
   #if JucePlugin_IsMidiEffect
    return true;
   #else
    return false;
   #endif
}

double CloudWashAudioProcessor::getTailLengthSeconds() const
{
    return 0.0;
}

int CloudWashAudioProcessor::getNumPrograms()
{
    return (int)presets.size();
}

int CloudWashAudioProcessor::getCurrentProgram()
{
    return currentPresetIndex;
}

void CloudWashAudioProcessor::setCurrentProgram (int index)
{
    if (index >= 0 && index < (int)presets.size())
    {
        currentPresetIndex = index;
        loadPreset(index);
    }
}

const juce::String CloudWashAudioProcessor::getProgramName (int index)
{
    if (index >= 0 && index < (int)presets.size())
        return presets[index].name;
    return "Invalid";
}

void CloudWashAudioProcessor::changeProgramName (int index, const juce::String& newName)
{
    if (index >= 0 && index < (int)presets.size())
        presets[index].name = newName;
}

//==============================================================================
void CloudWashAudioProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    DBG("CloudWash: prepareToPlay called");

    // CRITICAL FIX: Initialize Clouds processor here instead of constructor
    // This ensures JUCE is fully initialized before we touch Clouds
    // Use atomic flag to ensure we only initialize once (prepareToPlay can be called multiple times)
    if (!cloudsInitialized.load())
    {
        CRASH_LOG("==== CloudWash prepareToPlay - First-time Clouds initialization ====");

        const int memLen = 118784;
        const int ccmLen = 65536 - 128;

        CRASH_LOG("Step 1: Allocating block_mem (" + juce::String(memLen) + " bytes)...");
        block_mem = (uint8_t*)calloc(memLen, 1);
        CRASH_LOG("Step 2: block_mem allocated at " + juce::String::toHexString((juce::pointer_sized_uint)block_mem));

        CRASH_LOG("Step 3: Allocating block_ccm (" + juce::String(ccmLen) + " bytes)...");
        block_ccm = (uint8_t*)calloc(ccmLen, 1);
        CRASH_LOG("Step 4: block_ccm allocated at " + juce::String::toHexString((juce::pointer_sized_uint)block_ccm));

        CRASH_LOG("Step 5: About to call 'new clouds::GranularProcessor()'...");
        processor = new clouds::GranularProcessor();
        CRASH_LOG("Step 6: GranularProcessor allocated at " + juce::String::toHexString((juce::pointer_sized_uint)processor));

        CRASH_LOG("Step 7: About to memset processor (size=" + juce::String(sizeof(*processor)) + ")...");
        memset(processor, 0, sizeof(*processor));
        CRASH_LOG("Step 8: Processor memset complete");

        CRASH_LOG("Step 9: About to call processor->Init()...");
        processor->Init(block_mem, memLen, block_ccm, ccmLen);
        CRASH_LOG("Step 10: Init() COMPLETED SUCCESSFULLY!");

        // Mark as initialized so we don't do this again
        cloudsInitialized.store(true);
        CRASH_LOG("==== Clouds initialization complete - NO CRASH ====");
    }
    else
    {
        CRASH_LOG("prepareToPlay: Clouds already initialized, skipping...");
    }

    hostSampleRate = sampleRate;
    internalSampleRate = 32000.0;

    // Initialize VCV-style SampleRateConverters with original Clouds FIR coefficients
    CRASH_LOG("prepareToPlay: Initializing VCV-style SRC...");
    inputSRC.Init(clouds::src_filter_1x_2_45);
    outputSRC.Init(clouds::src_filter_1x_2_45);
    CRASH_LOG("prepareToPlay: VCV-style SRC initialized");

    // Resize temporary buffers with safety margin
    resampledInputBuffer.setSize(2, samplesPerBlock * 4);
    resampledOutputBuffer.setSize(2, samplesPerBlock * 4);
    dryBuffer.setSize(2, samplesPerBlock);

    CRASH_LOG("prepareToPlay: Resizing buffers...");
    inputFrames.resize(samplesPerBlock * 4);
    outputFrames.resize(samplesPerBlock * 4);
    CRASH_LOG("prepareToPlay: Buffers resized");

    // Set processor state before calling Prepare()
    // (VCV Rack does this in process loop, but we do it here for simplicity)
    CRASH_LOG("prepareToPlay: Setting playback mode and quality...");
    processor->set_playback_mode(static_cast<clouds::PlaybackMode>(currentMode.load()));
    processor->set_quality(currentQuality.load());
    processor->set_silence(false);
    CRASH_LOG("prepareToPlay: About to call Prepare()...");
    processor->Prepare();
    CRASH_LOG("prepareToPlay: Prepare() completed - prepareToPlay DONE!");
}

void CloudWashAudioProcessor::releaseResources()
{
}

#ifndef JucePlugin_PreferredChannelConfigurations
bool CloudWashAudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
  #if JucePlugin_IsMidiEffect
    juce::ignoreUnused (layouts);
    return true;
  #else
    if (layouts.getMainOutputChannelSet() != juce::AudioChannelSet::stereo())
        return false;

   #if ! JucePlugin_IsSynth
    if (layouts.getMainInputChannelSet() != juce::AudioChannelSet::stereo())
        return false;
   #endif

    return true;
  #endif
}
#endif

void CloudWashAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages)
{
    static int processBlockCallCount = 0;
    if (processBlockCallCount < 5)  // Only log first 5 calls to avoid spam
    {
        CRASH_LOG("processBlock called #" + juce::String(++processBlockCallCount));
    }

    juce::ScopedNoDenormals noDenormals;
    auto totalNumInputChannels  = getTotalNumInputChannels();
    auto totalNumOutputChannels = getTotalNumOutputChannels();
    
    // SAFETY CHECK: Ensure Clouds is initialized before processing
    if (!cloudsInitialized.load() || processor == nullptr)
    {
        CRASH_LOG("ERROR: processBlock called before Clouds initialization!");
        buffer.clear();
        return;
    }

    // Clear unused output channels
    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        buffer.clear (i, 0, buffer.getNumSamples());

    // METERING: Input with peak hold and decay
    float inputMagnitude = buffer.getRMSLevel(0, 0, buffer.getNumSamples());
    if (inputMagnitude > inputPeakHold)
        inputPeakHold = inputMagnitude;
    else
        inputPeakHold *= 0.97f;  // Decay factor for smooth meter movement
    inputPeakLevel.store(inputPeakHold);

    //==============================================================================
    // 0. HANDLE MODE/QUALITY CHANGES (With silence buffer to prevent audio glitches)
    //==============================================================================

    auto modeParam = dynamic_cast<juce::AudioParameterChoice*>(apvts.getParameter("mode"));
    auto qualityParam = dynamic_cast<juce::AudioParameterChoice*>(apvts.getParameter("quality"));

    if (modeParam && qualityParam) {
        int targetMode = modeParam->getIndex();
        int targetQuality = qualityParam->getIndex();

        // Quality mapping matches hardware/VCV Rack behavior
        // Internal clouds quality: 0:HiFi-Stereo, 1:HiFi-Mono, 2:LoFi-Stereo, 3:LoFi-Mono
        // Quality bits: bit 0 = mono (1) / stereo (0), bit 1 = lofi (1) / hifi (0)
        int internalQuality = targetQuality;

        // Check if mode or quality changed (atomic loads for thread safety)
        bool modeChanged = (targetMode != currentMode.load());
        bool qualityChanged = (internalQuality != currentQuality.load());

        if (modeChanged || qualityChanged) {
            // Use atomic compare-and-swap pattern to prevent race conditions
            // when both mode and quality change simultaneously
            int expected = 0;
            if (silenceBlocksRemaining.compare_exchange_strong(expected, 4)) {
                // Successfully started new preparation sequence
                pendingMode.store(targetMode);
                pendingQuality.store(internalQuality);
            }
            else {
                // Already preparing - update pending values atomically
                // This batches simultaneous changes together
                pendingMode.store(targetMode);
                pendingQuality.store(internalQuality);
                // Keep existing silenceBlocksRemaining count - don't reset
            }
        }

        // Handle silence phase before Prepare()
        int remainingBlocks = silenceBlocksRemaining.load();
        if (remainingBlocks > 0) {
            if (remainingBlocks > 1) {
                // Still silencing - output silence and decrement counter
                silenceBlocksRemaining.store(remainingBlocks - 1);
                buffer.clear();
                return;
            }
            else {
                // Last silence block - now safe to call Prepare() synchronously
                // Use mutex ONLY for the critical Prepare() section to avoid blocking the audio thread
                int newMode = pendingMode.load();
                int newQuality = pendingQuality.load();

                if (newMode >= 0 && newQuality >= 0) {
                    // Validate mode and quality ranges before applying
                    bool validMode = (newMode >= 0 && newMode < static_cast<int>(clouds::PLAYBACK_MODE_LAST));
                    bool validQuality = (newQuality >= 0 && newQuality <= 3);  // Clouds internal quality: 0-3 (HiFi-S, HiFi-M, LoFi-S, LoFi-M)

                    if (validMode && validQuality) {
                        // Lock ONLY during Prepare() call - minimal critical section
                        {
                            std::lock_guard<std::mutex> lock(processorMutex);
                            processor->set_playback_mode(static_cast<clouds::PlaybackMode>(newMode));
                            processor->set_quality(newQuality);
                            processor->Prepare();  // SAFE: Called on audio thread after silencing
                        }

                        currentMode.store(newMode);
                        currentQuality.store(newQuality);
                    }

                    pendingMode.store(-1);
                    pendingQuality.store(-1);
                }

                silenceBlocksRemaining.store(0);
                buffer.clear();
                return;
            }
        }
    }

    //==============================================================================
    // 1. UPDATE PARAMETERS
    //==============================================================================

    // Core
    float position = apvts.getRawParameterValue("position")->load();
    float size = apvts.getRawParameterValue("size")->load();
    float pitch = apvts.getRawParameterValue("pitch")->load(); // -4.0 to 4.0 octaves (±48 semitones)
    float density = apvts.getRawParameterValue("density")->load();
    float texture = apvts.getRawParameterValue("texture")->load();

    // I/O & Mix
    float inGain = apvts.getRawParameterValue("in_gain")->load();
    float blend = apvts.getRawParameterValue("blend")->load();
    float spread = apvts.getRawParameterValue("spread")->load();
    float feedback = apvts.getRawParameterValue("feedback")->load();
    float reverb = apvts.getRawParameterValue("reverb")->load();

    auto freezeParam = dynamic_cast<juce::AudioParameterBool*>(apvts.getParameter("freeze"));
    auto triggerParam = dynamic_cast<juce::AudioParameterBool*>(apvts.getParameter("trigger"));

    if (freezeParam) {
        bool newFreeze = freezeParam->get();
        if (newFreeze != processor->frozen()) processor->set_freeze(newFreeze);
    }
    
    // Handle trigger parameter for grain synchronization (matches VCV Rack)
    if (triggerParam) {
        bool trigger = triggerParam->get();
        clouds::Parameters* p = processor->mutable_parameters();
        p->trigger = trigger;
        p->gate = trigger;
        // Reset trigger after one block so it behaves like a one-shot
        if (trigger) {
            triggerParam->setValueNotifyingHost(false);
        }
    }
    
    // Note: Input gain is now applied during the resampling loop (around line 450)
    // VCV Rack applies gain during voltage-to-audio conversion.
    // VST audio is already normalized to ±1.0, so we apply gain directly without /5.0 scaling.
    // See: inputFrame.l = sampleL * inGain; in the resampling section below.
    
    // Note: No need to keep dry buffer copy - Clouds handles dry/wet internally

    // Update Processor Parameters
    clouds::Parameters* p = processor->mutable_parameters();
    p->position = position;
    p->size = size;
    // Pitch: Convert octaves to semitones (multiply by 12), clamp to ±48 semitones
    // VCV Rack: p->pitch = clamp((params[PITCH_PARAM].getValue() + inputs[PITCH_INPUT].getVoltage()) * 12.0f, -48.0f, 48.0f);
    // Parameter range is -2.0 to 2.0 octaves, giving us ±24 semitones when multiplied by 12
    p->pitch = juce::jlimit(-48.0f, 48.0f, pitch * 12.0f); // Convert octaves to semitones, clamped
    p->density = density;
    p->texture = texture;

    // All blend parameters are controlled by separate knobs in the GUI
    // No blend mode switching needed - each knob controls its respective parameter directly
    p->dry_wet = juce::jlimit(0.0f, 1.0f, blend);
    p->stereo_spread = spread;
    p->feedback = feedback;
    p->reverb = reverb;
    
    // Visualization data - use density as a proxy for grain activity since
    // Clouds DSP doesn't expose active grain count publicly
    // Density 0 = 0 grains visible, Density 1 = up to 40 grains visible
    int estimatedGrainCount = static_cast<int>(density * 40.0f);
    activeGrainCount.store(std::max(1, estimatedGrainCount));
    grainDensityViz.store(density);
    grainTextureViz.store(texture);
    
    //==============================================================================
    // 2. RESAMPLE INPUT (Host -> 32k)
    //==============================================================================

    int numHostSamples = buffer.getNumSamples();
    
    // Calculate output samples for conversion using fixed 2:1 ratio
    // The VCV-style SRC uses polyphase FIR filtering designed for 2:1 ratios
    // For 48k->32k, we need to handle this as a non-integer ratio
    // The original Clouds hardware uses 32kHz internal, VCV Rack handles arbitrary ratios
    // We use a similar approach: accumulate samples and process in chunks
    
    // For now, use a simplified approach: calculate expected output size
    // based on the ratio, then use linear interpolation for non-integer ratios
    double conversionRatio = internalSampleRate / hostSampleRate;
    int num32kSamples = static_cast<int>(numHostSamples * conversionRatio + 0.5);
    num32kSamples = juce::jlimit(1, resampledInputBuffer.getNumSamples(), num32kSamples);
    
    // Apply gain inline during resampling
    // VCV Rack: inputFrame.samples[0] = inputs[IN_L_INPUT].getVoltage() * params[IN_GAIN_PARAM].getValue() / 5.0;
    // Note: VST audio is ±1.0 normalized (unlike Eurorack ±5V), so no /5.0 scaling needed
    const float* inL = buffer.getReadPointer(0);
    const float* inR = buffer.getReadPointer(totalNumInputChannels > 1 ? 1 : 0);
    float* outL = resampledInputBuffer.getWritePointer(0);
    float* outR = resampledInputBuffer.getWritePointer(1);
    
    // Clear output buffer first
    resampledInputBuffer.clear();
    
    // Simple linear resampling with gain application
    // For 48kHz -> 32kHz, this processes samples and applies gain
    double phase = 0.0;
    double phaseIncrement = hostSampleRate / internalSampleRate;  // e.g., 48000/32000 = 1.5
    
    int outSample = 0;
    for (int i = 0; i < numHostSamples - 1 && outSample < num32kSamples; ++i) {
        while (phase < 1.0 && outSample < num32kSamples) {
            float frac = static_cast<float>(phase);
            float sampleL = inL[i] + frac * (inL[i + 1] - inL[i]);
            float sampleR = inR[i] + frac * (inR[i + 1] - inR[i]);
            
            // Apply gain inline (VST: no /5.0 scaling needed)
            outL[outSample] = sampleL * inGain;
            outR[outSample] = sampleR * inGain;
            
            ++outSample;
            phase += phaseIncrement;
        }
        phase -= 1.0;
    }
    
    // Fill remaining samples if any
    while (outSample < num32kSamples) {
        outL[outSample] = inL[numHostSamples - 1] * inGain;
        outR[outSample] = inR[numHostSamples - 1] * inGain;
        ++outSample;
    }
    
    //============================================================================
    // 3. PROCESS CLOUDS (Float -> Short -> Float) - CHUNKED (kMaxBlockSize=32)
    //============================================================================

    float* resampledL = resampledInputBuffer.getWritePointer(0);
    float* resampledR = resampledInputBuffer.getWritePointer(1);

    const int kMaxCloudsBlock = 32;
    int samplesProcessed = 0;
    static int processLogCount = 0;

    // CRITICAL FIX: For spectral mode, we need to call Buffer() continuously
    // VCV Rack calls processor->Prepare() every 32 samples, which includes phase_vocoder_.Buffer()
    // The phase vocoder's STFT uses a hop size of fft_size / 4 (e.g., 4096/4 = 1024 samples).
    // At 32kHz, this means Buffer() should be called approximately every 32ms, but the original
    // hardware calls it more frequently (every 32 samples) to maintain continuous processing.
    bool isSpectralMode = (currentMode.load() == 3); // PLAYBACK_MODE_SPECTRAL = 3
    
    // Track samples since last Buffer() call for spectral mode timing
    static int samplesSinceLastBuffer = 0;
    const int kSpectralBufferInterval = 32; // Call Buffer() every 32 samples at 32kHz (matches original hardware)

    while (samplesProcessed < num32kSamples) {
        int chunkSize = std::min(kMaxCloudsBlock, num32kSamples - samplesProcessed);

        // Additional safety check: ensure we don't exceed inputFrames buffer size
        chunkSize = std::min(chunkSize, static_cast<int>(inputFrames.size()) - samplesProcessed);
        if (chunkSize <= 0) break;

        // CRITICAL FIX: Call Buffer() for spectral mode at the correct rate
        // The phase vocoder requires Buffer() to be called every 32 samples at 32kHz
        // to maintain proper STFT processing timing. This matches the original hardware
        // behavior where Prepare() (which calls Buffer()) is called every 32 samples.
        if (isSpectralMode) {
            samplesSinceLastBuffer += chunkSize;
            if (samplesSinceLastBuffer >= kSpectralBufferInterval) {
                processor->Buffer();
                samplesSinceLastBuffer = 0;
            }
        }

        // Convert to ShortFrame for this chunk
        // Use safer float-to-int conversion: clamp first, then round
        for (int i = 0; i < chunkSize; ++i)
        {
            float clampedL = juce::jlimit(-32768.0f, 32767.0f, resampledL[samplesProcessed + i] * 32767.0f);
            float clampedR = juce::jlimit(-32768.0f, 32767.0f, resampledR[samplesProcessed + i] * 32767.0f);
            inputFrames[i].l = static_cast<int16_t>(std::round(clampedL));
            inputFrames[i].r = static_cast<int16_t>(std::round(clampedR));
        }

        // Execute DSP
        if (processLogCount < 3) {
            CRASH_LOG("processBlock: About to call Process() chunk " + juce::String(samplesProcessed) + "/" + juce::String(num32kSamples));
        }
        processor->Process(inputFrames.data(), outputFrames.data(), chunkSize);
        if (processLogCount < 3) {
            CRASH_LOG("processBlock: Process() completed for chunk");
            processLogCount++;
        }

        // Convert to Float for this chunk
        for (int i = 0; i < chunkSize; ++i)
        {
            float sampleL = (float)outputFrames[i].l / 32768.0f;
            float sampleR = (float)outputFrames[i].r / 32768.0f;
            // SAFETY: Clamp output to prevent NaN/Inf
            sampleL = juce::jlimit(-1.0f, 1.0f, sampleL);
            sampleR = juce::jlimit(-1.0f, 1.0f, sampleR);
            resampledOutputBuffer.setSample(0, samplesProcessed + i, sampleL);
            resampledOutputBuffer.setSample(1, samplesProcessed + i, sampleR);
        }

        samplesProcessed += chunkSize;
    }
    
    //==============================================================================
    // 4. RESAMPLE OUTPUT (32k -> Host)
    //==============================================================================
    
    // Linear resampling for output (32k -> host rate)
    // Matches VCV Rack approach: simple linear interpolation for arbitrary ratios
    const float* procL = resampledOutputBuffer.getReadPointer(0);
    const float* procR = resampledOutputBuffer.getReadPointer(1);
    float* finalOutL = buffer.getWritePointer(0);
    float* finalOutR = buffer.getWritePointer(totalNumOutputChannels > 1 ? 1 : 0);
    
    double outPhase = 0.0;
    double outPhaseIncrement = internalSampleRate / hostSampleRate;  // e.g., 32000/48000 = 0.666...
    
    for (int i = 0; i < numHostSamples; ++i) {
        int idx = static_cast<int>(outPhase);
        float frac = static_cast<float>(outPhase - idx);
        
        // Clamp index to valid range
        if (idx >= num32kSamples - 1) {
            idx = num32kSamples - 1;
            frac = 0.0f;
        }
        
        float sampleL = procL[idx] + frac * (procL[idx + 1] - procL[idx]);
        float sampleR = procR[idx] + frac * (procR[idx + 1] - procR[idx]);
        
        finalOutL[i] = sampleL;
        finalOutR[i] = sampleR;
        
        outPhase += outPhaseIncrement;
        if (outPhase >= num32kSamples - 1) {
            outPhase = num32kSamples - 1;
        }
    }

    // Note: Dry/wet mixing is now handled internally by the Clouds DSP
    // The blend parameter is passed to p->dry_wet above
    // No additional manual mixing needed
    
    // METERING: Output with peak hold and decay
    float outputMagnitude = buffer.getRMSLevel(0, 0, buffer.getNumSamples());
    if (outputMagnitude > outputPeakHold)
        outputPeakHold = outputMagnitude;
    else
        outputPeakHold *= 0.97f;  // Decay factor for smooth meter movement
    outputPeakLevel.store(outputPeakHold);
}

juce::String CloudWashAudioProcessor::getQualityModeName(int index)
{
    switch (index) {
        case 0:  return "Hi-Fi Stereo (1s)";
        case 1:  return "Hi-Fi Mono (2s)";
        case 2:  return "Lo-Fi Stereo (4s)";
        case 3:  return "Lo-Fi Mono (8s)";
        case 4:  return "Ultra HQ (Long Buffer)";
        default: return "Unknown";
    }
}

//==============================================================================
juce::AudioProcessorEditor* CloudWashAudioProcessor::createEditor()
{
    CRASH_LOG("createEditor: About to create CloudWashAudioProcessorEditor...");
    auto* editor = new CloudWashAudioProcessorEditor (*this);
    CRASH_LOG("createEditor: Editor created successfully!");
    return editor;
}

bool CloudWashAudioProcessor::hasEditor() const
{
    return true;
}

//==============================================================================
void CloudWashAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml (state.createXml());
    copyXmlToBinary (*xml, destData);
}

void CloudWashAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xmlState (getXmlFromBinary (data, sizeInBytes));

    if (xmlState.get() != nullptr)
        if (xmlState->hasTagName (apvts.state.getType()))
            apvts.replaceState (juce::ValueTree::fromXml (*xmlState));
}

//==============================================================================
juce::AudioProcessorValueTreeState::ParameterLayout CloudWashAudioProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    // Core Controls
    layout.add(std::make_unique<juce::AudioParameterFloat>(
        "position", "Position",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.001f), 0.5f));

    layout.add(std::make_unique<juce::AudioParameterFloat>(
        "size", "Size",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.001f), 0.5f));

    // Pitch range: ±2.0 octaves (±24 semitones) to match VCV Rack
    // VCV Rack: p->pitch = clamp((params[PITCH_PARAM].getValue() + inputs[PITCH_INPUT].getVoltage()) * 12.0f, -48.0f, 48.0f);
    // Note: VCV Rack PITCH_PARAM range is -2.0 to 2.0, multiplied by 12 gives ±48 semitones max
    layout.add(std::make_unique<juce::AudioParameterFloat>(
        "pitch", "Pitch",
        juce::NormalisableRange<float>(-2.0f, 2.0f, 0.01f), 0.0f));

    layout.add(std::make_unique<juce::AudioParameterFloat>(
        "density", "Density",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.001f), 0.5f));

    layout.add(std::make_unique<juce::AudioParameterFloat>(
        "texture", "Texture",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.001f), 0.5f));

    // Input/Output Controls
    // In Gain range: 0.0 to 1.0 (normalized), default 0.8
    // This controls input level before processing (0 = silence, 1 = unity gain)
    layout.add(std::make_unique<juce::AudioParameterFloat>(
        "in_gain", "In Gain",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.001f), 0.8f));

    layout.add(std::make_unique<juce::AudioParameterFloat>(
        "blend", "Blend",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.001f), 0.5f));

    layout.add(std::make_unique<juce::AudioParameterFloat>(
        "spread", "Stereo Spread",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.001f), 0.0f));

    layout.add(std::make_unique<juce::AudioParameterFloat>(
        "feedback", "Feedback",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.001f), 0.0f));

    layout.add(std::make_unique<juce::AudioParameterFloat>(
        "reverb", "Reverb",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.001f), 0.0f));

    // Mode & State Controls
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        "mode", "Mode",
        juce::StringArray{"Granular", "Pitch", "Delay", "Spectral"}, 0));

    layout.add(std::make_unique<juce::AudioParameterBool>(
        "freeze", "Freeze", false));
    
    // Trigger parameter for grain synchronization (matches VCV Rack behavior)
    layout.add(std::make_unique<juce::AudioParameterBool>(
        "trigger", "Trigger", false));

    layout.add(std::make_unique<juce::AudioParameterChoice>(
        "quality", "Quality",
        juce::StringArray{
            "Hi-Fi Stereo (1s)", 
            "Hi-Fi Mono (2s)", 
            "Lo-Fi Stereo (4s)", 
            "Lo-Fi Mono (8s)"
        }, 0));

    layout.add(std::make_unique<juce::AudioParameterChoice>(
        "sample_mode", "Sample Mode",
        juce::StringArray{"Normal", "Reverse"}, 0));

    return layout;
}

//==============================================================================
// PRESET MANAGEMENT
//==============================================================================

void CloudWashAudioProcessor::initializePresets()
{
    presets.clear();

    // Preset 1: Init (Default)
    presets.push_back({"01 - Init", {
        {"position", 0.5f}, {"size", 0.5f}, {"pitch", 0.0f}, {"density", 0.5f}, {"texture", 0.5f},
        {"in_gain", 0.8f}, {"blend", 0.5f}, {"spread", 0.0f}, {"feedback", 0.0f}, {"reverb", 0.0f},
        {"mode", 0.0f}, {"quality", 0.0f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 2: Ethereal Cloud
    presets.push_back({"02 - Ethereal Cloud", {
        {"position", 0.7f}, {"size", 0.8f}, {"pitch", 0.505f}, {"density", 0.65f}, {"texture", 0.4f},
        {"in_gain", 0.8f}, {"blend", 0.7f}, {"spread", 0.9f}, {"feedback", 0.3f}, {"reverb", 0.6f},
        {"mode", 0.0f}, {"quality", 1.0f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 3: Grain Storm
    presets.push_back({"03 - Grain Storm", {
        {"position", 0.2f}, {"size", 0.3f}, {"pitch", 0.375f}, {"density", 0.9f}, {"texture", 0.8f},
        {"in_gain", 0.9f}, {"blend", 0.8f}, {"spread", 0.4f}, {"feedback", 0.1f}, {"reverb", 0.2f},
        {"mode", 0.0f}, {"quality", 1.0f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 4: Spectral Wash
    presets.push_back({"04 - Spectral Wash", {
        {"position", 0.5f}, {"size", 0.6f}, {"pitch", 0.5f}, {"density", 0.7f}, {"texture", 0.3f},
        {"in_gain", 0.7f}, {"blend", 1.0f}, {"spread", 0.6f}, {"feedback", 0.0f}, {"reverb", 0.5f},
        {"mode", 1.0f}, {"quality", 0.0f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 5: Lo-Fi Dream
    presets.push_back({"05 - Lo-Fi Dream", {
        {"position", 0.4f}, {"size", 0.5f}, {"pitch", 0.45f}, {"density", 0.4f}, {"texture", 0.9f},
        {"in_gain", 0.8f}, {"blend", 0.6f}, {"spread", 0.2f}, {"feedback", 0.4f}, {"reverb", 0.3f},
        {"mode", 0.0f}, {"quality", 0.67f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 6: Frozen Moment
    presets.push_back({"06 - Frozen Moment", {
        {"position", 0.5f}, {"size", 0.7f}, {"pitch", 0.5f}, {"density", 0.3f}, {"texture", 0.5f},
        {"in_gain", 0.8f}, {"blend", 0.9f}, {"spread", 0.5f}, {"feedback", 0.5f}, {"reverb", 0.7f},
        {"mode", 0.0f}, {"quality", 0.0f}, {"freeze", 1.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 7: Reverse Echo
    presets.push_back({"07 - Reverse Echo", {
        {"position", 0.3f}, {"size", 0.6f}, {"pitch", 0.5f}, {"density", 0.6f}, {"texture", 0.4f},
        {"in_gain", 0.8f}, {"blend", 0.7f}, {"spread", 0.3f}, {"feedback", 0.6f}, {"reverb", 0.4f},
        {"mode", 0.0f}, {"quality", 0.33f}, {"freeze", 0.0f}, {"sample_mode", 1.0f}
    }});

    // Preset 8: Shimmer Verb
    presets.push_back({"08 - Shimmer Verb", {
        {"position", 0.8f}, {"size", 0.9f}, {"pitch", 0.75f}, {"density", 0.5f}, {"texture", 0.2f},
        {"in_gain", 0.7f}, {"blend", 0.6f}, {"spread", 1.0f}, {"feedback", 0.2f}, {"reverb", 0.9f},
        {"mode", 0.0f}, {"quality", 0.0f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 9: Glitch Machine
    presets.push_back({"09 - Glitch Machine", {
        {"position", 0.1f}, {"size", 0.1f}, {"pitch", 0.4f}, {"density", 0.95f}, {"texture", 1.0f},
        {"in_gain", 1.0f}, {"blend", 0.9f}, {"spread", 0.1f}, {"feedback", 0.0f}, {"reverb", 0.1f},
        {"mode", 0.0f}, {"quality", 0.67f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 10: Pitch Shifter
    presets.push_back({"10 - Pitch Shifter", {
        {"position", 0.5f}, {"size", 0.4f}, {"pitch", 0.625f}, {"density", 0.5f}, {"texture", 0.5f},
        {"in_gain", 0.8f}, {"blend", 1.0f}, {"spread", 0.0f}, {"feedback", 0.0f}, {"reverb", 0.0f},
        {"mode", 0.33f}, {"quality", 0.0f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 11: Looping Delay
    presets.push_back({"11 - Looping Delay", {
        {"position", 0.5f}, {"size", 0.5f}, {"pitch", 0.5f}, {"density", 0.6f}, {"texture", 0.5f},
        {"in_gain", 0.8f}, {"blend", 0.5f}, {"spread", 0.5f}, {"feedback", 0.7f}, {"reverb", 0.3f},
        {"mode", 0.67f}, {"quality", 0.33f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 12: Ambient Pad
    presets.push_back({"12 - Ambient Pad", {
        {"position", 0.6f}, {"size", 0.85f}, {"pitch", 0.5f}, {"density", 0.45f}, {"texture", 0.3f},
        {"in_gain", 0.7f}, {"blend", 0.8f}, {"spread", 0.8f}, {"feedback", 0.4f}, {"reverb", 0.8f},
        {"mode", 0.0f}, {"quality", 0.0f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 13: Octave Up
    presets.push_back({"13 - Octave Up", {
        {"position", 0.5f}, {"size", 0.3f}, {"pitch", 0.75f}, {"density", 0.5f}, {"texture", 0.5f},
        {"in_gain", 0.8f}, {"blend", 0.8f}, {"spread", 0.0f}, {"feedback", 0.0f}, {"reverb", 0.1f},
        {"mode", 0.33f}, {"quality", 0.0f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 14: Octave Down
    presets.push_back({"14 - Octave Down", {
        {"position", 0.5f}, {"size", 0.3f}, {"pitch", 0.25f}, {"density", 0.5f}, {"texture", 0.5f},
        {"in_gain", 0.8f}, {"blend", 0.8f}, {"spread", 0.0f}, {"feedback", 0.0f}, {"reverb", 0.1f},
        {"mode", 0.33f}, {"quality", 0.0f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 15: Spectral Freeze
    presets.push_back({"15 - Spectral Freeze", {
        {"position", 0.5f}, {"size", 0.5f}, {"pitch", 0.5f}, {"density", 0.8f}, {"texture", 0.6f},
        {"in_gain", 0.7f}, {"blend", 1.0f}, {"spread", 0.7f}, {"feedback", 0.0f}, {"reverb", 0.6f},
        {"mode", 1.0f}, {"quality", 0.0f}, {"freeze", 1.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 16: Dense Texture
    presets.push_back({"16 - Dense Texture", {
        {"position", 0.4f}, {"size", 0.4f}, {"pitch", 0.48f}, {"density", 0.85f}, {"texture", 0.75f},
        {"in_gain", 0.85f}, {"blend", 0.75f}, {"spread", 0.6f}, {"feedback", 0.3f}, {"reverb", 0.4f},
        {"mode", 0.0f}, {"quality", 0.33f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 17: Sparse Grains
    presets.push_back({"17 - Sparse Grains", {
        {"position", 0.6f}, {"size", 0.8f}, {"pitch", 0.5f}, {"density", 0.2f}, {"texture", 0.6f},
        {"in_gain", 0.8f}, {"blend", 0.65f}, {"spread", 0.5f}, {"feedback", 0.2f}, {"reverb", 0.5f},
        {"mode", 0.0f}, {"quality", 0.0f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 18: Pitch Cascade
    presets.push_back({"18 - Pitch Cascade", {
        {"position", 0.3f}, {"size", 0.5f}, {"pitch", 0.35f}, {"density", 0.7f}, {"texture", 0.5f},
        {"in_gain", 0.8f}, {"blend", 0.7f}, {"spread", 0.4f}, {"feedback", 0.8f}, {"reverb", 0.5f},
        {"mode", 0.67f}, {"quality", 0.33f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 19: Resonant Delay
    presets.push_back({"19 - Resonant Delay", {
        {"position", 0.5f}, {"size", 0.6f}, {"pitch", 0.5f}, {"density", 0.6f}, {"texture", 0.4f},
        {"in_gain", 0.8f}, {"blend", 0.6f}, {"spread", 0.3f}, {"feedback", 0.9f}, {"reverb", 0.2f},
        {"mode", 0.67f}, {"quality", 0.0f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    // Preset 20: Granular Chaos
    presets.push_back({"20 - Granular Chaos", {
        {"position", 0.15f}, {"size", 0.2f}, {"pitch", 0.55f}, {"density", 1.0f}, {"texture", 0.95f},
        {"in_gain", 0.9f}, {"blend", 0.85f}, {"spread", 0.7f}, {"feedback", 0.5f}, {"reverb", 0.3f},
        {"mode", 0.0f}, {"quality", 0.67f}, {"freeze", 0.0f}, {"sample_mode", 0.0f}
    }});

    currentPresetIndex = 0;
}

void CloudWashAudioProcessor::loadPreset(int index)
{
    if (index < 0 || index >= (int)presets.size())
        return;

    const auto& preset = presets[index];

    for (const auto& [paramName, value] : preset.parameters)
    {
        auto* param = apvts.getParameter(paramName);
        if (param)
        {
            // Validate parameter value is within valid range before applying
            auto range = param->getNormalisableRange();
            float clampedValue = juce::jlimit(range.start, range.end, value);
            
            // Special handling for Choice parameters
            // The stored values are normalized (0-1), but Choice parameters
            // need to be converted to indices
            auto* choiceParam = dynamic_cast<juce::AudioParameterChoice*>(param);
            if (choiceParam)
            {
                // Convert normalized value to index
                int numChoices = choiceParam->choices.size();
                int targetIndex = juce::jlimit(0, numChoices - 1, (int)(clampedValue * numChoices + 0.5f));
                choiceParam->setValueNotifyingHost(choiceParam->convertTo0to1(targetIndex));
            }
            else
            {
                // For regular parameters, use the clamped value
                param->setValueNotifyingHost(clampedValue);
            }
        }
    }

    currentPresetIndex = index;
}

//==============================================================================
// This creates new instances of the plugin
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new CloudWashAudioProcessor();
}
