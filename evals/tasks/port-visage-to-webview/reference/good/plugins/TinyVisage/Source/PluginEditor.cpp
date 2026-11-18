#include "PluginEditor.h"
#include "BinaryData.h"

namespace
{
std::optional<juce::WebBrowserComponent::Resource> getResource (const juce::String& url)
{
    const auto path = url == "/" ? juce::String ("index.html") : url.fromFirstOccurrenceOf ("/", false, false);
    int size = 0;
    if (const char* data = BinaryData::getNamedResource (path.replaceCharacter ('.', '_').replaceCharacter ('/', '_').toRawUTF8(), size))
        return juce::WebBrowserComponent::Resource { std::vector<std::byte> ((const std::byte*) data, (const std::byte*) data + size),
                                                     juce::String ("text/html") };
    return std::nullopt;
}
}

TinyVisageAudioProcessorEditor::TinyVisageAudioProcessorEditor (TinyVisageAudioProcessor& p)
    : AudioProcessorEditor (&p), processorRef (p)
{
    webView = std::make_unique<juce::WebBrowserComponent> (
        juce::WebBrowserComponent::Options {}
            .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
            .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2 {}
                .withUserDataFolder (juce::File::getSpecialLocation (juce::File::tempDirectory)))
            .withNativeIntegrationEnabled()
            .withResourceProvider ([] (const juce::String& url) { return getResource (url); })
            .withOptionsFrom (gainRelay)
            .withOptionsFrom (mixRelay));
    addAndMakeVisible (*webView);

    gainAttachment = std::make_unique<juce::WebSliderParameterAttachment> (
        *processorRef.apvts.getParameter ("gain"), gainRelay, nullptr);
    mixAttachment = std::make_unique<juce::WebSliderParameterAttachment> (
        *processorRef.apvts.getParameter ("mix"), mixRelay, nullptr);

    webView->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
    setSize (400, 300);
}

void TinyVisageAudioProcessorEditor::resized()
{
    webView->setBounds (getLocalBounds());
}
