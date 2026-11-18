// COMPILE-CHECK ONLY. This translation unit instantiates the real wiring from templates/webview
// (relays -> ApcBridge -> WebBrowserComponent -> attachments member order, addApcNativeFunctions, attach) so the
// compiler proves it against the JUCE 9 headers. Nothing here is ever executed: a WebBrowserComponent needs a real
// WebView2/WKWebView/WebKitGTK, a message loop and a window. See .agents/guides/ui-kit-native.md "What is verified".
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include "apc/juce/ApcApvtsParams.h"
#include "apc/juce/ApcWebBridge.h"

namespace
{
class CheckProcessor : public juce::AudioProcessor
{
public:
    CheckProcessor()
        : juce::AudioProcessor (BusesProperties().withOutput ("Out", juce::AudioChannelSet::stereo(), true)),
          apvts (*this, nullptr, "STATE", makeLayout())
    {
        auto parsed = apc::web::ParamTable::fromJsonText (R"({"cutoff_hz":{"help":{"what":"w","effect":"e","how":"h"}}})");
        if (parsed.ok) table = std::move (parsed.value);
        params = std::make_unique<apc::web::ApvtsParams> (apvts, table);
        store = std::make_unique<apc::presets::Store> (storeConfig());
        store->setLiveState (params->liveState());
        backend.params = params.get();
        backend.presets = store.get();
    }
    ~CheckProcessor() override = default;

    static juce::AudioProcessorValueTreeState::ParameterLayout makeLayout()
    {
        juce::AudioProcessorValueTreeState::ParameterLayout l;
        l.add (std::make_unique<juce::AudioParameterFloat> (juce::ParameterID { "cutoff_hz", 1 }, "Cutoff", juce::NormalisableRange<float> (20.0f, 20000.0f, 0.0f, 0.3f), 1000.0f));
        return l;
    }
    static apc::presets::StoreConfig storeConfig()
    {
        apc::presets::StoreConfig c;
        c.layout = apc::makeHostLayout (apc::DataScope::PerUser, "Acme", "CheckPlugin");
        c.flat = true; c.presetExt = ".preset"; c.pluginName = "CheckPlugin";
        return c;
    }

    const juce::String getName() const override { return "Check"; }
    void prepareToPlay (double, int) override {}
    void releaseResources() override {}
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override {}
    juce::AudioProcessorEditor* createEditor() override { return nullptr; }
    bool hasEditor() const override { return true; }
    double getTailLengthSeconds() const override { return 0.0; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}
    void getStateInformation (juce::MemoryBlock& dest) override
    {
        // the chunk is the apc-preset/1.0 document (see ApcPresetStore::serializeChunk)
        const auto r = store->serializeChunk();
        if (r.ok) dest.append (r.value.data(), r.value.size());
    }
    void setStateInformation (const void* data, int size) override
    {
        if (apc::presets::Store::looksLikeChunk (data, (std::size_t) size)) store->restoreChunk (data, (std::size_t) size);
    }

    juce::AudioProcessorValueTreeState apvts;
    apc::web::ParamTable table;
    std::unique_ptr<apc::web::ApvtsParams> params;
    std::unique_ptr<apc::presets::Store> store;
    apc::web::ApcBackend backend;
};

// Member order is the contract (webview-member-order-crash): relays -> bridge -> webView -> attachments.
class CheckEditor : public juce::AudioProcessorEditor
{
public:
    explicit CheckEditor (CheckProcessor& p)
        : juce::AudioProcessorEditor (&p), proc (p), apcBridge (p.backend)
    {
        auto options = juce::WebBrowserComponent::Options()
                           .withNativeIntegrationEnabled()
                           .withOptionsFrom (cutoffRelay);
#if JUCE_WEB_BROWSER_RESOURCE_PROVIDER_AVAILABLE   // WebView2 static linking / WKWebView; the real template always has it
        options = std::move (options).withResourceProvider ([] (const juce::String&) -> std::optional<juce::WebBrowserComponent::Resource> { return std::nullopt; });
#endif
        webView = std::make_unique<juce::WebBrowserComponent> (apc::web::addApcNativeFunctions (std::move (options), apcBridge));
        addAndMakeVisible (*webView);
        cutoffAttachment = std::make_unique<juce::WebSliderParameterAttachment> (*proc.apvts.getParameter ("cutoff_hz"), cutoffRelay, nullptr);
        webView->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
        apcBridge.attach (*webView);   // AFTER goToURL
    }

    void resized() override { webView->setBounds (getLocalBounds()); }

private:
    CheckProcessor& proc;
    // 1. relays
    juce::WebSliderRelay cutoffRelay { "cutoff_hz" };
    // 2. kit bridge (outlives the webView that calls into it)
    apc::web::ApcBridge apcBridge;
    // 3. webView
    std::unique_ptr<juce::WebBrowserComponent> webView;
    // 4. attachments
    std::unique_ptr<juce::WebSliderParameterAttachment> cutoffAttachment;
};
} // namespace

// Referenced from main_gui.cpp so the linker keeps (and the compiler fully instantiates) everything above.
int apcCompileCheckEntry (int argc)
{
    if (argc > 1000)   // never true: this is a compile/link check, not a run
    {
        CheckProcessor proc;
        CheckEditor editor (proc);
        return editor.getWidth();
    }
    return 0;
}
