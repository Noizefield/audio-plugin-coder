#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

class ClapSmokeTestProcessor;

class ClapSmokeTestEditor : public juce::AudioProcessorEditor
{
public:
    explicit ClapSmokeTestEditor (ClapSmokeTestProcessor&);
    ~ClapSmokeTestEditor() override = default;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    ClapSmokeTestProcessor& processorRef;
    juce::Slider gainSlider;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> gainAttachment;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (ClapSmokeTestEditor)
};
