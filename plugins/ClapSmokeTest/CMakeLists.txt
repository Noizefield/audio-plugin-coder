# ClapSmokeTest - Minimal pass-through gain plugin used to smoke-test the CLAP integration
#
# Generated from templates/CMakeLists.txt.template with CLAP opted in
# (status.json -> formats.clap).

if(WIN32)
    set(PLUGIN_FORMATS VST3 Standalone)
    set(NEEDS_WEBVIEW2 FALSE)
elseif(APPLE)
    set(PLUGIN_FORMATS VST3 AU Standalone)
    set(NEEDS_WEBVIEW2 FALSE)
    set(AU_MAIN_TYPE kAudioUnitType_Effect)
elseif(UNIX)
    set(PLUGIN_FORMATS VST3 LV2 Standalone)
    set(NEEDS_WEBVIEW2 FALSE)
    set(LV2_URI "https://github.com/noizefield/audio-plugin-coder/ClapSmokeTest")
else()
    message(FATAL_ERROR "Unsupported platform")
endif()

message(STATUS "ClapSmokeTest: Building for ${PLUGIN_FORMATS}")

juce_add_plugin(ClapSmokeTest
    COMPANY_NAME "Noizefield"
    PLUGIN_MANUFACTURER_CODE Noiz
    PLUGIN_CODE Csmk
    FORMATS ${PLUGIN_FORMATS}
    PRODUCT_NAME "ClapSmokeTest"
    NEEDS_WEBVIEW2 ${NEEDS_WEBVIEW2}
    VST3_CATEGORIES Fx
    AU_MAIN_TYPE ${AU_MAIN_TYPE}
    LV2URI ${LV2_URI}
)

# ============================================
# CLAP FORMAT (opt-in: status.json -> formats.clap = true)
# ============================================
option(ClapSmokeTest_ENABLE_CLAP "Build ClapSmokeTest in CLAP format" ON)
if(ClapSmokeTest_ENABLE_CLAP AND COMMAND clap_juce_extensions_plugin)
    clap_juce_extensions_plugin(TARGET ClapSmokeTest
        CLAP_ID "com.noizefield.clapsmoketest"
        CLAP_FEATURES audio-effect)
endif()

target_sources(ClapSmokeTest
    PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
)

target_include_directories(ClapSmokeTest
    PRIVATE
        Source
)

target_link_libraries(ClapSmokeTest
    PRIVATE
        juce::juce_audio_basics
        juce::juce_audio_devices
        juce::juce_audio_formats
        juce::juce_audio_plugin_client
        juce::juce_audio_processors
        juce::juce_audio_utils
        juce::juce_core
        juce::juce_data_structures
        juce::juce_dsp
        juce::juce_events
        juce::juce_graphics
        juce::juce_gui_basics
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)

target_compile_definitions(ClapSmokeTest
    PUBLIC
        JUCE_WEB_BROWSER=0
        JUCE_VST3_CAN_REPLACE_VST2=0
        _USE_MATH_DEFINES=1
)

if(APPLE)
    target_compile_definitions(ClapSmokeTest
        PUBLIC
            JUCE_USE_CURL=0
    )
    set_target_properties(ClapSmokeTest PROPERTIES
        XCODE_ATTRIBUTE_ARCHS "x86_64;arm64"
        XCODE_ATTRIBUTE_ONLY_ACTIVE_ARCH NO
    )
endif()

if(UNIX AND NOT APPLE)
    target_compile_definitions(ClapSmokeTest
        PUBLIC
            JUCE_USE_CURL=0
            JUCE_JACK=1
    )
endif()
