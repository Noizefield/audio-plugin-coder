#include "PluginProcessor.h"
#include "PluginEditor.h"

//==============================================================================
Gnarly2AudioProcessor::Gnarly2AudioProcessor()
    : AudioProcessor (BusesProperties()
                     .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                     .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      parameters (*this, nullptr, juce::Identifier ("Gnarly2"), createParameterLayout())
{
}

Gnarly2AudioProcessor::~Gnarly2AudioProcessor()
{
}

//==============================================================================
juce::AudioProcessorValueTreeState::ParameterLayout Gnarly2AudioProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    // Drive parameter: -24dB to +24dB, linear
    layout.add (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { "drive", 1 },
        "Drive",
        juce::NormalisableRange<float> (-24.0f, 24.0f, 0.1f),
        0.0f,
        juce::String(),
        juce::AudioProcessorParameter::genericParameter,
        [](float value, int) { return juce::String (value, 1) + " dB"; }
    ));

    // Cutoff parameter: 20Hz to 20kHz, logarithmic (0.3 skew = better response)
    layout.add (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { "cutoff", 1 },
        "Cutoff",
        juce::NormalisableRange<float> (20.0f, 20000.0f, 0.01f, 0.3f),  // Smaller step, standard log skew
        1000.0f,
        juce::String(),
        juce::AudioProcessorParameter::genericParameter,
        [](float value, int) {
            if (value >= 1000.0f)
                return juce::String (value / 1000.0f, 1) + " kHz";
            else
                return juce::String (value, 0) + " Hz";
        }
    ));

    // Resonance parameter: 0.0 to 1.0, linear
    layout.add (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { "resonance", 1 },
        "Resonance",
        juce::NormalisableRange<float> (0.0f, 1.0f, 0.01f),
        0.0f,
        juce::String(),
        juce::AudioProcessorParameter::genericParameter,
        [](float value, int) { return juce::String (value, 2); }
    ));

    return layout;
}

//==============================================================================
const juce::String Gnarly2AudioProcessor::getName() const
{
    return JucePlugin_Name;
}

bool Gnarly2AudioProcessor::acceptsMidi() const
{
    return false;
}

bool Gnarly2AudioProcessor::producesMidi() const
{
    return false;
}

bool Gnarly2AudioProcessor::isMidiEffect() const
{
    return false;
}

double Gnarly2AudioProcessor::getTailLengthSeconds() const
{
    return 0.0;
}

int Gnarly2AudioProcessor::getNumPrograms()
{
    return 1;
}

int Gnarly2AudioProcessor::getCurrentProgram()
{
    return 0;
}

void Gnarly2AudioProcessor::setCurrentProgram (int index)
{
    juce::ignoreUnused (index);
}

const juce::String Gnarly2AudioProcessor::getProgramName (int index)
{
    juce::ignoreUnused (index);
    return {};
}

void Gnarly2AudioProcessor::changeProgramName (int index, const juce::String& newName)
{
    juce::ignoreUnused (index, newName);
}

//==============================================================================
void Gnarly2AudioProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    currentSampleRate = sampleRate;

    juce::dsp::ProcessSpec spec;
    spec.sampleRate = sampleRate;
    spec.maximumBlockSize = static_cast<juce::uint32> (samplesPerBlock);
    spec.numChannels = 2;  // Force stereo processing (ProcessorDuplicator creates one filter per channel)

    driveGain.prepare (spec);
    filter.prepare (spec);

    // Set fast ramping for responsive controls (10ms to prevent zipper noise)
    driveGain.setRampDurationSeconds (0.010);  // 10ms - instant feel, no zipper
}

void Gnarly2AudioProcessor::releaseResources()
{
}

bool Gnarly2AudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    if (layouts.getMainOutputChannelSet() != juce::AudioChannelSet::mono()
     && layouts.getMainOutputChannelSet() != juce::AudioChannelSet::stereo())
        return false;

    if (layouts.getMainOutputChannelSet() != layouts.getMainInputChannelSet())
        return false;

    return true;
}

void Gnarly2AudioProcessor::processBlock (juce::AudioBuffer<float>& buffer,
                                           juce::MidiBuffer& midiMessages)
{
    juce::ignoreUnused (midiMessages);
    juce::ScopedNoDenormals noDenormals;

    auto totalNumInputChannels  = getTotalNumInputChannels();
    auto totalNumOutputChannels = getTotalNumOutputChannels();

    // Clear extra output channels
    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        buffer.clear (i, 0, buffer.getNumSamples());

    // Handle zero-length buffers
    if (buffer.getNumSamples() == 0)
        return;

    // Get parameter values for fast response
    const float drive = parameters.getRawParameterValue ("drive")->load();
    const float cutoff = parameters.getRawParameterValue ("cutoff")->load();
    const float resonance = parameters.getRawParameterValue ("resonance")->load();

    // Apply drive gain (has internal 10ms ramping)
    driveGain.setGainDecibels (drive);

    // Map resonance (0.0-1.0) to Q (0.7-50)
    const float q = 0.7f + resonance * 49.3f;

    // Update filter coefficients for instant response
    *filter.state = *juce::dsp::IIR::Coefficients<float>::makeLowPass (
        currentSampleRate,
        juce::jlimit (20.0f, 20000.0f, cutoff),
        juce::jlimit (0.1f, 50.0f, q)
    );

    // Process audio - ProcessorDuplicator ensures both channels are processed
    juce::dsp::AudioBlock<float> block (buffer);
    juce::dsp::ProcessContextReplacing<float> context (block);

    driveGain.process (context);
    filter.process (context);
}

//==============================================================================
bool Gnarly2AudioProcessor::hasEditor() const
{
    return true;
}

juce::AudioProcessorEditor* Gnarly2AudioProcessor::createEditor()
{
    return new Gnarly2AudioProcessorEditor (*this);
}

//==============================================================================
void Gnarly2AudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = parameters.copyState();
    std::unique_ptr<juce::XmlElement> xml (state.createXml());
    copyXmlToBinary (*xml, destData);
}

void Gnarly2AudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xmlState (getXmlFromBinary (data, sizeInBytes));

    if (xmlState.get() != nullptr)
        if (xmlState->hasTagName (parameters.state.getType()))
            parameters.replaceState (juce::ValueTree::fromXml (*xmlState));
}

//==============================================================================
// This creates new instances of the plugin
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new Gnarly2AudioProcessor();
}
