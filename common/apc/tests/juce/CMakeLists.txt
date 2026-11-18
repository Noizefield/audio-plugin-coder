# APC native-side UI-kit tests: JUCE-based preset store + JS<->C++ bridge core.
#
# Standalone test TOOL (not a plugin) - same situation as templates/audio-test-harness.
# Never configure it inside the repository tree. Driven by test/apc-cpp-juce.test.js, which
# builds into an OS temp dir:
#   cmake -S common/apc/tests/juce -B <tmp>/build -DAPC_ROOT=<repo>
#   cmake --build <tmp>/build --config Release --target apc_juce_tests
#
# Targets
#   apc_juce_tests                  juce_core + juce_events only. Store, bridge dispatcher, params. RUN.
#   apc_juce_gui_tests              juce_gui_extra + juce_audio_processors (+ WebView2 SDK when
#                                   APC_WEBVIEW2_STATIC=ON). --run-apvts runs the headless APVTS tests; the WebView wiring is compile/link only.
#
# Cache variables: APC_ROOT (repo root), JUCE_DIR, APC_WEBVIEW2_STATIC (ON|OFF, default OFF)

cmake_minimum_required(VERSION 3.22)
project(APC_JuceNativeTests VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT DEFINED APC_ROOT OR APC_ROOT STREQUAL "")
    get_filename_component(APC_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../../.." ABSOLUTE)
endif()
if(NOT DEFINED JUCE_DIR OR JUCE_DIR STREQUAL "")
    set(JUCE_DIR "${APC_ROOT}/_tools/JUCE")
endif()
if(NOT EXISTS "${JUCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "JUCE not found at ${JUCE_DIR} (set APC_ROOT or JUCE_DIR)")
endif()

set(APC_WEBVIEW2_STATIC OFF CACHE BOOL "Compile-check target links the WebView2 SDK statically (needs NuGet download)")

add_subdirectory("${JUCE_DIR}" "${CMAKE_BINARY_DIR}/juce")

# ---------------------------------------------------------------------------------------------
juce_add_console_app(apc_juce_tests
    PRODUCT_NAME "apc_juce_tests"
    NEEDS_WEB_BROWSER FALSE
    NEEDS_CURL FALSE)

target_sources(apc_juce_tests PRIVATE
    main.cpp
    test_store.cpp
    test_bridge.cpp)

target_include_directories(apc_juce_tests PRIVATE "${APC_ROOT}/common")

target_compile_definitions(apc_juce_tests PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_STANDALONE_APPLICATION=1
    JUCE_MODAL_LOOPS_PERMITTED=0
    _CRT_SECURE_NO_WARNINGS
    APC_REPO_ROOT="${APC_ROOT}")

target_link_libraries(apc_juce_tests
    PRIVATE
        juce::juce_core
        juce::juce_events
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)

# ---------------------------------------------------------------------------------------------
# Runs the headless APVTS-adapter tests (--run-apvts) and COMPILE/LINK-checks the real WebBrowserComponent wiring
# (templates/webview member order, addApcNativeFunctions, attach). The WebView part is never executed.
set(_apc_wv_nat "")
if(APC_WEBVIEW2_STATIC)
    set(_apc_wv_nat NEEDS_WEBVIEW2 TRUE)
endif()
juce_add_console_app(apc_juce_gui_tests
    PRODUCT_NAME "apc_juce_gui_tests"
    NEEDS_WEB_BROWSER FALSE
    NEEDS_CURL FALSE
    ${_apc_wv_nat})

target_sources(apc_juce_gui_tests PRIVATE
    main_gui.cpp
    compilecheck_webview.cpp
    test_apvts.cpp)
target_include_directories(apc_juce_gui_tests PRIVATE "${APC_ROOT}/common")
target_compile_definitions(apc_juce_gui_tests PRIVATE
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=0
    JUCE_STANDALONE_APPLICATION=1
    JUCE_PLUGINHOST_VST3=0
    _CRT_SECURE_NO_WARNINGS
    APC_REPO_ROOT="${APC_ROOT}")
if(APC_WEBVIEW2_STATIC)
    target_compile_definitions(apc_juce_gui_tests PRIVATE JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
endif()
target_link_libraries(apc_juce_gui_tests
    PRIVATE
        juce::juce_core
        juce::juce_events
        juce::juce_graphics
        juce::juce_gui_basics
        juce::juce_gui_extra
        juce::juce_data_structures
        juce::juce_audio_basics
        juce::juce_audio_processors
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)
