// Console runner for the JUCE-side native tests (no framework, no message loop needed).
//   apc_juce_tests                                  run every TEST
//   apc_juce_tests --xcheck <dir>                   additionally cross-check against the Node `apc presets index` output
//                                                   (<dir>/Typed + <dir>/Flat were indexed by Node first; see test/apc-cpp-juce.test.js)
//   apc_juce_tests --write-cache <dir>              rescan <dir>/{Typed,Flat} and leave C++-written cache/_index.json behind
#include "test_util.h"

std::string g_xcheckDir;
std::string g_writeCacheDir;

int main (int argc, char** argv)
{
    for (int i = 1; i < argc; ++i)
    {
        const std::string a = argv[i];
        if (a == "--xcheck" && i + 1 < argc) g_xcheckDir = argv[++i];
        else if (a == "--write-cache" && i + 1 < argc) g_writeCacheDir = argv[++i];
    }
    const int rc = t::runAll();
    std::error_code ec;
    std::filesystem::remove_all (t::tempRoot(), ec);
    return rc;
}
