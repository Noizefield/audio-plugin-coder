# Max External (Min-API) Bridge for JUCE 8

A template for creating native Max/MSP Externals using the Cycling '74 Min-API (min-api) and JUCE 8 for DSP and UI logic.

## Overview

This template demonstrates how to:
1.  **Bridge DSP**: Pass audio buffers from Max's audio callback (`operator()`) to a JUCE `AudioProcessor::processBlock`.
2.  **Bridge UI**: Manage a JUCE `AudioProcessorEditor` component within the Max environment.
3.  **Manage Threading**: Use `juce::SharedResourcePointer` to manage the JUCE `MessageManager` safely across multiple object instances.
4.  **Extract Native Window**: Use Max C-API calls to attach a JUCE component to a native OS window (Windows/macOS).

## Prerequisites

*   Max/MSP 8+ (installed)
*   CMake 3.22+
*   Min-API (automatically fetched by CMake)
*   JUCE 8 (automatically fetched or found)

## Project Structure

*   **`CMakeLists.txt`**: Fetches `min-api` and configures the build target as a `.mxo` bundle.
*   **`Source/MaxWrapper.cpp`**: The main Min-API object (`min::object`). Handles audio conversion and lifecycle.
*   **`Source/JuceBridge.h`**: Manages the UI connection. Includes fallback logic for floating windows if embedding fails.
*   **`Source/JuceDSP.h`**: Your JUCE `AudioProcessor` implementation.
*   **`Source/JuceUI.cpp`**: Your JUCE `AudioProcessorEditor` component.

## Usage

1.  **Clone/Copy**: Copy this directory to your Max packages folder (or link it).
2.  **Build**:
    ```bash
    mkdir build && cd build
    cmake .. -G "Visual Studio 17 2022" # Windows
    # or
    cmake .. -G Xcode # macOS
    cmake --build . --config Release
    ```
3.  **Deploy**: The build output will be a `.mxo` package. Load it in Max using the external name (e.g., `juce.dsp~`).

## Important Notes on Window Embedding

The template includes logic for two modes of operation for the UI:

1.  **Floating Window (Default Fallback)**:
    *   Creates a separate top-level window for the JUCE UI when opened.
    *   Safe and guaranteed to work without deep C-API linkage.

2.  **Embedded Window (Experimental)**:
    *   Attempts to extract the native window handle (`NSView*` or `HWND`) from the Max `jbox` object.
    *   Requires linking against the Max SDK C-Includes.
    *   Code for this is provided in `JuceBridge.h` but commented out/guarded. Enable it if you have the full Max SDK set up correctly.

## Memory Safety

*   **Audio Buffers**: The wrapper uses a pre-allocated member buffer (`conversionBuffer`) to convert between Min-API (Double) and JUCE (Float) to avoid heap allocations on the audio thread.
*   **Lifecycle**: The `SharedJuceInitializer` ensures the JUCE framework is initialized once and destroyed only when the last object instance is removed.
