#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "BinaryData.h"

//==============================================================================
CloudWashAudioProcessorEditor::CloudWashAudioProcessorEditor (CloudWashAudioProcessor& p)
    : AudioProcessorEditor (&p), audioProcessor (p)
{
    DBG("CloudWash: Editor constructor started");

    //==========================================================================
    // CRITICAL: CREATION ORDER (FIXED - webview-004)
    // 1. Relays already created (member initialization)
    // 2. Create attachments FIRST (before WebView)
    // 3. Create WebBrowserComponent with proper JUCE 8 API
    // 4. addAndMakeVisible LAST
    //==========================================================================

    // CRITICAL FIX: Create parameter attachments BEFORE creating WebView
    // This prevents null pointer crashes when WebView tries to access relays
    DBG("CloudWash: Creating parameter attachments");
    positionAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("position"), positionRelay);

    sizeAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("size"), sizeRelay);

    pitchAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("pitch"), pitchRelay);

    densityAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("density"), densityRelay);

    textureAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("texture"), textureRelay);

    inGainAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("in_gain"), inGainRelay);

    blendAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("blend"), blendRelay);

    spreadAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("spread"), spreadRelay);

    feedbackAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("feedback"), feedbackRelay);

    reverbAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("reverb"), reverbRelay);

    modeAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("mode"), modeRelay);

    freezeAttachment = std::make_unique<juce::WebToggleButtonParameterAttachment>(
        *audioProcessor.apvts.getParameter("freeze"), freezeRelay);

    qualityAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("quality"), qualityRelay);

    sampleModeAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.apvts.getParameter("sample_mode"), sampleModeRelay);

    // Create WebBrowserComponent with JUCE 8 proper API
    // CRITICAL: Attachments must be created BEFORE this point
    DBG("CloudWash: Creating WebView");
    webView = std::make_unique<juce::WebBrowserComponent>(
        juce::WebBrowserComponent::Options{}
            .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
            .withWinWebView2Options(
                juce::WebBrowserComponent::Options::WinWebView2{}
                    .withUserDataFolder(juce::File::getSpecialLocation(juce::File::SpecialLocationType::tempDirectory))
            )
            .withNativeIntegrationEnabled()  // CRITICAL: Enable window.__JUCE__ backend
            .withResourceProvider([this](const auto& url) { return getResource(url); })
            .withOptionsFrom(positionRelay)
            .withOptionsFrom(sizeRelay)
            .withOptionsFrom(pitchRelay)
            .withOptionsFrom(densityRelay)
            .withOptionsFrom(textureRelay)
            .withOptionsFrom(inGainRelay)
            .withOptionsFrom(blendRelay)
            .withOptionsFrom(spreadRelay)
            .withOptionsFrom(feedbackRelay)
            .withOptionsFrom(reverbRelay)
            .withOptionsFrom(modeRelay)
            .withOptionsFrom(freezeRelay)
            .withOptionsFrom(qualityRelay)
            .withOptionsFrom(sampleModeRelay)
            .withEventListener("openExternalURL", [this](const juce::var& event) {
                // Extract URL from event data
                if (event.hasProperty(juce::Identifier("url")))
                {
                    juce::String url = event.getProperty(juce::Identifier("url"), juce::var()).toString();
                    openExternalURL(url);
                }
            })
    );

    // CRITICAL: addAndMakeVisible AFTER attachments are created
    DBG("CloudWash: Adding WebView to component");
    addAndMakeVisible(*webView);

    // Load web content via resource provider
    DBG("CloudWash: Loading web content");
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());

    // Set editor size to match WebView UI design (800x500)
    DBG("CloudWash: Setting editor size");
    setSize (800, 500);

    // Start timer for meter and visualization updates (30 Hz)
    DBG("CloudWash: Starting timer");
    startTimerHz(30);

#if JUCE_DEBUG
    DBG("Resource provider root: " + juce::WebBrowserComponent::getResourceProviderRoot());
#endif

    DBG("CloudWash: Editor constructor completed");
}

CloudWashAudioProcessorEditor::~CloudWashAudioProcessorEditor()
{
    // Stop timer before destruction
    stopTimer();

    // Destruction happens in reverse order of declaration:
    // 1. Attachments destroyed first (good - they reference relays)
    // 2. WebView destroyed next (good - it references relays)
    // 3. Relays destroyed last (good - nothing references them anymore)
}

//==============================================================================
void CloudWashAudioProcessorEditor::paint (juce::Graphics& g)
{
    // WebView fills entire area, no custom painting needed
    g.fillAll (juce::Colours::black);
}

void CloudWashAudioProcessorEditor::resized()
{
    // WebView fills entire editor area
    if (webView)
        webView->setBounds(getLocalBounds());
}

//==============================================================================
void CloudWashAudioProcessorEditor::timerCallback()
{
    // Safety check: Don't access WebView if it's not properly initialized
    if (!webView || !webView->isVisible())
        return;

    // Get audio levels from processor (thread-safe atomics)
    float inputLevel = audioProcessor.inputPeakLevel.load();
    float outputLevel = audioProcessor.outputPeakLevel.load();

    // Get grain visualization data
    int activeGrains = audioProcessor.activeGrainCount.load();
    float density = audioProcessor.grainDensityViz.load();
    float texture = audioProcessor.grainTextureViz.load();

    // Send data to JavaScript via evaluateJavascript
    // Wrap in try-catch to handle potential WebView errors gracefully
    try
    {
        // Update meters
        juce::String metersJS = "if (window.updateMeters) { window.updateMeters(" +
                                juce::String(inputLevel, 3) + ", " +
                                juce::String(outputLevel, 3) + "); }";
        webView->evaluateJavascript(metersJS);

        // Update grain visualization
        juce::String grainVizJS = "if (window.updateGrainVisualization) { window.updateGrainVisualization(" +
                                  juce::String(activeGrains) + ", " +
                                  juce::String(density, 3) + ", " +
                                  juce::String(texture, 3) + "); }";
        webView->evaluateJavascript(grainVizJS);
    }
    catch (...)
    {
        // Silently ignore WebView errors during timer callback
        // This prevents crashes if WebView isn't fully ready
    }
}

//==============================================================================
// EXTERNAL URL HANDLER
//==============================================================================

void CloudWashAudioProcessorEditor::openExternalURL(const juce::String& url)
{
    DBG("Opening external URL: " + url);

    // Use JUCE's URL class to open in system's default browser
    juce::URL externalUrl(url);
    externalUrl.launchInDefaultBrowser();
}

//==============================================================================
// RESOURCE PROVIDER IMPLEMENTATION (RECOMMENDED PATTERN)
//==============================================================================

std::unique_ptr<juce::ZipFile> CloudWashAudioProcessorEditor::getZipFile()
{
    // Not using zip approach - using direct BinaryData iteration
    return nullptr;
}

const char* CloudWashAudioProcessorEditor::getMimeForExtension(const juce::String& extension)
{
    static const std::unordered_map<juce::String, const char*> mimeMap =
    {
        { "html", "text/html" },
        { "css",  "text/css" },
        { "js",   "text/javascript" },
        { "mjs",  "text/javascript" },
        { "json", "application/json" },
        { "png",  "image/png" },
        { "jpg",  "image/jpeg" },
        { "jpeg", "image/jpeg" },
        { "svg",  "image/svg+xml" }
    };

    auto it = mimeMap.find(extension.toLowerCase());
    if (it != mimeMap.end())
        return it->second;

    return "text/plain";
}

juce::String CloudWashAudioProcessorEditor::getExtension(juce::String filename)
{
    return filename.fromLastOccurrenceOf(".", false, false);
}

std::optional<juce::WebBrowserComponent::Resource> CloudWashAudioProcessorEditor::getResource (const juce::String& url)
{
    auto resourcePath = url.fromFirstOccurrenceOf(
        juce::WebBrowserComponent::getResourceProviderRoot(), false, false);

    // Handle root request
    if (resourcePath.isEmpty() || resourcePath == "/")
        resourcePath = "/index.html";

#if JUCE_DEBUG
    DBG("Resource requested: " + url);
    DBG("Resource path: " + resourcePath);
#endif

    // Map URL paths to BinaryData resources
    // NOTE: CMake mangles names when same filename appears in different directories
    const char* resourceData = nullptr;
    int resourceSize = 0;
    juce::String mimeType;

    auto path = resourcePath.substring(1);  // Remove leading slash

    if (path == "index.html")
    {
        resourceData = BinaryData::index_html;
        resourceSize = BinaryData::index_htmlSize;
        mimeType = "text/html";
    }
    else if (path == "js/index.js")
    {
        resourceData = BinaryData::index_js;
        resourceSize = BinaryData::index_jsSize;
        mimeType = "text/javascript";
    }
    else if (path == "js/juce/index.js")
    {
        resourceData = BinaryData::index_js2;  // Note: CMake mangles same-named files
        resourceSize = BinaryData::index_js2Size;
        mimeType = "text/javascript";
    }
    else if (path == "js/juce/check_native_interop.js")
    {
        resourceData = BinaryData::check_native_interop_js;
        resourceSize = BinaryData::check_native_interop_jsSize;
        mimeType = "text/javascript";
    }

#if JUCE_DEBUG
    if (resourceData != nullptr)
        DBG("Resource FOUND: " + path + " (" + juce::String(resourceSize) + " bytes)");
    else
        DBG("Resource NOT FOUND: " + path);
#endif

    // Convert to std::vector<std::byte> (JUCE 8 requirement)
    if (resourceData != nullptr && resourceSize > 0)
    {
        std::vector<std::byte> data(resourceSize);
        std::memcpy(data.data(), resourceData, resourceSize);

        return juce::WebBrowserComponent::Resource {
            std::move(data),
            mimeType
        };
    }

    // Resource not found - return error page
    juce::String fallbackHtml = R"(<!DOCTYPE html>
<html>
<head>
    <title>CloudWash - Resource Not Found</title>
    <style>
        body {
            background: #1A1A2E;
            color: #fff;
            font-family: 'Segoe UI', sans-serif;
            padding: 40px;
        }
        h1 { color: #427E88; }
        code {
            background: #2A2A3E;
            padding: 2px 6px;
            border-radius: 3px;
        }
    </style>
</head>
<body>
    <h1>CloudWash - Resource Not Found</h1>
    <p>Could not load resource: <code>)" + path + R"(</code></p>
    <p>Available resources:</p>
    <ul>
        <li><code>index.html</code></li>
        <li><code>js/index.js</code></li>
        <li><code>js/juce/index.js</code></li>
        <li><code>js/juce/check_native_interop.js</code></li>
    </ul>
</body>
</html>)";

    std::vector<std::byte> fallbackData((size_t)fallbackHtml.length());
    std::memcpy(fallbackData.data(), fallbackHtml.toRawUTF8(), (size_t)fallbackHtml.length());

    return juce::WebBrowserComponent::Resource {
        std::move(fallbackData),
        "text/html"
    };
}
