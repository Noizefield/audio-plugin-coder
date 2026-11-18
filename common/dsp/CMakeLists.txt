# apc_dsp - header-only golden DSP library (std-only C++17, no JUCE dependency).
#
# From a plugin CMakeLists.txt:
#   add_subdirectory(${APC_ROOT}/common/dsp ${CMAKE_BINARY_DIR}/apc_dsp)
#   target_link_libraries(MyPlugin PRIVATE APC::dsp)
# then:  #include <apc_dsp.h>   (or an individual header, e.g. <Biquad.h>)
cmake_minimum_required(VERSION 3.15)

if(NOT TARGET apc_dsp)
    if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
        project(apc_dsp LANGUAGES CXX)
    endif()

    add_library(apc_dsp INTERFACE)
    add_library(APC::dsp ALIAS apc_dsp)
    target_include_directories(apc_dsp INTERFACE
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)
    target_compile_features(apc_dsp INTERFACE cxx_std_17)

    # Optional: build + register the self-test (also driven by `npm test` via test/dsp.test.js).
    option(APC_DSP_BUILD_TESTS "Build the apc_dsp self-tests" OFF)
    if(APC_DSP_BUILD_TESTS)
        find_package(Threads REQUIRED)
        enable_testing()
        add_executable(apc_dsp_tests tests/apc_dsp_tests.cpp)
        target_link_libraries(apc_dsp_tests PRIVATE APC::dsp Threads::Threads)
        add_test(NAME apc_dsp_tests COMMAND apc_dsp_tests)
    endif()
endif()
