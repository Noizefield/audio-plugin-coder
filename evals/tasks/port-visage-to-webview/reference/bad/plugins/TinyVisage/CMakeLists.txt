juce_add_binary_data(TinyVisageWebUI
    HEADER_NAME BinaryData.h
    NAMESPACE BinaryData
    SOURCES WebUI/index.html)

# Known-bad reference: CMake half-converted (still links visage::visage), the
# editor/status.json/VisageControls.h are untouched, and the web UI uses a linked
# stylesheet plus an ES module -- both fail in JUCE WebView.
juce_add_plugin(TinyVisage
    COMPANY_NAME "Eval"
    PLUGIN_MANUFACTURER_CODE Eval
    PLUGIN_CODE Tvis
    FORMATS VST3
    NEEDS_WEBVIEW2 TRUE
    PRODUCT_NAME "TinyVisage")

target_compile_definitions(TinyVisage PUBLIC JUCE_WEB_BROWSER=1)

target_link_libraries(TinyVisage
    PRIVATE
        TinyVisageWebUI
        juce::juce_audio_utils
        juce::juce_gui_extra
        visage::visage
    PUBLIC
        juce::juce_recommended_config_flags)
