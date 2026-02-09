/*
  ==============================================================================

    This file contains the basic framework code for a JUCE plugin editor.

  ==============================================================================
*/

#pragma once

#include <memory>
#include "PluginProcessor.h"
#include "VisageControls.h"
#include "VisageJuceHost.h"

//==============================================================================
class Gnarly2AudioProcessorEditor : public VisagePluginEditor
{
public:
    explicit Gnarly2AudioProcessorEditor (Gnarly2AudioProcessor&);
    ~Gnarly2AudioProcessorEditor() override;

    void onInit() override;
    void onRender() override;
    void onDestroy() override;
    void onResize(int w, int h) override;

private:
    Gnarly2AudioProcessor& audioProcessor;
    std::unique_ptr<VisageMainView> mainView;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (Gnarly2AudioProcessorEditor)
};
