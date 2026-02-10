cmake_minimum_required(VERSION 3.22)

project(FFGL_Bridge_Template VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ============================================
# DEPENDENCIES
# ============================================

# 1. JUCE 8
# We assume JUCE is available via find_package or add_subdirectory from parent
# If not found, we try to find it
if(NOT TARGET juce::juce_core)
    find_package(JUCE CONFIG REQUIRED)
endif()

# 2. FFGL 2.0 SDK
include(FetchContent)
FetchContent_Declare(
    ffgl_sdk
    GIT_REPOSITORY https://github.com/FreeFrame/FreeFrameGL.git
    GIT_TAG        master
)
FetchContent_MakeAvailable(ffgl_sdk)

# Define FFGL Source Files
# The SDK structure on GitHub (master) puts source in 'Source/FFGLPlugins'
set(FFGL_SDK_ROOT "${ffgl_sdk_SOURCE_DIR}")
set(FFGL_SOURCES
    "${FFGL_SDK_ROOT}/Source/FFGLPlugins/FFGLPluginSDK.cpp"
    "${FFGL_SDK_ROOT}/Source/FFGLPlugins/FFGLPluginSDK.h"
    "${FFGL_SDK_ROOT}/Source/FFGLPlugins/FFGL.h"
    "${FFGL_SDK_ROOT}/Source/FFGLPlugins/FFGLPluginInfo.cpp"
    "${FFGL_SDK_ROOT}/Source/FFGLPlugins/FFGLPluginInfo.h"
    "${FFGL_SDK_ROOT}/Source/FFGLPlugins/FFGLPluginManager.cpp"
    "${FFGL_SDK_ROOT}/Source/FFGLPlugins/FFGLPluginManager.h"
)

# ============================================
# PLUGIN TARGET
# ============================================

add_library(FFGL_Bridge SHARED
    Source/PluginMain.cpp
    Source/JuceWrapper.h
    ${FFGL_SOURCES}
)

# ============================================
# CONFIGURATION
# ============================================

target_include_directories(FFGL_Bridge
    PRIVATE
        Source
        "${FFGL_SDK_ROOT}/Source/FFGLPlugins"
)

target_compile_definitions(FFGL_Bridge
    PRIVATE
        JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1
        JUCE_STANDALONE_APPLICATION=0
)

# ============================================
# LINKING
# ============================================

target_link_libraries(FFGL_Bridge
    PRIVATE
        juce::juce_core
        juce::juce_events
        juce::juce_data_structures
        juce::juce_graphics
        juce::juce_gui_basics
        juce::juce_opengl
        juce::juce_audio_basics
        juce::juce_audio_processors
)

# Platform specific linking for OpenGL if needed
if(WIN32)
    target_link_libraries(FFGL_Bridge PRIVATE opengl32 glu32)
elseif(APPLE)
    target_link_libraries(FFGL_Bridge PRIVATE "-framework OpenGL")
elseif(UNIX)
    target_link_libraries(FFGL_Bridge PRIVATE GL)
endif()
