#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "BinaryData.h"

//==============================================================================
Gnarly2AudioProcessorEditor::Gnarly2AudioProcessorEditor (Gnarly2AudioProcessor& p)
    : AudioProcessorEditor (&p), processorRef (p)
{
    DBG ("Gnarly2 Editor Constructor: START");

    // CRITICAL: Initialize in correct order (same as declaration)

    // 1. Create relays FIRST
    DBG ("Gnarly2 Editor: Creating relays...");
    driveRelay = std::make_unique<juce::WebSliderRelay> ("drive");
    cutoffRelay = std::make_unique<juce::WebSliderRelay> ("cutoff");
    resonanceRelay = std::make_unique<juce::WebSliderRelay> ("resonance");
    DBG ("Gnarly2 Editor: Relays created");

    // 2. Create WebView SECOND with relay references
    DBG ("Gnarly2 Editor: Creating WebView...");
    webView.reset (new SinglePageBrowser (createWebOptions (*this)));
    DBG ("Gnarly2 Editor: WebView created");

    // 3. Create attachments BEFORE addAndMakeVisible (CRITICAL!)
    DBG ("Gnarly2 Editor: Creating attachments...");
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
    DBG ("Gnarly2 Editor: Attachments created");

    // 4. THEN make visible
    addAndMakeVisible (*webView);
    DBG ("Gnarly2 Editor: WebView made visible");

    // 5. Load UI from resource provider
    DBG ("Gnarly2 Editor: Loading HTML from resource provider...");
    webView->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
    DBG ("Gnarly2 Editor Constructor: COMPLETE");

    setSize (400, 380);
}

Gnarly2AudioProcessorEditor::~Gnarly2AudioProcessorEditor()
{
    // Members destroyed in reverse order automatically
}

//==============================================================================
void Gnarly2AudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll (getLookAndFeel().findColour (juce::ResizableWindow::backgroundColourId));
}

void Gnarly2AudioProcessorEditor::resized()
{
    webView->setBounds (getLocalBounds());
}

//==============================================================================
juce::WebBrowserComponent::Options Gnarly2AudioProcessorEditor::createWebOptions (Gnarly2AudioProcessorEditor& editor)
{
    DBG ("Gnarly2: createWebOptions START");

    auto options = juce::WebBrowserComponent::Options{}
        .withBackend (juce::WebBrowserComponent::Options::Backend::webview2);

    DBG ("Gnarly2: Backend set to webview2");

    options = options.withWinWebView2Options (
        juce::WebBrowserComponent::Options::WinWebView2{}
            .withUserDataFolder (juce::File::getSpecialLocation (juce::File::tempDirectory)
                .getChildFile ("NPS_Gnarly2"))
    );

    DBG ("Gnarly2: WebView2 options set");

    options = options.withNativeIntegrationEnabled()
                    .withKeepPageLoadedWhenBrowserIsHidden()
                    .withResourceProvider ([&editor] (const juce::String& url) {
                        return editor.getResource (url);
                    });

    DBG ("Gnarly2: Native integration and resource provider set");

    options = options.withOptionsFrom (*editor.driveRelay)
                    .withOptionsFrom (*editor.cutoffRelay)
                    .withOptionsFrom (*editor.resonanceRelay);

    DBG ("Gnarly2: createWebOptions COMPLETE");
    return options;
}

//==============================================================================
std::optional<juce::WebBrowserComponent::Resource> Gnarly2AudioProcessorEditor::getResource (const juce::String& url)
{
    DBG ("Gnarly2 Resource Request: " + url);

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
        DBG ("Gnarly2: Serving index.html directly");
        return makeResource (gnarly2_BinaryData::index_html,
                           gnarly2_BinaryData::index_htmlSize,
                           "text/html");
    }

    DBG ("Gnarly2: Resource not found: " + url);
    return std::nullopt;
}

