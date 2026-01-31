#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"

//==============================================================================
/**
 * CloudWash Plugin Editor - WebView UI Integration
 *
 * CRITICAL: Member declaration order MUST be:
 * 1. Parameter relays (destroyed last)
 * 2. WebBrowserComponent (destroyed middle)
 * 3. Parameter attachments (destroyed first)
 *
 * This order prevents DAW crashes on plugin unload.
 */
class CloudWashAudioProcessorEditor : public juce::AudioProcessorEditor,
                                       public juce::Timer
{
public:
    CloudWashAudioProcessorEditor (CloudWashAudioProcessor&);
    ~CloudWashAudioProcessorEditor() override;

    //==============================================================================
    void paint (juce::Graphics&) override;
    void resized() override;

    //==============================================================================
    // Timer callback for updating meters and visualization
    void timerCallback() override;

private:
    //==============================================================================
    // CRITICAL: MEMBER DECLARATION ORDER
    // DO NOT REORDER - This prevents DAW crash on unload
    //==============================================================================

    // 1. PARAMETER RELAYS (Destroyed last)
    juce::WebSliderRelay positionRelay { "position" };
    juce::WebSliderRelay sizeRelay { "size" };
    juce::WebSliderRelay pitchRelay { "pitch" };
    juce::WebSliderRelay densityRelay { "density" };
    juce::WebSliderRelay textureRelay { "texture" };
    juce::WebSliderRelay inGainRelay { "in_gain" };
    juce::WebSliderRelay blendRelay { "blend" };
    juce::WebSliderRelay spreadRelay { "spread" };
    juce::WebSliderRelay feedbackRelay { "feedback" };
    juce::WebSliderRelay reverbRelay { "reverb" };
    juce::WebSliderRelay modeRelay { "mode" };
    juce::WebToggleButtonRelay freezeRelay { "freeze" };
    juce::WebSliderRelay qualityRelay { "quality" };
    juce::WebSliderRelay sampleModeRelay { "sample_mode" };

    // 2. WEBBROWSERCOMPONENT (Destroyed middle)
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. PARAMETER ATTACHMENTS (Destroyed first)
    std::unique_ptr<juce::WebSliderParameterAttachment> positionAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> sizeAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> pitchAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> densityAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> textureAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> inGainAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> blendAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> spreadAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> feedbackAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> reverbAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> modeAttachment;
    std::unique_ptr<juce::WebToggleButtonParameterAttachment> freezeAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> qualityAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> sampleModeAttachment;

    //==============================================================================
    // Resource provider for embedded web files
    std::optional<juce::WebBrowserComponent::Resource> getResource (const juce::String& url);
    std::unique_ptr<juce::ZipFile> getZipFile();

    // Helper functions for resource provider
    static const char* getMimeForExtension(const juce::String& extension);
    static juce::String getExtension(juce::String filename);

    // External URL handler for logo link
    void openExternalURL(const juce::String& url);

    // Reference to processor
    CloudWashAudioProcessor& audioProcessor;

    //==============================================================================
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (CloudWashAudioProcessorEditor)
};
