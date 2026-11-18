#pragma once
// Fixture stand-in for the plugin's Visage control set.
struct VisageKnob
{
    explicit VisageKnob (juce::RangedAudioParameter& param) : parameter (param) {}
    juce::RangedAudioParameter& parameter;
};
