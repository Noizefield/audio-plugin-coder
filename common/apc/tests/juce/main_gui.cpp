// Runner for the audio-processors/gui-extra target.
//   apc_juce_gui_tests                 -> compile/link check only (exit 0 without running anything WebView related)
//   apc_juce_gui_tests --run-apvts     -> run the headless APVTS-adapter tests (no WebView is ever created)
#include "test_util.h"

#include <juce_gui_basics/juce_gui_basics.h>

int apcCompileCheckEntry (int argc);

int main (int argc, char** argv)
{
    juce::ScopedJuceInitialiser_GUI init;   // message manager for AsyncUpdater/ValueTree inside the APVTS
    bool run = false;
    for (int i = 1; i < argc; ++i) if (std::string (argv[i]) == "--run-apvts") run = true;
    if (! run)
    {
        std::cout << "apc_juce_gui_tests: compile-check only (pass --run-apvts to run the APVTS tests)\n";
        return apcCompileCheckEntry (argc);
    }
    const int rc = t::runAll();
    std::error_code ec;
    std::filesystem::remove_all (t::tempRoot(), ec);
    return rc;
}
