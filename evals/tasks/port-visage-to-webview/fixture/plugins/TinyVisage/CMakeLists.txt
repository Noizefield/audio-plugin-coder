juce_add_plugin(TinyVisage
    COMPANY_NAME "Eval"
    PLUGIN_MANUFACTURER_CODE Eval
    PLUGIN_CODE Tvis
    FORMATS VST3
    PRODUCT_NAME "TinyVisage")

target_sources(TinyVisage PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp)

target_link_libraries(TinyVisage
    PRIVATE
        juce::juce_audio_utils
        visage::visage
    PUBLIC
        juce::juce_recommended_config_flags)
