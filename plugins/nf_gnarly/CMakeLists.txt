# NF Gnarly Plugin
# Cross-platform: Windows (VST3), macOS (VST3/AU), Linux (VST3/LV2)

# ============================================
# PLATFORM-SPECIFIC CONFIGURATION
# ============================================
if(WIN32)
    set(PLUGIN_FORMATS VST3 Standalone)
    set(NEEDS_WEBVIEW2 TRUE)
    set(WEBVIEW_BACKEND "WebView2")
elseif(APPLE)
    set(PLUGIN_FORMATS VST3 AU Standalone)
    set(NEEDS_WEBVIEW2 FALSE)
    set(WEBVIEW_BACKEND "WKWebView")
    set(AU_MAIN_TYPE kAudioUnitType_Effect)
elseif(UNIX)
    set(PLUGIN_FORMATS VST3 LV2 Standalone)
    set(NEEDS_WEBVIEW2 FALSE)
    set(NEEDS_WEB_BROWSER TRUE)
    set(WEBVIEW_BACKEND "WebKitGTK")
    set(LV2_URI "https://github.com/noizefield/audio-plugin-coder/nf_gnarly")
else()
    message(FATAL_ERROR "Unsupported platform")
endif()

message(STATUS "NF Gnarly: Building for ${PLUGIN_FORMATS}")
message(STATUS "NF Gnarly: WebView backend: ${WEBVIEW_BACKEND}")

# ============================================
# BINARY DATA (Web UI Resources)
# ============================================
juce_add_binary_data(nf_gnarly_WebUI
    SOURCES
        Source/ui/public/index.html
    NAMESPACE nf_gnarly_BinaryData
)

# ============================================
# PLUGIN DEFINITION
# ============================================
juce_add_plugin(nf_gnarly
    COMPANY_NAME "NPS"
    PLUGIN_MANUFACTURER_CODE NPS0
    PLUGIN_CODE Nfgn
    FORMATS ${PLUGIN_FORMATS}
    PRODUCT_NAME "NF Gnarly"
    NEEDS_WEBVIEW2 ${NEEDS_WEBVIEW2}
    NEEDS_WEB_BROWSER ${NEEDS_WEB_BROWSER}
    VST3_CATEGORIES Fx
    AU_MAIN_TYPE ${AU_MAIN_TYPE}
    LV2URI ${LV2_URI}
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
)

# ============================================
# SOURCE FILES
# ============================================
target_sources(nf_gnarly
    PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginProcessor.h
        Source/PluginEditor.cpp
        Source/PluginEditor.h
)

# ============================================
# LINK LIBRARIES
# ============================================
target_link_libraries(nf_gnarly
    PRIVATE
        nf_gnarly_WebUI
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

# ============================================
# COMPILE DEFINITIONS (Platform-Specific)
# ============================================

# Base definitions for all platforms
target_compile_definitions(nf_gnarly
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_VST3_CAN_REPLACE_VST2=0
)

# Windows-specific definitions
if(WIN32)
    target_compile_definitions(nf_gnarly
        PUBLIC
            JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
            _USE_MATH_DEFINES=1
    )
endif()

# macOS-specific definitions
if(APPLE)
    target_compile_definitions(nf_gnarly
        PUBLIC
            JUCE_USE_CURL=0
    )
endif()

# Linux-specific definitions
if(UNIX AND NOT APPLE)
    target_compile_definitions(nf_gnarly
        PUBLIC
            JUCE_USE_CURL=0
            JUCE_JACK=1
    )
endif()

# ============================================
# MACOS UNIVERSAL BINARY SUPPORT
# ============================================
# Handled via CMAKE_OSX_ARCHITECTURES at configure time (see workflow)
