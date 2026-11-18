#include "PluginProcessor.h"
#include "PluginEditor.h"

TinyVisageAudioProcessor::TinyVisageAudioProcessor()
    : AudioProcessor (BusesProperties()
                          .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                          .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
}

juce::AudioProcessorValueTreeState::ParameterLayout TinyVisageAudioProcessor::createParameterLayout()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;
    params.push_back (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { "gain", 1 }, "Gain",
        juce::NormalisableRange<float> (-24.0f, 24.0f, 0.1f), 0.0f));
    params.push_back (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { "mix", 1 }, "Mix",
        juce::NormalisableRange<float> (0.0f, 1.0f, 0.001f), 1.0f));
    return { params.begin(), params.end() };
}

juce::AudioProcessorEditor* TinyVisageAudioProcessor::createEditor()
{
    return new TinyVisageAudioProcessorEditor (*this);
}

void TinyVisageAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    const float gainLinear = juce::Decibels::decibelsToGain (apvts.getRawParameterValue ("gain")->load());
    buffer.applyGain (gainLinear);
}
