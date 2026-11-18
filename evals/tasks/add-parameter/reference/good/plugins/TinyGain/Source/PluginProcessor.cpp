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
    params.push_back (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { "drive", 1 }, "Drive",
        juce::NormalisableRange<float> (0.0f, 1.0f, 0.001f), 0.0f));
    return { params.begin(), params.end() };
}

void TinyGainAudioProcessor::prepareToPlay (double, int)
{
}

void TinyGainAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    const float gainLinear = juce::Decibels::decibelsToGain (apvts.getRawParameterValue ("gain")->load());
    const float drive = apvts.getRawParameterValue ("drive")->load();

    for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
    {
        auto* data = buffer.getWritePointer (ch);
        for (int i = 0; i < buffer.getNumSamples(); ++i)
        {
            const float x = data[i] * gainLinear;
            data[i] = juce::jmap (drive, x, std::tanh (x * (1.0f + 4.0f * drive)));
        }
    }
}
