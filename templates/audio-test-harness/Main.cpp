// APC audio test harness - JUCE 9 console app.
//
// Loads a VST3 (AudioPluginFormatManager, headless formats), renders a test
// signal offline through processBlock and emits a metrics JSON. Driven by
// scripts/apc-audio.js; can also be run by hand:
//
//   apc_audio_harness --plugin Foo.vst3 --signal pink --sr 48000 --block 512
//                     --seconds 2 --out metrics.json --write-wav out.wav
//
// Exit codes: 0 rendered, 2 usage error, 3 plugin could not be loaded,
//             4 render/reference error. On any error a JSON with "ok": false
//             is still written so the caller never has to parse stderr.

#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_processors_headless/juce_audio_processors_headless.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
#include <memory>
#include <vector>

namespace
{
constexpr const char* kSchema  = "apc-audio-harness/1";
constexpr double      kFloorDb = -200.0; // reported instead of -inf (keeps the JSON valid)
constexpr double      kTailWindowSeconds = 0.25; // measurement window rendered after the declared tail

struct Options
{
    juce::String pluginPath;
    juce::String signal      = "pink";
    juce::String outPath;
    juce::String wavPath;
    juce::String referencePath;
    double sampleRate        = 48000.0;
    int    blockSize         = 512;
    double seconds           = 2.0;  // length of the test signal itself
    double tailSeconds       = 0.0;  // extra input silence rendered after the signal
    int    seed              = 1;
    bool   sanitize          = false;
    bool   help              = false;
};

std::map<juce::String, juce::String> parseFlags (int argc, char** argv, bool& ok)
{
    std::map<juce::String, juce::String> flags;
    ok = true;
    for (int i = 1; i < argc; ++i)
    {
        juce::String a = juce::String::fromUTF8 (argv[i]);
        if (! a.startsWith ("--")) { ok = false; flags["_bad"] = a; continue; }
        a = a.substring (2);
        if (a == "sanitize" || a == "help") { flags[a] = "1"; continue; }
        if (i + 1 >= argc) { ok = false; flags["_bad"] = "--" + a + " needs a value"; continue; }
        flags[a] = juce::String::fromUTF8 (argv[++i]);
    }
    return flags;
}

double toDb (double linear) { return linear > 1.0e-10 ? juce::jmax (kFloorDb, 20.0 * std::log10 (linear)) : kFloorDb; }

//==============================================================================
// Deterministic RNG so every platform renders the same input.
struct XorShift
{
    explicit XorShift (uint32_t s) : state (s ? s : 0x9E3779B9u) {}
    uint32_t next() { state ^= state << 13; state ^= state >> 17; state ^= state << 5; return state; }
    float    uniform() { return (float) (next() >> 8) * (1.0f / 8388608.0f) * 2.0f - 1.0f; } // [-1, 1)
    uint32_t state;
};

// Paul Kellet's economy pink filter.
struct PinkFilter
{
    float b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    float process (float white)
    {
        b0 = 0.99886f * b0 + white * 0.0555179f;
        b1 = 0.99332f * b1 + white * 0.0750759f;
        b2 = 0.96900f * b2 + white * 0.1538520f;
        b3 = 0.86650f * b3 + white * 0.3104856f;
        b4 = 0.55000f * b4 + white * 0.5329522f;
        b5 = -0.7616f * b5 - white * 0.0168980f;
        const float out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362f;
        b6 = white * 0.115926f;
        return out * 0.11f;
    }
};

/** Builds the whole input up-front so the signal is independent of block size. */
juce::AudioBuffer<float> makeSignal (const juce::String& type, int channels, double sr,
                                     double seconds, double tailSeconds, int seed,
                                     int& signalFrames)
{
    const int sigFrames  = (int) std::llround (seconds * sr);
    const int tailFrames = (int) std::llround (tailSeconds * sr);
    const int windowFrames = (int) std::llround (kTailWindowSeconds * sr);
    const int total      = sigFrames + (type == "silence-after-signal" ? tailFrames + windowFrames : 0);
    signalFrames = sigFrames;

    juce::AudioBuffer<float> buf (juce::jmax (1, channels), juce::jmax (1, total));
    buf.clear();

    for (int ch = 0; ch < buf.getNumChannels(); ++ch)
    {
        float* d = buf.getWritePointer (ch);
        XorShift rng ((uint32_t) (seed * 7919 + ch * 104729 + 1));
        PinkFilter pink;

        if (type == "impulse")
        {
            d[0] = 1.0f;
        }
        else if (type == "sweep")
        {
            const double f0 = 20.0, f1 = juce::jmin (20000.0, sr * 0.45);
            const double k  = std::log (f1 / f0);
            const double T  = juce::jmax (1.0e-3, seconds);
            const double w0 = juce::MathConstants<double>::twoPi * f0 * T / k;
            for (int i = 0; i < sigFrames; ++i)
            {
                const double t = (double) i / sr;
                d[i] = 0.5f * (float) std::sin (w0 * (std::exp (t * k / T) - 1.0));
            }
        }
        else if (type == "sine")
        {
            for (int i = 0; i < sigFrames; ++i)
                d[i] = 0.5f * (float) std::sin (juce::MathConstants<double>::twoPi * 1000.0 * i / sr);
        }
        else if (type == "fullscale")
        {
            const int half = juce::jmax (1, (int) (sr / 200.0)); // 100 Hz square, +-1.0
            for (int i = 0; i < sigFrames; ++i)
                d[i] = ((i / half) & 1) ? -1.0f : 1.0f;
        }
        else if (type == "pink" || type == "silence-after-signal")
        {
            for (int i = 0; i < sigFrames; ++i)
                d[i] = juce::jlimit (-0.9f, 0.9f, 2.5f * pink.process (rng.uniform()));
        }
        // "silence": all zeros
    }
    return buf;
}

//==============================================================================
struct Metrics
{
    double peak = 0, sumSq = 0;
    long long frames = 0;
    long long nanCount = 0, infCount = 0, denormalCount = 0;
    std::vector<double> blockMs;
    double totalMs = 0;
    int    reprepareCycles = 0, bypassedBlocks = 0;
};

juce::String quote (const juce::String& s) { return juce::JSON::toString (juce::var (s)); }

void writeResult (const Options& o, const juce::String& json)
{
    if (o.outPath.isNotEmpty())
    {
        juce::File f (juce::File::getCurrentWorkingDirectory().getChildFile (o.outPath));
        f.getParentDirectory().createDirectory();
        f.replaceWithText (json);
    }
    else
    {
        std::fputs (json.toRawUTF8(), stdout);
        std::fputc ('\n', stdout);
        std::fflush (stdout);
    }
}

int fail (const Options& o, int code, const juce::String& message)
{
    writeResult (o, "{\n  \"schema\": " + quote (kSchema) + ",\n  \"ok\": false,\n  \"error\": " + quote (message) + "\n}");
    std::fprintf (stderr, "apc_audio_harness: %s\n", message.toRawUTF8());
    return code;
}

void printHelp()
{
    std::puts (
        "apc_audio_harness --plugin <file.vst3> [options]\n"
        "  --signal impulse|sweep|sine|pink|fullscale|silence|silence-after-signal (default pink)\n"
        "  --sr <Hz> (48000)  --block <n> (512)  --seconds <s> (2)  --tail-seconds <s> (0)\n"
        "     silence-after-signal renders signal + tail + 0.25 s; tail_db = RMS dBFS of that last 0.25 s window\n"
        "  --seed <n> (1)     --out <metrics.json> (default: stdout)\n"
        "  --write-wav <f.wav>   write the rendered output (32-bit float WAV)\n"
        "  --reference <f.wav>   compare against a reference render -> max_abs_diff\n"
        "  --sanitize            stress mode: random block sizes (incl. 1), re-prepare cycles,\n"
        "                        interleaved processBlockBypassed. Build with -DAPC_SANITIZE=asan|ubsan\n"
        "                        for memory/UB detection; this flag only adds the stress pattern.");
}
} // namespace

//==============================================================================
int main (int argc, char** argv)
{
    juce::ScopedJuceInitialiser_GUI juceInit;

    bool parsed = true;
    auto flags = parseFlags (argc, argv, parsed);
    Options o;
    auto get = [&] (const char* k, const juce::String& def = {})
    {
        auto it = flags.find (k);
        return it == flags.end() ? def : it->second;
    };

    o.help          = flags.count ("help") > 0;
    o.pluginPath    = get ("plugin");
    o.signal        = get ("signal", "pink");
    o.outPath       = get ("out");
    o.wavPath       = get ("write-wav");
    o.referencePath = get ("reference");
    o.sampleRate    = get ("sr", "48000").getDoubleValue();
    o.blockSize     = get ("block", "512").getIntValue();
    o.seconds       = get ("seconds", "2").getDoubleValue();
    o.tailSeconds   = get ("tail-seconds", "0").getDoubleValue();
    o.seed          = get ("seed", "1").getIntValue();
    o.sanitize      = flags.count ("sanitize") > 0;

    if (o.help) { printHelp(); return 0; }
    if (! parsed || o.pluginPath.isEmpty())
        return fail (o, 2, "usage: --plugin <file.vst3> required" + (flags.count ("_bad") ? " (" + flags["_bad"] + ")" : juce::String()));

    static const juce::StringArray signals { "impulse", "sweep", "sine", "pink", "fullscale", "silence", "silence-after-signal" };
    if (! signals.contains (o.signal))                    return fail (o, 2, "unknown --signal " + o.signal);
    if (o.sampleRate < 8000.0 || o.sampleRate > 768000.0) return fail (o, 2, "--sr out of range");
    if (o.blockSize < 1 || o.blockSize > 65536)           return fail (o, 2, "--block out of range");
    if (o.seconds <= 0.0 || o.seconds > 600.0)            return fail (o, 2, "--seconds out of range");

    //-- load the plugin --------------------------------------------------------
    juce::File pluginFile (juce::File::getCurrentWorkingDirectory().getChildFile (o.pluginPath));
    if (! pluginFile.exists())
        return fail (o, 3, "plugin not found: " + pluginFile.getFullPathName());

    juce::AudioPluginFormatManager manager;
    juce::addHeadlessDefaultFormatsToManager (manager);

    juce::OwnedArray<juce::PluginDescription> descriptions;
    for (auto* format : manager.getFormats())
        if (format->fileMightContainThisPluginType (pluginFile.getFullPathName()))
            format->findAllTypesForFile (descriptions, pluginFile.getFullPathName());

    if (descriptions.isEmpty())
        return fail (o, 3, "no plugin types found in " + pluginFile.getFullPathName());

    juce::String loadError;
    std::unique_ptr<juce::AudioPluginInstance> plugin =
        manager.createPluginInstance (*descriptions[0], o.sampleRate, o.blockSize, loadError);
    if (plugin == nullptr)
        return fail (o, 3, "could not instantiate plugin: " + loadError);

    plugin->enableAllBuses();
    const int numIn  = plugin->getTotalNumInputChannels();
    const int numOut = plugin->getTotalNumOutputChannels();
    if (numOut < 1) return fail (o, 3, "plugin has no output channels");

    plugin->setNonRealtime (true);
    plugin->setPlayConfigDetails (numIn, numOut, o.sampleRate, o.blockSize);
    plugin->prepareToPlay (o.sampleRate, o.blockSize);

    const bool isInstrument = plugin->acceptsMidi() && numIn == 0;

    //-- build input ------------------------------------------------------------
    int signalFrames = 0;
    auto input = makeSignal (o.signal, juce::jmax (1, numIn), o.sampleRate, o.seconds, o.tailSeconds, o.seed, signalFrames);
    const int totalFrames = input.getNumSamples();

    juce::AudioBuffer<float> output (numOut, totalFrames);
    output.clear();

    //-- render -----------------------------------------------------------------
    Metrics m;
    const int numCh = juce::jmax (numIn, numOut);
    juce::AudioBuffer<float> work (numCh, o.blockSize);
    juce::MidiBuffer midi;
    XorShift sizeRng ((uint32_t) (o.seed * 2654435761u + 17));

    if (! o.sanitize) // warm caches / lazy allocation outside the timed region
    {
        for (int i = 0; i < 4; ++i) { work.clear(); midi.clear(); plugin->processBlock (work, midi); }
        plugin->reset();
    }

    bool noteOn = false, noteOff = false;
    int pos = 0, blockIndex = 0;
    while (pos < totalFrames)
    {
        int n = juce::jmin (o.blockSize, totalFrames - pos);
        if (o.sanitize)
        {
            const uint32_t r = sizeRng.next();
            n = (r % 5 == 0) ? 1 : (int) (1 + r % (uint32_t) o.blockSize);
            n = juce::jmin (n, totalFrames - pos);
        }

        work.setSize (numCh, n, false, false, true);
        work.clear();
        for (int ch = 0; ch < numIn; ++ch)
            work.copyFrom (ch, 0, input, ch % input.getNumChannels(), pos, n);

        midi.clear();
        if (isInstrument)
        {
            if (! noteOn)                            { midi.addEvent (juce::MidiMessage::noteOn  (1, 60, (juce::uint8) 100), 0); noteOn = true; }
            if (! noteOff && pos + n > signalFrames) { midi.addEvent (juce::MidiMessage::noteOff (1, 60), juce::jmax (0, signalFrames - pos)); noteOff = true; }
        }

        if (o.sanitize && totalFrames > 4 * o.blockSize && m.reprepareCycles < 3 && blockIndex > 0 && blockIndex % 40 == 0)
        {
            plugin->releaseResources();
            plugin->prepareToPlay (o.sampleRate, o.blockSize);
            ++m.reprepareCycles;
        }

        const bool bypassThis = o.sanitize && (blockIndex % 16 == 15);
        const auto t0 = juce::Time::getHighResolutionTicks();
        if (bypassThis) { plugin->processBlockBypassed (work, midi); ++m.bypassedBlocks; }
        else            plugin->processBlock (work, midi);
        const auto t1 = juce::Time::getHighResolutionTicks();

        const double ms = juce::Time::highResolutionTicksToSeconds (t1 - t0) * 1000.0;
        m.blockMs.push_back (ms);
        m.totalMs += ms;

        for (int ch = 0; ch < numOut; ++ch)
            output.copyFrom (ch, pos, work, ch, 0, n);

        pos += n;
        ++blockIndex;
    }

    plugin->releaseResources();

    //-- analyse ----------------------------------------------------------------
    const int tailStart = o.signal == "silence-after-signal"
                              ? juce::jmin (totalFrames, signalFrames + (int) std::llround (o.tailSeconds * o.sampleRate))
                              : totalFrames;
    double tailSumSq = 0;
    long long tailCount = 0;

    for (int ch = 0; ch < numOut; ++ch)
    {
        const float* d = output.getReadPointer (ch);
        for (int i = 0; i < totalFrames; ++i)
        {
            const float v = d[i];
            switch (std::fpclassify (v))
            {
                case FP_NAN:       ++m.nanCount; continue;
                case FP_INFINITE:  ++m.infCount; continue;
                case FP_SUBNORMAL: ++m.denormalCount; break;
                default: break;
            }
            m.peak = juce::jmax (m.peak, (double) std::abs (v));
            m.sumSq += (double) v * v;
            ++m.frames;
            if (i >= tailStart) { tailSumSq += (double) v * v; ++tailCount; }
        }
    }

    const double rms = m.frames > 0 ? std::sqrt (m.sumSq / (double) m.frames) : 0.0;

    juce::String tailJson = "null";
    if (o.signal == "silence-after-signal" && tailCount > 0)
        tailJson = juce::String (toDb (std::sqrt (tailSumSq / (double) tailCount)), 2);

    // reference comparison ------------------------------------------------------
    juce::String diffJson = "null", refNote = "null";
    if (o.referencePath.isNotEmpty())
    {
        juce::AudioFormatManager fm;
        fm.registerBasicFormats();
        juce::File refFile (juce::File::getCurrentWorkingDirectory().getChildFile (o.referencePath));
        std::unique_ptr<juce::AudioFormatReader> reader (fm.createReaderFor (refFile));
        if (reader == nullptr)
            return fail (o, 4, "cannot read reference WAV " + refFile.getFullPathName());

        const int cmpCh = (int) juce::jmin ((juce::int64) numOut, (juce::int64) reader->numChannels);
        const int cmpN  = (int) juce::jmin ((juce::int64) totalFrames, reader->lengthInSamples);
        juce::AudioBuffer<float> ref (juce::jmax (1, cmpCh), juce::jmax (1, cmpN));
        reader->read (&ref, 0, cmpN, 0, true, true);

        double maxDiff = 0;
        for (int ch = 0; ch < cmpCh; ++ch)
            for (int i = 0; i < cmpN; ++i)
                maxDiff = juce::jmax (maxDiff, (double) std::abs (output.getSample (ch, i) - ref.getSample (ch, i)));

        if ((int) reader->numChannels != numOut || reader->lengthInSamples != totalFrames)
            refNote = quote ("reference shape differs: ref " + juce::String ((int) reader->numChannels) + "ch/"
                             + juce::String (reader->lengthInSamples) + " frames vs rendered "
                             + juce::String (numOut) + "ch/" + juce::String (totalFrames) + " frames");
        diffJson = juce::String (maxDiff, 9);
    }

    // optional WAV ---------------------------------------------------------------
    if (o.wavPath.isNotEmpty())
    {
        juce::File wavFile (juce::File::getCurrentWorkingDirectory().getChildFile (o.wavPath));
        wavFile.getParentDirectory().createDirectory();
        wavFile.deleteFile();
        std::unique_ptr<juce::OutputStream> stream = wavFile.createOutputStream();
        if (stream == nullptr) return fail (o, 4, "cannot write " + wavFile.getFullPathName());

        juce::WavAudioFormat wav;
        auto options = juce::AudioFormatWriterOptions{}
                           .withSampleFormat (juce::AudioFormatWriterOptions::SampleFormat::floatingPoint)
                           .withSampleRate (o.sampleRate)
                           .withNumChannels (numOut)
                           .withBitsPerSample (32);
        auto writer = wav.createWriterFor (stream, options);
        if (writer == nullptr) return fail (o, 4, "cannot create WAV writer for " + wavFile.getFullPathName());
        writer->writeFromAudioSampleBuffer (output, 0, totalFrames);
        writer.reset();
    }

    // timing ---------------------------------------------------------------------
    std::sort (m.blockMs.begin(), m.blockMs.end());
    const double medianMs = m.blockMs.empty() ? 0.0 : m.blockMs[m.blockMs.size() / 2];
    const double maxMs    = m.blockMs.empty() ? 0.0 : m.blockMs.back();
    const double meanMs   = m.blockMs.empty() ? 0.0 : m.totalMs / (double) m.blockMs.size();
    const double audioSec = (double) totalFrames / o.sampleRate;
    const double rtFactor = m.totalMs > 0.0 ? audioSec / (m.totalMs / 1000.0) : 0.0;
    const double tailLen  = plugin->getTailLengthSeconds();

    juce::String json;
    json << "{\n"
         << "  \"schema\": " << quote (kSchema) << ",\n"
         << "  \"ok\": true,\n"
         << "  \"plugin\": " << quote (descriptions[0]->name) << ",\n"
         << "  \"plugin_file\": " << quote (pluginFile.getFullPathName()) << ",\n"
         << "  \"signal\": " << quote (o.signal) << ",\n"
         << "  \"sample_rate\": " << juce::String (o.sampleRate, 1) << ",\n"
         << "  \"block_size\": " << o.blockSize << ",\n"
         << "  \"channels_in\": " << numIn << ",\n"
         << "  \"channels_out\": " << numOut << ",\n"
         << "  \"frames\": " << totalFrames << ",\n"
         << "  \"signal_frames\": " << signalFrames << ",\n"
         << "  \"is_instrument\": " << (isInstrument ? "true" : "false") << ",\n"
         << "  \"plugin_tail_seconds\": " << juce::String (std::isfinite (tailLen) ? tailLen : -1.0, 4) << ",\n"
         << "  \"peak\": " << juce::String (m.peak, 9) << ",\n"
         << "  \"peak_db\": " << juce::String (toDb (m.peak), 2) << ",\n"
         << "  \"rms\": " << juce::String (rms, 9) << ",\n"
         << "  \"rms_db\": " << juce::String (toDb (rms), 2) << ",\n"
         << "  \"nan_count\": " << m.nanCount << ",\n"
         << "  \"inf_count\": " << m.infCount << ",\n"
         << "  \"denormal_count\": " << m.denormalCount << ",\n"
         << "  \"tail_db\": " << tailJson << ",\n"
         << "  \"max_abs_diff\": " << diffJson << ",\n"
         << "  \"reference_note\": " << refNote << ",\n"
         << "  \"blocks\": " << (int) m.blockMs.size() << ",\n"
         << "  \"ms_per_block_mean\": " << juce::String (meanMs, 6) << ",\n"
         << "  \"ms_per_block_median\": " << juce::String (medianMs, 6) << ",\n"
         << "  \"ms_per_block_max\": " << juce::String (maxMs, 6) << ",\n"
         << "  \"realtime_factor\": " << juce::String (rtFactor, 2) << ",\n"
         << "  \"sanitize\": " << (o.sanitize ? "true" : "false") << ",\n"
         << "  \"reprepare_cycles\": " << m.reprepareCycles << ",\n"
         << "  \"bypassed_blocks\": " << m.bypassedBlocks << "\n"
         << "}";
    writeResult (o, json);
    return 0;
}
