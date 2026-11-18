// ApcApvtsParams.h - IParamAccess (the bridge's parameter source) and apc::presets::LiveState (the preset store's
// parameter source) over a juce::AudioProcessorValueTreeState. Needs juce_audio_processors.
//
//   One class, ONE parameter walk: the descriptors, the ParamDecl list (ids, kinds, ranges, choice labels) and the
//   full-state snapshot all come from the APVTS you already built - nothing is hand-maintained (P-07, X-01).
//
// Units (CONTRACT rule 7): descriptor min/max/default/value are REAL-WORLD (Hz, dB, ms ...), never 0..1, except for a
// parameter whose ParamTable entry says "normalized": true. A choice parameter travels as its INDEX on the bridge
// (descriptor.choices has the labels) and as its LABEL in preset files (P-04); this class converts at the edge.
//
// Threading: parameterChanged() may run on the audio thread -> it only touches atomics. Everything else: message thread.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "ApcWebBridge.h"

namespace apc::web
{
class ApvtsParams : public IParamAccess
{
public:
    // modulationFor: optional, returns the descriptor's `modulation` array for a parameter id.
    ApvtsParams (juce::AudioProcessorValueTreeState& apvts, const ParamTable& table,
                 std::function<juce::var (const std::string&)> modulationFor = {})
        : apvts_ (apvts), table_ (table), modulationFor_ (std::move (modulationFor))
    {
        for (auto* p : apvts_.processor.getParameters())
        {
            auto* ranged = dynamic_cast<juce::RangedAudioParameter*> (p);
            auto* withId = dynamic_cast<juce::AudioProcessorParameterWithID*> (p);
            if (ranged == nullptr || withId == nullptr) continue;
            auto e = std::make_unique<Entry>();
            e->suppress = &suppressDirty_;
            e->param = ranged;
            e->id = withId->paramID.toStdString();
            e->choice = dynamic_cast<juce::AudioParameterChoice*> (p);
            e->isBool = dynamic_cast<juce::AudioParameterBool*> (p) != nullptr || (p->isBoolean() && e->choice == nullptr);
            e->isInt = dynamic_cast<juce::AudioParameterInt*> (p) != nullptr;
            byId_[e->id] = e.get();
            entries_.push_back (std::move (e));
        }
        for (auto& e : entries_) apvts_.addParameterListener (juce::String (e->id), e.get());
    }

    ~ApvtsParams() override
    {
        for (auto& e : entries_) apvts_.removeParameterListener (juce::String (e->id), e.get());
    }

    // ---------------------------------------------------------------- IParamAccess
    std::vector<ParamDescriptor> list() override
    {
        std::vector<ParamDescriptor> out;
        for (auto& e : entries_) out.push_back (describe (*e));
        return out;
    }

    std::optional<ParamDescriptor> get (const std::string& id) override
    {
        const auto it = byId_.find (id);
        if (it == byId_.end()) return std::nullopt;
        return describe (*it->second);
    }

    Result<double> set (const std::string& id, double value) override
    {
        Entry* e = find (id);
        if (e == nullptr) return Result<double>::fail ("unknown_param", "Unknown parameter \"" + id + "\".");
        const float norm = toNormalised (*e, value);
        const bool jump = ! e->gestureOpen;
        if (jump) e->param->beginChangeGesture();
        e->param->setValueNotifyingHost (norm);
        if (jump) e->param->endChangeGesture();
        return Result<double>::success (toBridgeValue (*e, e->param->getValue()));
    }

    Status begin (const std::string& id) override
    {
        Entry* e = find (id);
        if (e == nullptr) return Status::fail ("unknown_param", "Unknown parameter \"" + id + "\".");
        if (! e->gestureOpen) { e->param->beginChangeGesture(); e->gestureOpen = true; }
        return Status::success();
    }

    Status end (const std::string& id) override
    {
        Entry* e = find (id);
        if (e == nullptr) return Status::fail ("unknown_param", "Unknown parameter \"" + id + "\".");
        if (e->gestureOpen) { e->param->endChangeGesture(); e->gestureOpen = false; }
        return Status::success();
    }

    Result<double> reset (const std::string& id) override
    {
        Entry* e = find (id);
        if (e == nullptr) return Result<double>::fail ("unknown_param", "Unknown parameter \"" + id + "\".");
        const bool jump = ! e->gestureOpen;
        if (jump) e->param->beginChangeGesture();
        e->param->setValueNotifyingHost (e->param->getDefaultValue());
        if (jump) e->param->endChangeGesture();
        return Result<double>::success (toBridgeValue (*e, e->param->getValue()));
    }

    void collectChanged (const std::function<void (const std::string&, double, bool)>& cb) override
    {
        for (auto& e : entries_)
        {
            const auto f = e->flags.exchange (0, std::memory_order_acq_rel);
            if (f == 0) continue;
            cb (e->id, toBridgeValue (*e, e->param->getValue()), (f & kUser) != 0);
        }
    }

    // ---------------------------------------------------------------- preset store side
    std::vector<apc::ParamDecl> decls() const
    {
        std::vector<apc::ParamDecl> out;
        for (auto& e : entries_)
        {
            apc::ParamDecl d;
            d.id = e->id;
            const auto range = e->param->getNormalisableRange();
            if (e->choice != nullptr)
            {
                d.kind = apc::ParamKind::Choice;
                for (const auto& c : e->choice->choices) d.choices.push_back (c.toStdString());
                const int idx = juce::jlimit (0, juce::jmax (0, (int) d.choices.size() - 1), (int) std::lround (range.convertFrom0to1 (e->param->getDefaultValue())));
                d.defaultValue = std::string (d.choices.empty() ? "" : d.choices[(std::size_t) idx]);
            }
            else if (e->isBool)
            {
                d.kind = apc::ParamKind::Bool;
                d.defaultValue = e->param->getDefaultValue() > 0.5f;
            }
            else
            {
                d.kind = e->isInt ? apc::ParamKind::Int : apc::ParamKind::Float;
                d.minValue = range.start;
                d.maxValue = range.end;
                d.defaultValue = cleanFloat (range.convertFrom0to1 (e->param->getDefaultValue()));
            }
            out.push_back (std::move (d));
        }
        return out;
    }

    std::map<std::string, apc::Value> snapshot() const
    {
        std::map<std::string, apc::Value> out;
        for (auto& e : entries_)
        {
            const auto range = e->param->getNormalisableRange();
            const float real = range.convertFrom0to1 (e->param->getValue());
            if (e->choice != nullptr)
            {
                const int idx = juce::jlimit (0, juce::jmax (0, e->choice->choices.size() - 1), (int) std::lround (real));
                out[e->id] = std::string (e->choice->choices.isEmpty() ? "" : e->choice->choices[idx].toStdString());
            }
            else if (e->isBool) out[e->id] = e->param->getValue() > 0.5f;
            else out[e->id] = cleanFloat (real);
        }
        return out;
    }

    void applyValue (const apc::ParamDecl& d, const apc::Value& v)
    {
        Entry* e = find (d.id);
        if (e == nullptr) return;
        float norm = e->param->getValue();
        const auto range = e->param->getNormalisableRange();
        if (const auto* s = std::get_if<std::string> (&v))
        {
            if (e->choice != nullptr)
            {
                const int idx = e->choice->choices.indexOf (juce::String (*s));
                if (idx >= 0) norm = range.convertTo0to1 ((float) idx);
            }
        }
        else if (const auto* b = std::get_if<bool> (&v)) norm = *b ? 1.0f : 0.0f;
        else if (const auto* x = std::get_if<double> (&v)) norm = range.convertTo0to1 (range.snapToLegalValue ((float) *x));
        const bool jump = ! e->gestureOpen;
        if (jump) e->param->beginChangeGesture();
        e->param->setValueNotifyingHost (norm);
        if (jump) e->param->endChangeGesture();
    }

    // Ready-to-use LiveState: decls + snapshot + apply + "this is a preset apply, do not mark the preset dirty".
    // Fill snapshotExtras/applyExtras/getEngine/setEngine yourself for modulation, structured chunks and engine state.
    apc::presets::LiveState liveState()
    {
        apc::presets::LiveState ls;
        ls.decls = decls();
        ls.snapshotParams = [this] { return snapshot(); };
        ls.setParam = [this] (const apc::ParamDecl& d, const apc::Value& v) { applyValue (d, v); };
        // a preset apply supersedes any not-yet-polled user edit: drop those marks, then suppress new ones
        ls.beginBatch = [this] { for (auto& e : entries_) e->flags.fetch_and ((std::uint8_t) ~kUser); suppressDirty_.store (true); };
        ls.endBatch = [this] { suppressDirty_.store (false); };
        return ls;
    }

    std::vector<std::string> ids() const
    {
        std::vector<std::string> out;
        for (auto& e : entries_) out.push_back (e->id);
        return out;
    }

    // Round a float32 parameter value to 6 significant digits: 0.35f -> 0.35 (not 0.3499999940395355) and a value that
    // went through a skewed 0..1 mapping and back (1000 Hz -> 1000.0002) comes out as the 1000 the user typed.
    // 6 digits is inside the float32 resolution even after the skew amplifies the error.
    static double cleanFloat (float f)
    {
        char buf[32];
        std::snprintf (buf, sizeof (buf), "%.6g", (double) f);
        return std::strtod (buf, nullptr);
    }

private:
    static constexpr std::uint8_t kUi = 1, kUser = 2;

    // One listener per parameter: the audio thread never looks anything up, allocates or locks - it flips an atomic.
    struct Entry : juce::AudioProcessorValueTreeState::Listener
    {
        void parameterChanged (const juce::String&, float) override
        {
            flags.fetch_or (suppress->load (std::memory_order_relaxed) ? kUi : (std::uint8_t) (kUi | kUser), std::memory_order_acq_rel);
        }
        std::atomic<bool>* suppress = nullptr;
        juce::RangedAudioParameter* param = nullptr;
        juce::AudioParameterChoice* choice = nullptr;
        std::string id;
        bool isBool = false, isInt = false;
        bool gestureOpen = false;
        std::atomic<std::uint8_t> flags { 0 };
    };

    Entry* find (const std::string& id) const
    {
        const auto it = byId_.find (id);
        return it == byId_.end() ? nullptr : it->second;
    }

    bool isNormalised (const Entry& e) const
    {
        const auto* m = table_.find (e.id);
        return m != nullptr && m->normalized;
    }

    float toNormalised (const Entry& e, double v) const
    {
        if (isNormalised (e)) return juce::jlimit (0.0f, 1.0f, (float) v);
        const auto range = e.param->getNormalisableRange();
        if (e.choice != nullptr || e.isBool || e.isInt) v = std::round (v);
        return range.convertTo0to1 (range.snapToLegalValue ((float) v));
    }

    double toBridgeValue (const Entry& e, float normalised) const
    {
        if (isNormalised (e)) return cleanFloat (normalised);
        const auto range = e.param->getNormalisableRange();
        return cleanFloat (range.convertFrom0to1 (normalised));
    }

    ParamDescriptor describe (const Entry& e) const
    {
        ParamDescriptor d;
        d.id = e.id;
        const auto* m = table_.find (e.id);
        const auto range = e.param->getNormalisableRange();
        d.name = (m != nullptr && ! m->name.empty()) ? m->name : e.param->getName (128).toStdString();
        d.unit = (m != nullptr && ! m->unit.empty()) ? m->unit : e.param->getLabel().toStdString();
        if (m != nullptr) { d.group = m->group; d.help = m->help; d.midiCc = m->midiCc; }
        if (isNormalised (e))
        {
            d.normalized = true;
            d.min = 0.0; d.max = 1.0;
            d.def = cleanFloat (e.param->getDefaultValue());
            d.value = cleanFloat (e.param->getValue());
        }
        else
        {
            d.min = cleanFloat (range.start);
            d.max = cleanFloat (range.end);
            d.def = cleanFloat (range.convertFrom0to1 (e.param->getDefaultValue()));
            d.value = cleanFloat (range.convertFrom0to1 (e.param->getValue()));
            if (range.interval > 0.0f) d.step = cleanFloat (range.interval);
            if (range.skew != 1.0f) d.skew = cleanFloat (range.skew);
        }
        if (e.choice != nullptr)
        {
            for (const auto& c : e.choice->choices) d.choices.push_back (c.toStdString());
            d.step = 1.0;
        }
        else if (e.isBool || e.isInt) d.step = 1.0;
        if (modulationFor_) d.modulation = modulationFor_ (e.id);
        return d;
    }

    juce::AudioProcessorValueTreeState& apvts_;
    const ParamTable& table_;
    std::function<juce::var (const std::string&)> modulationFor_;
    std::vector<std::unique_ptr<Entry>> entries_;
    std::map<std::string, Entry*> byId_;
    std::atomic<bool> suppressDirty_ { false };
};

} // namespace apc::web
