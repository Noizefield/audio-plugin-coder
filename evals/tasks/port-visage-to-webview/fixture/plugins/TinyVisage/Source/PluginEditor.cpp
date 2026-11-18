#include "PluginEditor.h"

TinyVisageAudioProcessorEditor::TinyVisageAudioProcessorEditor (TinyVisageAudioProcessor& p)
    : VisagePluginEditor (p), processorRef (p),
      gainKnob (*p.apvts.getParameter ("gain")),
      mixKnob (*p.apvts.getParameter ("mix"))
{
    addControl (gainKnob);
    addControl (mixKnob);
    setSize (400, 300);
}
