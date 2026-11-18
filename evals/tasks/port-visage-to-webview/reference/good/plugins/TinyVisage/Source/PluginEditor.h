#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"

class TinyVisageAudioProcessorEditor : public juce::AudioProcessorEditor
{
public:
    explicit TinyVisageAudioProcessorEditor (TinyVisageAudioProcessor&);
    ~TinyVisageAudioProcessorEditor() override = default;

    void resized() override;

private:
    TinyVisageAudioProcessor& processorRef;

    // Member order matters (known-issue webview-002): relays, WebView, attachments.
    juce::WebSliderRelay gainRelay { "gain" };
    juce::WebSliderRelay mixRelay { "mix" };

    std::unique_ptr<juce::WebBrowserComponent> webView;

    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> mixAttachment;
};
