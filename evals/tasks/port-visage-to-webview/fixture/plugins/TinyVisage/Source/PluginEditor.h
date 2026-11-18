#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginProcessor.h"
#include "VisageJuceHost.h"
#include "VisageControls.h"

class TinyVisageAudioProcessorEditor : public VisagePluginEditor
{
public:
    explicit TinyVisageAudioProcessorEditor (TinyVisageAudioProcessor&);
    ~TinyVisageAudioProcessorEditor() override = default;

private:
    TinyVisageAudioProcessor& processorRef;
    VisageKnob gainKnob;
    VisageKnob mixKnob;
};
