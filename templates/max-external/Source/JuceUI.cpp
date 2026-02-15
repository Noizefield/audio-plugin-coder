#include <juce_gui_basics/juce_gui_basics.h>
#include "JuceDSP.h"

class JuceUI : public juce::AudioProcessorEditor
{
public:
    JuceUI(JuceDSP& processor)
        : AudioProcessorEditor(processor)
    {
        setSize(400, 300); // Set default size for the component
    }

    ~JuceUI() override = default;

    void paint(juce::Graphics& g) override
    {
        g.fillAll(juce::Colours::darkgrey);
        g.setColour(juce::Colours::white);
        g.setFont(24.0f);
        g.drawFittedText("JUCE Max Bridge", getLocalBounds(), juce::Justification::centred, 1);
    }

    void resized() override
    {
        // Layout components here
    }

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(JuceUI)
};

// Implementation of factory method from JuceDSP.h
juce::AudioProcessorEditor* JuceDSP::createEditor()
{
    return new JuceUI(*this);
}
