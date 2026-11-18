#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"

class TinyWebAudioProcessorEditor : public juce::AudioProcessorEditor
{
public:
    explicit TinyWebAudioProcessorEditor (TinyWebAudioProcessor&);
    ~TinyWebAudioProcessorEditor() override;

    void resized() override;

private:
    TinyWebAudioProcessor& processorRef;

    // Known-bad reference: a half fix. One attachment was moved above the
    // WebView, so it is still destroyed after the WebView it points into.
    juce::WebSliderRelay gainRelay { "gain" };
    juce::WebSliderRelay mixRelay { "mix" };

    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;

    std::unique_ptr<juce::WebBrowserComponent> webView;

    std::unique_ptr<juce::WebSliderParameterAttachment> mixAttachment;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (TinyWebAudioProcessorEditor)
};
