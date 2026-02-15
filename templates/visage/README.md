# Visage Template

This template uses `VisageJuceHost.h` from `common/` to render a Visage UI inside a JUCE plugin editor.

Files:
- `PluginEditor.h/.cpp` uses `VisagePluginEditor`
- `VisageControls.h` defines the root `VisageMainView`

Next steps:
- Replace `VisageMainView` with your actual layout and widgets.
- Bind JUCE parameters to Visage controls.
