cmake_minimum_required(VERSION 3.22)

# ============================================
# MAX EXTERNAL PROJECT
# ============================================
# Use Min-DevKit (min-api) to build a modern Max External with JUCE 8
project(JuceMaxExternal VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ============================================
# DEPENDENCIES
# ============================================

# 1. JUCE 8
# Assume JUCE is provided by parent or fetch it
if(NOT TARGET juce::juce_core)
    find_package(JUCE CONFIG REQUIRED)
endif()

# 2. Min-DevKit (Cycling '74 Min-API)
include(FetchContent)
FetchContent_Declare(
    min-api
    GIT_REPOSITORY https://github.com/cycling74/min-api.git
    GIT_TAG        main
)
FetchContent_MakeAvailable(min-api)

# ============================================
# EXTERNAL DEFINITION
# ============================================

# Define the Max External target using min-api
# Note: min-api provides 'min_add_library' macro but we can also use add_library directly
# to control properties better, especially for integration.
# However, min_add_library sets up important flags. We'll use standard add_library
# and configure properties manually to match min-api expectations + JUCE requirements.

add_library(JuceMaxExternal MODULE
    Source/MaxWrapper.cpp
    Source/JuceUI.cpp
    Source/JuceDSP.h
    Source/JuceBridge.h
)

# Set output name (the .mxo bundle name)
set_target_properties(JuceMaxExternal PROPERTIES
    OUTPUT_NAME "juce.dsp"
    PREFIX ""
    SUFFIX ".mxo"
)

if(APPLE)
    set_target_properties(JuceMaxExternal PROPERTIES
        BUNDLE TRUE
        MACOSX_BUNDLE_GUI_IDENTIFIER "com.yourcompany.juce.dsp"
        MACOSX_BUNDLE_BUNDLE_NAME "juce.dsp"
        MACOSX_BUNDLE_INFO_PLIST "${min-api_SOURCE_DIR}/script/Info.plist.in"
    )
elseif(WIN32)
    set_target_properties(JuceMaxExternal PROPERTIES
        SUFFIX ".mxe64" # 64-bit Max External extension on Windows
    )
endif()

# ============================================
# INCLUDE DIRECTORIES
# ============================================

target_include_directories(JuceMaxExternal
    PRIVATE
        Source
        "${min-api_SOURCE_DIR}/include"
        "${min-api_SOURCE_DIR}/max-sdk-base/c74support/max-includes"
        "${min-api_SOURCE_DIR}/max-sdk-base/c74support/msp-includes"
        "${min-api_SOURCE_DIR}/max-sdk-base/c74support/jit-includes"
)

# ============================================
# COMPILE DEFINITIONS
# ============================================

target_compile_definitions(JuceMaxExternal
    PRIVATE
        MAX_API_USE_CPP_VERSION=17 # Min-API requires C++17
        C74_MIN_API=1
        JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1
        JUCE_STANDALONE_APPLICATION=0
        JUCE_DLL_BUILD=1
)

# ============================================
# LINKING
# ============================================

target_link_libraries(JuceMaxExternal
    PRIVATE
        juce::juce_core
        juce::juce_events
        juce::juce_data_structures
        juce::juce_graphics
        juce::juce_gui_basics
        juce::juce_audio_basics
        juce::juce_audio_processors
)

# Link against Max API (header-only mostly, but some platform libs)
if(APPLE)
    target_link_options(JuceMaxExternal PRIVATE
        "-framework MaxAudioAPI"
        "-F${min-api_SOURCE_DIR}/max-sdk-base/c74support/msp-includes"
    )
endif()
