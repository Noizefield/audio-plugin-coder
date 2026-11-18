// Runnable tests for common/apc/juce/ApcApvtsParams.h against a REAL juce::AudioProcessorValueTreeState
// (headless: no editor, no WebView). Also exercises the preset store, the chunk and the bridge on real parameters.
#include "test_util.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include "apc/juce/ApcApvtsParams.h"
#include "apc/juce/ApcWebBridge.h"

#include <thread>

namespace fs = std::filesystem;
namespace pu = apc::presets::util;
using namespace apc::web;

namespace
{
struct GestureCounter : juce::AudioProcessorListener
{
    int begins = 0, ends = 0;
    void audioProcessorParameterChanged (juce::AudioProcessor*, int, float) override {}
    void audioProcessorChanged (juce::AudioProcessor*, const ChangeDetails&) override {}
    void audioProcessorParameterChangeGestureBegin (juce::AudioProcessor*, int) override { ++begins; }
    void audioProcessorParameterChangeGestureEnd (juce::AudioProcessor*, int) override { ++ends; }
};

class TestProcessor : public juce::AudioProcessor
{
public:
    TestProcessor()
        : juce::AudioProcessor (BusesProperties().withOutput ("Out", juce::AudioChannelSet::stereo(), true)),
          apvts (*this, nullptr, "STATE", layout()) {}

    static juce::AudioProcessorValueTreeState::ParameterLayout layout()
    {
        using F = juce::AudioParameterFloat;
        using juce::NormalisableRange;
        juce::AudioProcessorValueTreeState::ParameterLayout l;
        l.add (std::make_unique<juce::AudioParameterChoice> (juce::ParameterID { "osc1_wave", 1 }, "Wave", juce::StringArray { "saw", "square", "pulse" }, 0));
        l.add (std::make_unique<F> (juce::ParameterID { "osc1_tune_st", 1 }, "Tune", NormalisableRange<float> (-24.0f, 24.0f, 0.01f), 0.0f, juce::AudioParameterFloatAttributes().withLabel ("st")));
        l.add (std::make_unique<F> (juce::ParameterID { "filter_cutoff_hz", 1 }, "Cutoff", NormalisableRange<float> (20.0f, 20000.0f, 0.0f, 0.3f), 1000.0f, juce::AudioParameterFloatAttributes().withLabel ("Hz")));
        l.add (std::make_unique<F> (juce::ParameterID { "filter_res", 1 }, "Resonance", NormalisableRange<float> (0.0f, 1.0f), 0.2f));
        l.add (std::make_unique<F> (juce::ParameterID { "drive_amount", 1 }, "Drive", NormalisableRange<float> (0.0f, 1.0f), 0.0f));
        l.add (std::make_unique<F> (juce::ParameterID { "amp_env_attack_s", 1 }, "Attack", NormalisableRange<float> (0.0f, 10.0f), 0.005f, juce::AudioParameterFloatAttributes().withLabel ("s")));
        l.add (std::make_unique<F> (juce::ParameterID { "amp_env_release_s", 1 }, "Release", NormalisableRange<float> (0.0f, 10.0f), 0.3f, juce::AudioParameterFloatAttributes().withLabel ("s")));
        l.add (std::make_unique<F> (juce::ParameterID { "osc1_sub_level", 1 }, "Sub", NormalisableRange<float> (0.0f, 1.0f), 0.25f));
        l.add (std::make_unique<juce::AudioParameterBool> (juce::ParameterID { "unison_on", 1 }, "Unison", false));
        l.add (std::make_unique<juce::AudioParameterInt> (juce::ParameterID { "voices", 1 }, "Voices", 1, 16, 4));
        l.add (std::make_unique<F> (juce::ParameterID { "macro1", 1 }, "Macro 1", NormalisableRange<float> (0.0f, 1.0f), 0.5f));
        return l;
    }

    const juce::String getName() const override { return "Test"; }
    void prepareToPlay (double, int) override {}
    void releaseResources() override {}
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override {}
    juce::AudioProcessorEditor* createEditor() override { return nullptr; }
    bool hasEditor() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}
    void getStateInformation (juce::MemoryBlock&) override {}
    void setStateInformation (const void*, int) override {}

    juce::AudioProcessorValueTreeState apvts;
};

ParamTable makeTable()
{
    auto r = ParamTable::fromJsonText (R"({
        "filter_cutoff_hz": { "name": "Filter Cutoff", "group": "Filter", "midiCc": 74, "help": { "what": "Cutoff frequency.", "effect": "Opens the filter.", "how": "Turn up for brighter sound." } },
        "osc1_wave": { "help": { "what": "Waveform.", "effect": "Changes timbre.", "how": "Pick one." } },
        "macro1": { "normalized": true, "help": { "what": "Macro.", "effect": "Moves things.", "how": "Drag." } } })");
    return r.ok ? std::move (r.value) : ParamTable();
}

struct ApRig
{
    TestProcessor proc;
    ParamTable table = makeTable();
    std::unique_ptr<ApvtsParams> params;
    std::unique_ptr<apc::presets::Store> store;
    fs::path base;
    apc::PresetLayout layout;
    apc::presets::LiveState ls;
    juce::var engine = pu::newObject();

    explicit ApRig (const std::string& name, bool fixtures = true)
    {
        base = t::freshDir (name);
        layout = t::layoutIn (base);
        if (fixtures) t::copyTree (t::fixtures() / "golden" / "presets", layout.presets);
        params = std::make_unique<ApvtsParams> (proc.apvts, table);
        store = std::make_unique<apc::presets::Store> (t::typedConfig (layout));
        ls = params->liveState();
        ls.getEngine = [this] { return engine.clone(); };
        ls.setEngine = [this] (const juce::var& e) { engine = e.clone(); };
        store->setLiveState (ls);
    }
    double real (const char* id) { return (double) std::get<double> (params->snapshot().at (id)); }
};
} // namespace

// =============================================================================================
TEST (apvts_descriptors_are_real_world_with_help_from_one_table)
{
    ApRig r ("ap_desc", false);
    const auto cutoff = r.params->get ("filter_cutoff_hz");
    CHECK (cutoff.has_value());
    if (! cutoff) return;
    CHECK_EQ (cutoff->name, std::string ("Filter Cutoff"));          // table override
    CHECK_EQ (cutoff->unit, std::string ("Hz"));                      // from the parameter's label
    CHECK_EQ (cutoff->min, 20.0);
    CHECK_EQ (cutoff->max, 20000.0);
    CHECK_EQ (cutoff->def, 1000.0);
    CHECK_EQ (cutoff->value, 1000.0);
    CHECK (cutoff->skew.has_value() && std::abs (*cutoff->skew - 0.3) < 1e-6);
    CHECK_EQ (cutoff->group, std::string ("Filter"));
    CHECK_EQ (cutoff->midiCc.value_or (-1), 74);
    CHECK_EQ (cutoff->help.what, std::string ("Cutoff frequency."));
    CHECK (! cutoff->normalized);

    const auto wave = r.params->get ("osc1_wave");
    CHECK_EQ (wave->choices, (std::vector<std::string> { "saw", "square", "pulse" }));
    CHECK_EQ (wave->min, 0.0); CHECK_EQ (wave->max, 2.0); CHECK_EQ (wave->step.value_or (0), 1.0);
    const auto uni = r.params->get ("unison_on");
    CHECK_EQ (uni->max, 1.0); CHECK_EQ (uni->step.value_or (0), 1.0);
    const auto vox = r.params->get ("voices");
    CHECK_EQ (vox->min, 1.0); CHECK_EQ (vox->max, 16.0); CHECK_EQ (vox->def, 4.0);
    const auto tune = r.params->get ("osc1_tune_st");
    CHECK_EQ (tune->unit, std::string ("st"));
    CHECK_EQ (tune->step.value_or (0), 0.01);

    // "normalized": true is the ONLY case where 0..1 travels
    const auto macro = r.params->get ("macro1");
    CHECK (macro->normalized);
    CHECK_EQ (macro->min, 0.0); CHECK_EQ (macro->max, 1.0); CHECK_EQ (macro->def, 0.5);
    CHECK (pu::getBool (macro->toVar(), "normalized"));

    // help coverage check (agents run this in CI): parameters without all three fields are listed
    const auto missing = r.table.missingHelp (r.params->ids());
    CHECK (std::find (missing.begin(), missing.end(), "filter_res") != missing.end());
    CHECK (std::find (missing.begin(), missing.end(), "filter_cutoff_hz") == missing.end());

    CHECK (! r.params->get ("nope").has_value());
    CHECK_EQ ((int) r.params->list().size(), 11);
    // ids are immutable and stable across calls (X-01)
    CHECK_EQ (r.params->ids().front(), std::string ("osc1_wave"));
}

TEST (apvts_set_reset_gestures_and_clean_floats)
{
    ApRig r ("ap_set", false);
    GestureCounter gc;
    r.proc.addListener (&gc);
    auto set = [&] (const char* id, double v) { auto x = r.params->set (id, v); CHECK (x.ok); return x.value; };
    CHECK_EQ (set ("filter_cutoff_hz", 99999.0), 20000.0);        // clamped, read back
    CHECK_EQ (set ("filter_cutoff_hz", 440.0), 440.0);
    CHECK_EQ (set ("filter_res", 0.35), 0.35);                      // not 0.3499999940395355
    CHECK_EQ (set ("osc1_wave", 1.4), 1.0);                         // choice index, rounded
    CHECK_EQ (set ("unison_on", 0.7), 1.0);
    CHECK_EQ (set ("voices", 3.6), 4.0);
    CHECK_EQ (set ("macro1", 0.25), 0.25);                          // normalized param: 0..1 direct
    CHECK_EQ (gc.begins, 7);                                        // a lone set is bracketed in its own gesture so hosts record it
    CHECK_EQ (gc.ends, 7);
    CHECK_EQ (r.proc.apvts.getParameter ("osc1_wave")->getValue(), 0.5f);
    CHECK (! r.params->set ("nope", 1).ok);
    CHECK_EQ (r.params->set ("nope", 1).error.code, std::string ("unknown_param"));

    // explicit gesture from the UI drag: begin ... set ... set ... end == ONE gesture
    gc.begins = gc.ends = 0;
    CHECK (r.params->begin ("filter_cutoff_hz").ok);
    r.params->set ("filter_cutoff_hz", 500.0);
    r.params->set ("filter_cutoff_hz", 600.0);
    CHECK (r.params->end ("filter_cutoff_hz").ok);
    CHECK_EQ (gc.begins, 1);
    CHECK_EQ (gc.ends, 1);
    CHECK (r.params->end ("filter_cutoff_hz").ok);                  // double end is harmless
    CHECK_EQ (gc.ends, 1);

    // reset = declared default
    CHECK_EQ (r.params->reset ("filter_cutoff_hz").value, 1000.0);
    CHECK_EQ (r.params->reset ("osc1_wave").value, 0.0);
    r.proc.removeListener (&gc);
}

TEST (apvts_change_flags_distinguish_user_from_preset_apply)
{
    ApRig r ("ap_flags", false);
    std::vector<std::tuple<std::string, double, bool>> got;
    auto poll = [&] { got.clear(); r.params->collectChanged ([&] (const std::string& id, double v, bool user) { got.emplace_back (id, v, user); }); };
    poll();
    CHECK (got.empty());
    r.params->set ("filter_res", 0.5);
    poll();
    CHECK_EQ ((int) got.size(), 1);
    CHECK_EQ (std::get<0> (got[0]), std::string ("filter_res"));
    CHECK_EQ (std::get<1> (got[0]), 0.5);
    CHECK (std::get<2> (got[0]));                                     // user / host origin
    poll();
    CHECK (got.empty());                                              // flags are consumed

    // while the store applies a preset (beginBatch..endBatch) the UI is told but the preset is not marked dirty
    auto ls = r.params->liveState();
    ls.beginBatch();
    r.params->set ("filter_res", 0.9);
    ls.endBatch();
    poll();
    CHECK_EQ ((int) got.size(), 1);
    CHECK (! std::get<2> (got[0]));

    // "audio thread" writes (setValueNotifyingHost from another thread) only flip atomics
    std::thread th ([&] { for (int i = 0; i < 200; ++i) r.proc.apvts.getParameter ("drive_amount")->setValueNotifyingHost ((float) (i % 10) / 10.0f); });
    th.join();
    poll();
    bool sawDrive = false;
    for (auto& g : got) sawDrive = sawDrive || (std::get<0> (g) == "drive_amount" && std::get<2> (g));
    CHECK (sawDrive);
}

TEST (apvts_golden_defaults_first_load_save_and_chunk)
{
    ApRig r ("ap_golden");
    CHECK (r.store->rescan().ok);
    // dirty everything first: load must reset to declared defaults, then apply the file
    r.params->set ("unison_on", 1);
    r.params->set ("voices", 12);
    r.params->set ("osc1_sub_level", 0.9);
    const std::string id = "snd_00000000-0000-4000-8000-000000005001";
    auto lr = r.store->load (id);
    CHECK (lr.ok);
    const auto snap = r.params->snapshot();
    CHECK_EQ (std::get<double> (snap.at ("filter_cutoff_hz")), 95.5);
    CHECK_EQ (std::get<double> (snap.at ("filter_res")), 0.35);
    CHECK_EQ (std::get<double> (snap.at ("drive_amount")), 0.62);
    CHECK_EQ (std::get<std::string> (snap.at ("osc1_wave")), std::string ("saw"));
    CHECK_EQ (std::get<double> (snap.at ("osc1_sub_level")), 0.25);   // not in the file -> declared default (APVTS default 0.25)
    CHECK_EQ (std::get<bool> (snap.at ("unison_on")), false);
    CHECK_EQ (lr.value.unknown, (std::vector<std::string> { "legacy_removed_param" }));
    // the store's own writes did not mark the preset dirty, and the UI still gets its param events
    ApcBackend backend;
    backend.params = r.params.get();
    backend.presets = r.store.get();
    std::vector<std::pair<std::string, juce::var>> events;
    std::mutex qm; std::deque<std::function<void()>> q;
    backend.post = [&] (std::function<void()> f) { std::lock_guard<std::mutex> g (qm); q.push_back (std::move (f)); };
    ApcBridge bridge (backend);
    bridge.setEmitter ([&] (const std::string& e, const juce::var& v) { events.emplace_back (e, v); });
    bridge.pollNow();
    { std::lock_guard<std::mutex> g (qm); for (auto& f : q) f(); q.clear(); }
    int paramEvents = 0;
    for (auto& e : events) if (e.first == "param") ++paramEvents;
    CHECK (paramEvents >= 4);
    CHECK (! r.store->isDirty());
    // a real user gesture does
    r.params->set ("filter_cutoff_hz", 700.0);
    bridge.pollNow();
    CHECK (r.store->isDirty());

    // Save As: clean decimals, choice as label, unknown key preserved, FULL snapshot
    apc::presets::SaveRequest sr; sr.name = "APVTS Copy"; sr.saveAs = true;
    auto saved = r.store->save (sr);
    CHECK (saved.ok);
    const auto text = t::slurp (pu::pathOf (saved.value.path));
    CHECK (text.find ("0.349999") == std::string::npos);
    const auto doc = t::parseV (text);
    const auto params = pu::get (doc, "params");
    CHECK_EQ (pu::getNum (params, "filter_res"), 0.35);
    CHECK_EQ (pu::getStr (params, "osc1_wave"), std::string ("saw"));
    CHECK_EQ (pu::getNum (params, "legacy_removed_param"), 1.5);
    CHECK_EQ (pu::getNum (params, "filter_cutoff_hz"), 700.0);
    CHECK (pu::get (params, "unison_on").isBool());
    // voices (int) and macro1 are not in this fixture's decl list? they ARE declared by the APVTS: full snapshot
    CHECK (pu::has (params, "voices"));
    CHECK ((pu::get (params, "voices").isInt() || pu::get (params, "voices").isInt64()));
    CHECK_EQ ((int) pu::getNum (params, "voices"), 4);

    // chunk: change things (incl. engine), serialize, scramble, restore -> identical
    r.engine = t::parseV ("{\"oversampling\":4,\"quality\":\"ultra\",\"voices\":8}");
    r.params->set ("osc1_wave", 2);
    r.params->set ("voices", 9);
    const auto chunk = r.store->serializeChunk();
    CHECK (chunk.ok);
    const auto before = r.params->snapshot();
    r.params->set ("osc1_wave", 0); r.params->set ("voices", 1); r.params->set ("filter_cutoff_hz", 20);
    r.engine = pu::newObject();
    auto rest = r.store->restoreChunk (chunk.value.data(), chunk.value.size());
    CHECK (rest.ok);
    const auto after = r.params->snapshot();
    CHECK (before == after);
    CHECK_EQ ((int) pu::getNum (r.engine, "oversampling"), 4);
    CHECK_EQ (pu::getStr (r.engine, "quality"), std::string ("ultra"));
    CHECK (rest.value.engineApplied);
    bridge.shutdown();
}

TEST (apvts_through_the_bridge_dispatcher)
{
    ApRig r ("ap_bridge", false);
    ApcBackend backend;
    backend.params = r.params.get();
    backend.post = [] (std::function<void()> f) { f(); };
    ApcBridge bridge (backend);
    auto call = [&] (const char* name, const char* json) { juce::var out; juce::Array<juce::var> a; a.add (t::parseV (json)); bridge.invoke (name, a, [&] (juce::var v) { out = v; }); return out; };
    const auto list = call ("apc.params.list", "{}");
    CHECK (list.isArray());
    CHECK_EQ ((int) list.getArray()->size(), 11);
    const auto set = call ("apc.param.set", "{\"id\":\"filter_cutoff_hz\",\"value\":1234.5}");
    CHECK_EQ (pu::getNum (set, "value"), 1234.5);
    CHECK_EQ (pu::getNum (call ("apc.params.get", "{\"id\":\"filter_cutoff_hz\"}"), "value"), 1234.5);
    CHECK_EQ (pu::getStr (call ("apc.param.set", "{\"id\":\"zzz\",\"value\":1}"), "error"), std::string ("unknown_param"));
    bridge.shutdown();
}
