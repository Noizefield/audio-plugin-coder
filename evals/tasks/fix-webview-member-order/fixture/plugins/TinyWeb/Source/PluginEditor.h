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

    // BUG (webview-002): the WebView is declared before the relays and the
    // attachments it references, so it is destroyed AFTER them.
    std::unique_ptr<juce::WebBrowserComponent> webView;

    juce::WebSliderRelay gainRelay { "gain" };
    juce::WebSliderRelay mixRelay { "mix" };

    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> mixAttachment;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (TinyWebAudioProcessorEditor)
};
