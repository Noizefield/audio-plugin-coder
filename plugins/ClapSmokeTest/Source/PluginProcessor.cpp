#include "PluginProcessor.h"
#include "PluginEditor.h"

ClapSmokeTestProcessor::ClapSmokeTestProcessor()
    : AudioProcessor (BusesProperties()
                          .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                          .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
}

juce::AudioProcessorValueTreeState::ParameterLayout ClapSmokeTestProcessor::createParameterLayout()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;
    params.push_back (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { "gain", 1 }, "Gain",
        juce::NormalisableRange<float> (-60.0f, 12.0f, 0.1f), 0.0f,
        juce::String(), juce::AudioProcessorParameter::genericParameter,
        [] (float v, int) { return juce::String (v, 1) + " dB"; }));
    return { params.begin(), params.end() };
}

void ClapSmokeTestProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    juce::dsp::ProcessSpec spec { sampleRate, (juce::uint32) samplesPerBlock, (juce::uint32) getTotalNumOutputChannels() };
    gain.prepare (spec);
    gain.setRampDurationSeconds (0.02);
}

bool ClapSmokeTestProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    return layouts.getMainOutputChannelSet() == layouts.getMainInputChannelSet()
        && ! layouts.getMainInputChannelSet().isDisabled();
}

void ClapSmokeTestProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    gain.setGainDecibels (apvts.getRawParameterValue ("gain")->load());
    juce::dsp::AudioBlock<float> block (buffer);
    gain.process (juce::dsp::ProcessContextReplacing<float> (block));
}

juce::AudioProcessorEditor* ClapSmokeTestProcessor::createEditor()
{
    return new ClapSmokeTestEditor (*this);
}

void ClapSmokeTestProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    if (auto xml = apvts.copyState().createXml())
        copyXmlToBinary (*xml, destData);
}

void ClapSmokeTestProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    if (auto xml = getXmlFromBinary (data, sizeInBytes))
        if (xml->hasTagName (apvts.state.getType()))
            apvts.replaceState (juce::ValueTree::fromXml (*xml));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new ClapSmokeTestProcessor();
}
