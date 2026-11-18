// Fixture: Visage editor skeleton (never compiled).
#include "PluginEditor.h"

VisageFixtureEditor::VisageFixtureEditor(VisageFixtureProcessor& p) : juce::AudioProcessorEditor(&p)
{
    setWantsKeyboardFocus(true);
    startTimerHz(30);   // meter refresh
}

bool VisageFixtureEditor::keyPressed(const juce::KeyPress& k)
{
    return k == juce::KeyPress::escapeKey;
}
