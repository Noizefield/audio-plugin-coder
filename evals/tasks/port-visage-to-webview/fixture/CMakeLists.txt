# Eval workspace root (minimal stand-in for the APC root CMakeLists.txt).
# `apc validate visage` inspects these three anchors.
cmake_minimum_required(VERSION 3.22)
project(ApcEvalWorkspace LANGUAGES CXX)

option(APC_ENABLE_VISAGE "Enable Visage UI framework support" OFF)
set(VISAGE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/_tools/visage")

if(APC_ENABLE_VISAGE)
    add_subdirectory("${VISAGE_DIR}")
    if(TARGET visage AND NOT TARGET visage::visage)
        add_library(visage::visage ALIAS visage)
    endif()
endif()
