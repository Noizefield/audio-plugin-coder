#include "PluginEditor.h"
#include "PluginProcessor.h"

ClapSmokeTestEditor::ClapSmokeTestEditor (ClapSmokeTestProcessor& p)
    : AudioProcessorEditor (&p), processorRef (p)
{
    gainSlider.setSliderStyle (juce::Slider::RotaryHorizontalVerticalDrag);
    gainSlider.setTextBoxStyle (juce::Slider::TextBoxBelow, false, 80, 20);
    addAndMakeVisible (gainSlider);
    gainAttachment = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment> (
        processorRef.apvts, "gain", gainSlider);

    setSize (300, 200);
}

void ClapSmokeTestEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff202020));
    g.setColour (juce::Colours::white);
    g.setFont (16.0f);
    g.drawText ("ClapSmokeTest", getLocalBounds().removeFromTop (30), juce::Justification::centred);
}

void ClapSmokeTestEditor::resized()
{
    gainSlider.setBounds (getLocalBounds().reduced (40).withTrimmedTop (30));
}
