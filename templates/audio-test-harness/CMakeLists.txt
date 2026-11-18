# APC audio test harness - standalone JUCE 9 console app.
#
# Loads a VST3, renders test signals offline through processBlock and writes a
# metrics JSON. It is NOT part of the plugin build: it is configured/built by
# `node bin/apc.js audio <Plugin> --build-harness` (scripts/apc-audio.js) into
# <build_dir>/audio-harness. See README.md in this folder.
#
# Inputs (cache variables):
#   APC_ROOT      repo root containing _tools/JUCE (required unless JUCE_DIR set)
#   JUCE_DIR      override path to the JUCE checkout
#   APC_SANITIZE  asan|ubsan|tsan|none (see cmake/apc-sanitizers.cmake)

cmake_minimum_required(VERSION 3.22)
project(APC_AudioTestHarness VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT DEFINED APC_ROOT OR APC_ROOT STREQUAL "")
    get_filename_component(APC_ROOT "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)
endif()
if(NOT DEFINED JUCE_DIR OR JUCE_DIR STREQUAL "")
    set(JUCE_DIR "${APC_ROOT}/_tools/JUCE")
endif()
if(NOT EXISTS "${JUCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "JUCE not found at ${JUCE_DIR} (set APC_ROOT or JUCE_DIR)")
endif()

set(APC_SANITIZE "none" CACHE STRING "Sanitizer: asan|ubsan|tsan|none")
include("${APC_ROOT}/cmake/apc-sanitizers.cmake")

add_subdirectory("${JUCE_DIR}" "${CMAKE_BINARY_DIR}/juce")

juce_add_console_app(apc_audio_harness
    PRODUCT_NAME "apc_audio_harness"
    NEEDS_WEB_BROWSER FALSE
    NEEDS_CURL FALSE)

target_sources(apc_audio_harness PRIVATE Main.cpp)

target_compile_definitions(apc_audio_harness PRIVATE
    JUCE_PLUGINHOST_VST3=1
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_STANDALONE_APPLICATION=1)

target_link_libraries(apc_audio_harness
    PRIVATE
        juce::juce_core
        juce::juce_events
        juce::juce_audio_basics
        juce::juce_audio_formats
        juce::juce_audio_processors_headless
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)

apc_enable_sanitizers(apc_audio_harness)
