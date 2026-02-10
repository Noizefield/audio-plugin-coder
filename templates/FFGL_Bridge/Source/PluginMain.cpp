#include "JuceWrapper.h"
#include <FFGLPluginSDK.h>

// ============================================
// FFGL PLUGIN INFO
// ============================================
static CFFGLPluginInfo PluginInfo(
    FFGLJuceBridge::CreateInstance, // Factory method
    "ABCD",                         // Plugin Unique ID (4 chars)
    "FFGL Juce Bridge",             // Plugin Name
    1,                              // API Major Version
    000,                            // API Minor Version
    1,                              // Plugin Major Version
    000,                            // Plugin Minor Version
    FF_EFFECT,                      // Plugin Type
    "Use JUCE logic within FFGL",   // Description
    "Your Name"                     // About
);

// ============================================
// FFGL BRIDGE IMPLEMENTATION
// ============================================

FFGLJuceBridge::FFGLJuceBridge() : CFFGLPlugin()
{
    // 1. Initialize JUCE Scoped Initializer
    // This is handled by the member 'juceInitialiser' constructor automatically.

    // 2. Setup Parameters
    setupParameters();

    // 3. Define FFGL Parameters
    // We map 0.0-1.0 to our APVTS parameters
    SetMinInputs(1);
    SetMaxInputs(1);

    // Example Parameter: Brightness
    SetParamInfo(0, "Brightness", FF_TYPE_STANDARD, 0.5f);
}

FFGLJuceBridge::~FFGLJuceBridge()
{
    // Clean up APVTS and Processor
    apvts = nullptr;
    processor = nullptr;

    // juceInitialiser destructor handles shutdown
}

// Factory method for FFGL SDK
CFFGLPlugin* FFGLJuceBridge::CreateInstance(CFFGLPluginInfo* info)
{
    return new FFGLJuceBridge();
}

// ============================================
// PARAMETER HANDLING
// ============================================

void FFGLJuceBridge::setupParameters()
{
    processor = std::make_unique<FFGLParameterProcessor>();

    // Create Layout
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    auto brightnessParam = std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID("brightness", 1),
        "Brightness",
        juce::NormalisableRange<float>(0.0f, 1.0f),
        0.5f
    );

    layout.add(std::move(brightnessParam));

    // Initialize APVTS
    apvts = std::make_unique<juce::AudioProcessorValueTreeState>(*processor, nullptr, "Parameters", std::move(layout));
}

FFResult FFGLJuceBridge::SetFloatParameter(unsigned int index, float value)
{
    if (index == 0) // Brightness
    {
        // Update APVTS
        // Note: In a real plugin, use a thread-safe way or the parameter attachment
        if (auto* param = apvts->getParameter("brightness"))
        {
             param->setValueNotifyingHost(value);
        }
    }

    return FF_SUCCESS;
}

float FFGLJuceBridge::GetFloatParameter(unsigned int index)
{
    if (index == 0)
    {
        if (auto* param = apvts->getParameter("brightness"))
        {
            return param->getValue();
        }
    }
    return 0.0f;
}

// ============================================
// RENDERING (OPENGL)
// ============================================

FFResult FFGLJuceBridge::ProcessOpenGL(ProcessOpenGLStruct* pGL)
{
    // 1. Get Parameter Value from APVTS
    float brightness = 0.5f;
    if (auto* param = apvts->getParameter("brightness"))
        brightness = param->getValue();

    // 2. Use Raw OpenGL (Core Profile 3.3+)
    // Host provides the context. We just issue commands.

    // Note: Use JUCE's OpenGL helpers if needed, but be careful with state.
    // Here we just clear the screen with the brightness color as an example.

    // Usually FFGL effects render a textured quad.
    // For this bridge, we demonstrate using the parameter.

    // We can use juce::OpenGLContext to wrap the existing context if we wanted to use JUCE rendering
    // But per instructions, we use raw OpenGL for the process function.

    // For standard FFGL, we usually bind the input texture and draw.
    // Here is a dummy implementation:

    if (pGL->numInputTextures < 1) return FF_FAIL;

    // In a real implementation: Bind shader, bind texture, draw quad.
    // We will assume the host setup is compatible or use standard GL commands.
    // Since we can't link GLEW easily here without more setup, we rely on symbols being available
    // or JUCE's GL bindings.

    // Using JUCE's OpenGLExtensionFunctions is a good way to get function pointers.
    // auto* gl = juce::OpenGLContext::getCurrentContext()->extensions;

    return FF_SUCCESS;
}

FFResult FFGLJuceBridge::InitGL(const FFGLViewportStruct* vp)
{
    // Initialize any GL resources
    return FF_SUCCESS;
}

FFResult FFGLJuceBridge::DeInitGL()
{
    // Free resources
    return FF_SUCCESS;
}
