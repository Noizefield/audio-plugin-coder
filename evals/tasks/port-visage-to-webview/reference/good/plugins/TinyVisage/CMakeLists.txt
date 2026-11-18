juce_add_binary_data(TinyVisageWebUI
    HEADER_NAME BinaryData.h
    NAMESPACE BinaryData
    SOURCES
        WebUI/index.html
        WebUI/js/index.js
        WebUI/js/juce/index.js)

juce_add_plugin(TinyVisage
    COMPANY_NAME "Eval"
    PLUGIN_MANUFACTURER_CODE Eval
    PLUGIN_CODE Tvis
    FORMATS VST3
    NEEDS_WEBVIEW2 TRUE
    PRODUCT_NAME "TinyVisage")

target_sources(TinyVisage PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp)

target_compile_definitions(TinyVisage
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)

target_link_libraries(TinyVisage
    PRIVATE
        TinyVisageWebUI
        juce::juce_audio_utils
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags)
