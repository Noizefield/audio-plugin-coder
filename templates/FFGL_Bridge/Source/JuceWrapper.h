#pragma once

// ============================================
// JUCE INCLUDES
// ============================================
// Define NOMINMAX to prevent Windows header conflicts
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include <juce_data_structures/juce_data_structures.h>
#include <juce_graphics/juce_graphics.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_opengl/juce_opengl.h>
#include <juce_audio_processors/juce_audio_processors.h>

// ============================================
// FFGL INCLUDES
// ============================================
#include "FFGLPluginSDK.h"

// ============================================
// JUCE PARAMETER PROCESSOR
// ============================================
// A minimal AudioProcessor to host the APVTS
class FFGLParameterProcessor : public juce::AudioProcessor
{
public:
    FFGLParameterProcessor()
        : AudioProcessor(BusesProperties().withInput("Input", juce::AudioChannelSet::stereo(), true)
                                          .withOutput("Output", juce::AudioChannelSet::stereo(), true))
    {
    }

    ~FFGLParameterProcessor() override = default;

    void prepareToPlay(double, int) override {}
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override {}

    juce::AudioProcessorEditor* createEditor() override { return nullptr; }
    bool hasEditor() const override { return false; }
    const juce::String getName() const override { return "FFGL Bridge"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return "Default"; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock&) override {}
    void setStateInformation(const void*, int) override {}
};

// ============================================
// FFGL BRIDGE CLASS
// ============================================
class FFGLJuceBridge : public CFFGLPlugin
{
public:
    FFGLJuceBridge();
    ~FFGLJuceBridge() override;

    // FFGL Interface Implementation
    FFResult ProcessOpenGL(ProcessOpenGLStruct* pGL) override;
    FFResult SetFloatParameter(unsigned int index, float value) override;
    float GetFloatParameter(unsigned int index) override;

    // Lifecycle
    FFResult InitGL(const FFGLViewportStruct* vp) override;
    FFResult DeInitGL() override;

    // Factory Method
    static CFFGLPlugin* CreateInstance(CFFGLPluginInfo* info);

private:
    // JUCE System Logic
    // ScopedJuceInitialiser_GUI must be a member to ensure JUCE is initialized
    // for the lifetime of the plugin instance.
    juce::ScopedJuceInitialiser_GUI juceInitialiser;

    // Parameter Management
    std::unique_ptr<FFGLParameterProcessor> processor;
    std::unique_ptr<juce::AudioProcessorValueTreeState> apvts;

    // OpenGL State
    juce::OpenGLContext openGLContext; // Might be useful if we want to use JUCE's GL helpers
    GLuint textureID = 0;

    // Helper to setup parameters
    void setupParameters();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(FFGLJuceBridge)
};
