#include "PluginProcessor.h"
#include "PluginEditor.h"

Gnarly2AudioProcessorEditor::Gnarly2AudioProcessorEditor (Gnarly2AudioProcessor& p)
    : VisagePluginEditor(p), audioProcessor(p)
{
    setSize(400, 380);
}

Gnarly2AudioProcessorEditor::~Gnarly2AudioProcessorEditor() = default;

void Gnarly2AudioProcessorEditor::onInit()
{
    mainView = std::make_unique<VisageMainView>();
    setEventRoot(mainView.get());
    mainView->setParamChangeCallback([this](VisageMainView::ParamId id, float value01) {
        const char* paramId = nullptr;
        switch (id) {
            case VisageMainView::ParamId::Drive: paramId = "drive"; break;
            case VisageMainView::ParamId::Cutoff: paramId = "cutoff"; break;
            case VisageMainView::ParamId::Resonance: paramId = "resonance"; break;
        }
        if (paramId == nullptr)
            return;

        if (auto* param = audioProcessor.parameters.getParameter(paramId)) {
            param->setValueNotifyingHost(value01);
        }
    });
    addFrameToCanvas(mainView.get());
    mainView->setBounds(0, 0, getWidth(), getHeight());
}

void Gnarly2AudioProcessorEditor::onRender()
{
    if (!mainView)
        return;

    const float drive = audioProcessor.parameters.getRawParameterValue("drive")->load();
    const float cutoff = audioProcessor.parameters.getRawParameterValue("cutoff")->load();
    const float resonance = audioProcessor.parameters.getRawParameterValue("resonance")->load();

    mainView->setParameterValues(drive, cutoff, resonance);
}

void Gnarly2AudioProcessorEditor::onDestroy()
{
    if (mainView) {
        removeFrameFromCanvas(mainView.get());
        mainView.reset();
    }
}

void Gnarly2AudioProcessorEditor::onResize(int w, int h)
{
    if (mainView) {
        mainView->setBounds(0, 0, w, h);
        mainView->redraw();
    }
}
