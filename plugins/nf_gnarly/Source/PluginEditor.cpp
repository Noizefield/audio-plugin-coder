#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "BinaryData.h"

//==============================================================================
NfGnarlyAudioProcessorEditor::NfGnarlyAudioProcessorEditor (NfGnarlyAudioProcessor& p)
    : AudioProcessorEditor (&p), processorRef (p)
{
    DBG ("NfGnarly Editor Constructor: START");

    // CRITICAL: Initialize in correct order (same as declaration)

    // 1. Create relays FIRST
    DBG ("NfGnarly Editor: Creating relays...");
    driveRelay = std::make_unique<juce::WebSliderRelay> ("drive");
    cutoffRelay = std::make_unique<juce::WebSliderRelay> ("cutoff");
    resonanceRelay = std::make_unique<juce::WebSliderRelay> ("resonance");
    DBG ("NfGnarly Editor: Relays created");

    // 2. Create WebView SECOND with relay references
    DBG ("NfGnarly Editor: Creating WebView...");
    webView.reset (new SinglePageBrowser (createWebOptions (*this)));
    DBG ("NfGnarly Editor: WebView created");

    // 3. Create attachments BEFORE addAndMakeVisible (CRITICAL!)
    DBG ("NfGnarly Editor: Creating attachments...");
    driveAttachment = std::make_unique<juce::WebSliderParameterAttachment> (
        *processorRef.parameters.getParameter ("drive"),
        *driveRelay,
        nullptr
    );

    cutoffAttachment = std::make_unique<juce::WebSliderParameterAttachment> (
        *processorRef.parameters.getParameter ("cutoff"),
        *cutoffRelay,
        nullptr
    );

    resonanceAttachment = std::make_unique<juce::WebSliderParameterAttachment> (
        *processorRef.parameters.getParameter ("resonance"),
        *resonanceRelay,
        nullptr
    );
    DBG ("NfGnarly Editor: Attachments created");

    // 4. THEN make visible
    addAndMakeVisible (*webView);
    DBG ("NfGnarly Editor: WebView made visible");

    // 5. Load UI from resource provider
    DBG ("NfGnarly Editor: Loading HTML from resource provider...");
    webView->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
    DBG ("NfGnarly Editor Constructor: COMPLETE");

    setSize (400, 380);
}

NfGnarlyAudioProcessorEditor::~NfGnarlyAudioProcessorEditor()
{
    // Members destroyed in reverse order automatically
}

//==============================================================================
void NfGnarlyAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll (getLookAndFeel().findColour (juce::ResizableWindow::backgroundColourId));
}

void NfGnarlyAudioProcessorEditor::resized()
{
    webView->setBounds (getLocalBounds());
}

//==============================================================================
juce::WebBrowserComponent::Options NfGnarlyAudioProcessorEditor::createWebOptions (NfGnarlyAudioProcessorEditor& editor)
{
    DBG ("NfGnarly: createWebOptions START");

    auto options = juce::WebBrowserComponent::Options{}
        .withBackend (juce::WebBrowserComponent::Options::Backend::webview2);

    DBG ("NfGnarly: Backend set to webview2");

    options = options.withWinWebView2Options (
        juce::WebBrowserComponent::Options::WinWebView2{}
            .withUserDataFolder (juce::File::getSpecialLocation (juce::File::tempDirectory)
                .getChildFile ("NPS_NfGnarly"))
    );

    DBG ("NfGnarly: WebView2 options set");

    options = options.withNativeIntegrationEnabled()
                    .withKeepPageLoadedWhenBrowserIsHidden()
                    .withResourceProvider ([&editor] (const juce::String& url) {
                        return editor.getResource (url);
                    });

    DBG ("NfGnarly: Native integration and resource provider set");

    options = options.withOptionsFrom (*editor.driveRelay)
                    .withOptionsFrom (*editor.cutoffRelay)
                    .withOptionsFrom (*editor.resonanceRelay);

    DBG ("NfGnarly: createWebOptions COMPLETE");
    return options;
}

//==============================================================================
std::optional<juce::WebBrowserComponent::Resource> NfGnarlyAudioProcessorEditor::getResource (const juce::String& url)
{
    DBG ("NfGnarly Resource Request: " + url);

    auto makeResource = [] (const char* data, int size, const char* mime)
    {
        return juce::WebBrowserComponent::Resource {
            std::vector<std::byte> (reinterpret_cast<const std::byte*> (data),
                                   reinterpret_cast<const std::byte*> (data) + size),
            juce::String (mime)
        };
    };

    // Direct access to index.html (like ExamplePlugin)
    if (url.isEmpty() || url == "/" || url == "/index.html")
    {
        DBG ("NfGnarly: Serving index.html directly");
        return makeResource (nf_gnarly_BinaryData::index_html,
                           nf_gnarly_BinaryData::index_htmlSize,
                           "text/html");
    }

    DBG ("NfGnarly: Resource not found: " + url);
    return std::nullopt;
}

