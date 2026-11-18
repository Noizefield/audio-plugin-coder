#include "PluginEditor.h"

TinyWebAudioProcessorEditor::TinyWebAudioProcessorEditor (TinyWebAudioProcessor& p)
    : AudioProcessorEditor (&p), processorRef (p)
{
    webView = std::make_unique<juce::WebBrowserComponent> (
        juce::WebBrowserComponent::Options {}
            .withNativeIntegrationEnabled()
            .withOptionsFrom (gainRelay)
            .withOptionsFrom (mixRelay));
    addAndMakeVisible (*webView);

    gainAttachment = std::make_unique<juce::WebSliderParameterAttachment> (
        *processorRef.apvts.getParameter ("gain"), gainRelay, nullptr);
    mixAttachment = std::make_unique<juce::WebSliderParameterAttachment> (
        *processorRef.apvts.getParameter ("mix"), mixRelay, nullptr);

    setSize (400, 300);
}

TinyWebAudioProcessorEditor::~TinyWebAudioProcessorEditor() = default;

void TinyWebAudioProcessorEditor::resized()
{
    webView->setBounds (getLocalBounds());
}
