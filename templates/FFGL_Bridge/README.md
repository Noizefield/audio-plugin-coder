# FFGL 2.0 Bridge for JUCE 8

A template for creating FreeFrameGL 2.0 (FFGL) plugins using JUCE 8 for parameter handling, internal logic, and cross-platform utilities.

## Overview

This bridge allows you to:
1.  **Bypass standard JUCE plugin wrappers** (VST/AU/etc.) and build a native FFGL shared library directly.
2.  **Use JUCE Logic** (`juce::AudioProcessorValueTreeState`) to manage parameters and state.
3.  **Use JUCE Utilities** (`String`, `Array`, `File`, etc.) safely within the FFGL host environment.
4.  **Render via OpenGL** using the host's context (Resolume, VDMX, etc.).

## Prerequisites

*   CMake 3.22+
*   C++20 Compiler (MSVC / Clang / GCC)
*   JUCE 8 (Installed or available via `find_package`)

## Architecture

*   **`CMakeLists.txt`**: Fetches the FFGL SDK from GitHub and links it directly. Configures the build as a `SHARED` library.
*   **`PluginMain.cpp`**: Implements the FFGL factory and entry points. It bridges FFGL parameter calls (`SetFloatParameter`) to the JUCE APVTS.
*   **`JuceWrapper.h`**:
    *   `SharedJuceInitializer`: Ensures the `juce::MessageManager` is initialized and kept alive across multiple plugin instances using `juce::SharedResourcePointer`.
    *   `FFGLJuceBridge`: The main plugin class inheriting from `CFFGLPlugin`.

## Usage

1.  **Clone/Copy**: Copy this directory to your project.
2.  **Configure**: Edit `CMakeLists.txt` to set your plugin name and unique 4-char ID.
3.  **Build**:
    ```bash
    mkdir build && cd build
    cmake .. -DJUCE_DIR=/path/to/JUCE
    cmake --build . --config Release
    ```
4.  **Install**: Copy the resulting `.dll` (Windows) or `.bundle`/`.dylib` (macOS) to your host's FFGL plugins folder.

## Key Features implemented

*   **Parameter Caching**: Parameters are cached as atomic pointers for fast access during the `ProcessOpenGL` render loop.
*   **Thread Safety**: The `SharedJuceInitializer` prevents crashes when multiple instances are created/destroyed.
*   **OpenGL Context**: The plugin renders into the host-provided OpenGL context.
