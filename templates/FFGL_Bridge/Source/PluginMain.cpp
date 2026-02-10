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
    // 1. Initialize JUCE
    // handled by SharedResourcePointer 'juceInitialiser'

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

    // juceInitialiser manages ref-counting automatically
}

// Factory method for FFGL SDK
CFFGLPlugin* FFGLJuceBridge::CreateInstance(CFFGLPluginInfo* info)
{
    return new FFGLJuceBridge();
}

// ============================================
// MANUAL ENTRY POINT (Optional)
// ============================================
/*
 * By default, this template links against the FFGL SDK sources (FFGLPluginSDK.cpp),
 * which already implements the 'plugMain' function.
 *
 * If you wish to implement 'plugMain' manually (e.g., to avoid linking the SDK source
 * or to customize the entry point), uncomment the following block and remove
 * FFGLPluginSDK.cpp from your CMakeLists.txt sources.
 */

/*
extern "C" __declspec(dllexport) const void* __stdcall plugMain(DWORD functionCode, DWORD inputValue, DWORD instanceID)
{
    switch(functionCode)
    {
        case FF_GETINFO:
            return &PluginInfo;
        case FF_INITIALISE:
            // Custom Initialization Logic
            return (void*)FF_SUCCESS;
        case FF_DEINITIALISE:
            // Custom Cleanup Logic
            return (void*)FF_SUCCESS;
        case FF_INSTANTIATE:
            return (void*)PluginInfo.NewPluginInstance(inputValue);
    }
    return NULL;
}
*/

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

    // Cache Parameter Pointers for efficiency
    if (auto* p = apvts->getRawParameterValue("brightness"))
        brightnessParam = p;
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
    // 1. Get Parameter Value from Cache (Fast)
    float brightness = 0.5f;
    if (brightnessParam)
        brightness = brightnessParam->load();

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

    // 3. Clear Screen with Parameter Color (Simple Example)
    // We rely on the host's active context.
    // Since we are linking against system OpenGL, we can use basic functions.
    // For more advanced stuff (shaders), use juce::OpenGLContext::getCurrentContext()->extensions.

    glClearColor(brightness, brightness, brightness, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    // If implementing a full effect, we would draw a textured quad here.
    // For now, we return success to indicate we handled the draw.

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
