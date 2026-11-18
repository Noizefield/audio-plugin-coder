#include "PluginProcessor.h"

TinyGainAudioProcessor::TinyGainAudioProcessor()
    : AudioProcessor (BusesProperties()
                          .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                          .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
}

juce::AudioProcessorValueTreeState::ParameterLayout TinyGainAudioProcessor::createParameterLayout()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;
    params.push_back (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { "gain", 1 }, "Gain",
        juce::NormalisableRange<float> (-24.0f, 24.0f, 0.1f), 0.0f));
    return { params.begin(), params.end() };
}

void TinyGainAudioProcessor::prepareToPlay (double, int)
{
}

void TinyGainAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    const float gainLinear = juce::Decibels::decibelsToGain (apvts.getRawParameterValue ("gain")->load());

    for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        buffer.applyGain (ch, 0, buffer.getNumSamples(), gainLinear);
}
