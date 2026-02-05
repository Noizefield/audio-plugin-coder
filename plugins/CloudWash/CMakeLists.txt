# CloudWash - Granular Texture Processor
# WebView-based UI with multi-mode DSP architecture
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
    set(LV2_URI "https://github.com/noizefield/audio-plugin-coder/CloudWash")
else()
    message(FATAL_ERROR "Unsupported platform")
endif()

message(STATUS "CloudWash: Building for ${PLUGIN_FORMATS}")
message(STATUS "CloudWash: WebView backend: ${WEBVIEW_BACKEND}")

# ============================================
# BINARY DATA (Web UI Resources)
# ============================================
juce_add_binary_data(CloudWash_WebUI
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/js/index.js
        Source/ui/public/js/juce/index.js
        Source/ui/public/js/juce/check_native_interop.js
)

# ============================================
# PLUGIN DEFINITION
# ============================================
juce_add_plugin(CloudWash
    COMPANY_NAME "Noizefield"
    PLUGIN_MANUFACTURER_CODE Nfld
    PLUGIN_CODE CldW
    FORMATS ${PLUGIN_FORMATS}
    PRODUCT_NAME "CloudWash"
    NEEDS_WEBVIEW2 ${NEEDS_WEBVIEW2}
    NEEDS_WEB_BROWSER ${NEEDS_WEB_BROWSER}
    VST3_CATEGORIES Fx Delay Modulation
    AU_MAIN_TYPE ${AU_MAIN_TYPE}
    LV2URI ${LV2_URI}
)

# ============================================
# SOURCE FILES
# ============================================
target_sources(CloudWash
    PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
        Source/dsp/clouds/dsp/granular_processor.cc
        Source/dsp/clouds/resources.cc
        Source/dsp/clouds/dsp/pvoc/phase_vocoder.cc
        Source/dsp/clouds/dsp/pvoc/stft.cc
        Source/dsp/clouds/dsp/pvoc/frame_transformation.cc
        Source/dsp/clouds/dsp/mu_law.cc
        Source/dsp/clouds/dsp/correlator.cc
        Source/dsp/stmlib/dsp/atan.cc
        Source/dsp/stmlib/utils/random.cc
        Source/dsp/stmlib/dsp/units.cc
)

# ============================================
# INCLUDE DIRECTORIES
# ============================================
target_include_directories(CloudWash
    PRIVATE
        Source/dsp
)

# ============================================
# LINK LIBRARIES
# ============================================
target_link_libraries(CloudWash
    PRIVATE
        CloudWash_WebUI
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
target_compile_definitions(CloudWash
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_VST3_CAN_REPLACE_VST2=0
        _USE_MATH_DEFINES=1
)

# Windows-specific definitions
if(WIN32)
    target_compile_definitions(CloudWash
        PUBLIC
            JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    )
endif()

# macOS-specific definitions
if(APPLE)
    target_compile_definitions(CloudWash
        PUBLIC
            JUCE_USE_CURL=0
    )
endif()

# Linux-specific definitions
if(UNIX AND NOT APPLE)
    target_compile_definitions(CloudWash
        PUBLIC
            JUCE_USE_CURL=0
            JUCE_JACK=1
    )
endif()

# ============================================
# MACOS UNIVERSAL BINARY SUPPORT
# ============================================
# Handled via CMAKE_OSX_ARCHITECTURES at configure time (see workflow)
