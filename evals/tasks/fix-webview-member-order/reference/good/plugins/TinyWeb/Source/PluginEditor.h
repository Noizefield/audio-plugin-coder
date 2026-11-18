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

    // Destruction runs bottom-to-top: attachments, then the WebView, then relays.
    // 1. Relays
    juce::WebSliderRelay gainRelay { "gain" };
    juce::WebSliderRelay mixRelay { "mix" };

    // 2. WebView
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. Attachments
    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> mixAttachment;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (TinyWebAudioProcessorEditor)
};
