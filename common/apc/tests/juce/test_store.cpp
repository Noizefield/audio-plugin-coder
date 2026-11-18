// Tests for common/apc/juce/ApcPresetStore.h (+ ApcPendingSwap.h). Real files, real JUCE, no mocks of the store itself.
#include "test_util.h"

#include "apc/juce/ApcPendingSwap.h"

#include <thread>

extern std::string g_xcheckDir;

namespace fs = std::filesystem;
namespace pu = apc::presets::util;
using namespace apc::presets;
using t::FakeLive;

namespace
{
struct Rig
{
    fs::path base;
    apc::PresetLayout layout;
    std::unique_ptr<FakeLive> live;
    std::unique_ptr<Store> store;
    StoreConfig cfg;
};

fs::path presetsDirOf (const Rig& r) { return r.layout.presets; }

// Copy a fixture tree (<name>/presets/**) into the rig's app-data root.
void installFixture (const Rig& r, const char* fixture)
{
    t::copyTree (t::fixtures() / fixture / "presets", r.layout.presets);
}

std::unique_ptr<Rig> makeRig (const std::string& name, bool flat, const char* fixture = nullptr, bool connect = true)
{
    auto r = std::make_unique<Rig>();
    r->base = t::freshDir (name);
    r->layout = t::layoutIn (r->base);
    r->cfg = flat ? t::flatConfig (r->layout) : t::typedConfig (r->layout);
    if (fixture != nullptr) installFixture (*r, fixture);
    r->live = std::make_unique<FakeLive> (flat ? t::flatDecls() : t::typedDecls());
    r->store = std::make_unique<Store> (r->cfg);
    if (connect) r->store->setLiveState (r->live->make());
    return r;
}

// rebuild the Store with a modified config (keeps files)
void recreate (Rig& r)
{
    r.store = std::make_unique<Store> (r.cfg);
    r.store->setLiveState (r.live->make());
}

std::string idOf (Store& s, const std::string& name)
{
    for (const auto& row : s.index()->rows) if (row.name == name) return row.id;
    return {};
}

const char* kSub = "snd_00000000-0000-4000-8000-000000000010";
const char* kGlass = "snd_00000000-0000-4000-8000-000000000011";
const char* kPatch = "pat_00000000-0000-4000-8000-000000000040";
} // namespace

// =============================================================================================
TEST (scan_typed_pack)
{
    auto r = makeRig ("scan_typed", false, "typed-valid");
    auto res = r->store->rescan();
    CHECK (res.ok);
    const auto idx = r->store->index();
    CHECK_EQ ((int) idx->rows.size(), 6);
    CHECK_EQ (res.value.scanned, 6);
    CHECK_EQ (res.value.reparsed, 6);
    CHECK (idx->errors.empty());
    // sorted by path, posix, relative to the presets folder
    std::vector<std::string> paths;
    for (const auto& row : idx->rows) paths.push_back (row.path);
    CHECK_EQ (paths, (std::vector<std::string> { "Typed_Factory/kits/Heavy_Impacts.kit", "Typed_Factory/patches/Dark_Obsidian.pat",
                                                 "Typed_Factory/sequences/Halftime_174.seq", "Typed_Factory/sounds/Glass_Pluck.snd",
                                                 "Typed_Factory/sounds/Init.snd", "Typed_Factory/sounds/Sub_Distort.snd" }));
    const auto* sub = idx->find (kSub);
    CHECK (sub != nullptr);
    if (sub != nullptr)
    {
        CHECK_EQ (sub->kind, std::string ("sound"));
        CHECK_EQ (sub->pack, std::string ("Typed_Factory"));
        CHECK_EQ (sub->name, std::string ("Sub Distort"));
        CHECK_EQ (sub->hash, apc::sha256Hex (t::slurp (r->layout.presets / "Typed_Factory/sounds/Sub_Distort.snd")));
        CHECK_EQ (sub->size, (std::int64_t) fs::file_size (r->layout.presets / "Typed_Factory/sounds/Sub_Distort.snd"));
        CHECK_EQ (pu::getStr (pu::get (sub->meta, "axes"), "bri"), std::string ("muted"));
        CHECK (sub->hasAuthor);
        CHECK_EQ (sub->author, std::string ("Fixture Author"));
    }
    CHECK (t::exists (r->layout.indexFile));   // disposable cache written
    CHECK_EQ (pu::getStr (t::parseV (t::slurp (r->layout.indexFile)), "schema"), std::string ("apc-index/1.0"));
}

TEST (scan_flat_pack)
{
    auto r = makeRig ("scan_flat", true, "flat-valid");
    CHECK (r->store->rescan().ok);
    const auto idx = r->store->index();
    CHECK_EQ ((int) idx->rows.size(), 3);
    CHECK_EQ (idx->rows[0].path, std::string ("Flat_Factory/Bright_Hall.preset"));
    for (const auto& row : idx->rows) CHECK_EQ (row.kind, std::string ("preset"));
}

TEST (index_invalidation_by_mtime_and_size)
{
    auto r = makeRig ("idx_inval", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    auto second = r->store->rescan();
    CHECK_EQ (second.value.reused, 6);
    CHECK_EQ (second.value.reparsed, 0);

    // change one file (size changes) -> exactly one reparse
    const auto f = r->layout.presets / "Typed_Factory/sounds/Glass_Pluck.snd";
    std::string txt = t::slurp (f);
    txt.insert (txt.find ("\"Glass Pluck\""), "  ");   // different size
    t::writeText (f, txt);
    auto third = r->store->rescan();
    CHECK_EQ (third.value.reparsed, 1);
    CHECK_EQ (third.value.reused, 5);

    // delete a file -> ghost row removed
    fs::remove (r->layout.presets / "Typed_Factory/sounds/Init.snd");
    auto fourth = r->store->rescan();
    CHECK_EQ (fourth.value.removed, 1);
    CHECK_EQ ((int) r->store->index()->rows.size(), 5);

    // stray files that are not assets: temp leftovers, samples, notes, hidden files
    t::writeText (r->layout.presets / "Typed_Factory/sounds/Half.snd.tmp-4242", "{");
    t::writeText (r->layout.presets / "Typed_Factory/sounds/notes.md", "# notes");
    t::writeText (r->layout.presets / "Typed_Factory/sounds/.hidden.snd", "{}");
    t::writeText (r->layout.presets / "Typed_Factory/sounds/old.snd.bak", "{}");
    CHECK (r->store->rescan().ok);
    CHECK_EQ ((int) r->store->index()->rows.size(), 5);
    CHECK (r->store->index()->errors.empty());

    // a broken asset is reported (never silently skipped) and does not poison the rest
    t::writeText (r->layout.presets / "Typed_Factory/sounds/Broken.snd", "{ not json");
    t::writeText (r->layout.presets / "Typed_Factory/sounds/NotAnAsset.snd", "{\"hello\": 1}");
    CHECK (r->store->rescan().ok);
    CHECK_EQ ((int) r->store->index()->rows.size(), 5);
    CHECK_EQ ((int) r->store->index()->errors.size(), 2);

    // the cache is disposable: garbage or deleted -> rebuilt, same result
    t::writeText (r->layout.indexFile, "garbage");
    auto fifth = r->store->rescan();
    CHECK (fifth.ok);
    CHECK_EQ (fifth.value.reused, 0);
    fs::remove (r->layout.indexFile);
    CHECK (r->store->rescan().ok);
    CHECK_EQ ((int) r->store->index()->rows.size(), 5);
}

TEST (tree_changed_detection)
{
    auto r = makeRig ("tree_changed", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    CHECK (! r->store->treeChanged());
    t::writeText (r->layout.presets / "User/sounds/New.snd", "{}");
    CHECK (r->store->treeChanged());
    CHECK (r->store->rescan().ok);
    CHECK (! r->store->treeChanged());
}

// =============================================================================================
TEST (list_scope_filters_search_sort)
{
    auto r = makeRig ("list_sem", false, "typed-valid");
    auto L = [&] (const char* q) { auto res = r->store->list (t::query (q)); CHECK (res.ok); return res.ok ? res.value : juce::var(); };

    CHECK_EQ (t::names (L ("{}")), (std::vector<std::string> { "Dark Obsidian", "Glass Pluck", "Halftime 174", "Heavy Impacts", "Init", "Sub Distort" }));
    CHECK_EQ ((int) pu::getNum (L ("{}"), "total"), 6);

    // scope: kind plural + pack name
    CHECK_EQ (t::names (L ("{\"scope\":\"sounds\"}")), (std::vector<std::string> { "Glass Pluck", "Init", "Sub Distort" }));
    CHECK_EQ (t::names (L ("{\"scope\":\"patches\"}")), (std::vector<std::string> { "Dark Obsidian" }));
    CHECK_EQ ((int) pu::getNum (L ("{\"scope\":\"Typed_Factory\"}"), "total"), 6);
    CHECK_EQ ((int) pu::getNum (L ("{\"scope\":\"pack:Nope\"}"), "total"), 0);
    CHECK_EQ ((int) pu::getNum (L ("{\"scope\":{\"pack\":\"Typed_Factory\"}}"), "total"), 6);

    // single group; OR inside a group
    CHECK_EQ (t::names (L ("{\"filters\":{\"category\":\"bass\"}}")), (std::vector<std::string> { "Sub Distort" }));
    CHECK_EQ (t::names (L ("{\"filters\":{\"category\":[\"bass\",\"pluck\"]}}")), (std::vector<std::string> { "Glass Pluck", "Sub Distort" }));
    CHECK_EQ (t::names (L ("{\"filters\":{\"mood\":[\"dark\"]}}")), (std::vector<std::string> { "Dark Obsidian", "Sub Distort" }));
    CHECK_EQ (t::names (L ("{\"filters\":{\"mood\":[\"dark\",\"ethereal\"]}}")), (std::vector<std::string> { "Dark Obsidian", "Glass Pluck", "Sub Distort" }));
    // AND across groups
    CHECK_EQ (t::names (L ("{\"filters\":{\"category\":\"bass\",\"mood\":\"dark\"}}")), (std::vector<std::string> { "Sub Distort" }));
    CHECK_EQ ((int) pu::getNum (L ("{\"filters\":{\"category\":\"bass\",\"mood\":\"ethereal\"}}"), "total"), 0);
    // explicit ANY = group inactive
    CHECK_EQ ((int) pu::getNum (L ("{\"filters\":{\"category\":\"any\",\"mood\":[]}}"), "total"), 6);
    // axis = threshold on the ordered word list; untagged assets never pass a strict axis filter
    CHECK_EQ (t::names (L ("{\"filters\":{\"axis\":{\"bri\":\"muted\"}}}")), (std::vector<std::string> { "Glass Pluck", "Sub Distort" }));   // muted, bright
    CHECK_EQ (t::names (L ("{\"filters\":{\"axis\":{\"bri\":\"bright\"}}}")), (std::vector<std::string> { "Glass Pluck" }));
    // the exact shapes apc-presets.js sends: { word, op } with gte (default) or lte, scope "all", minRating, tag/mood/genre arrays
    CHECK_EQ (t::names (L ("{\"scope\":\"all\",\"filters\":{\"axes\":{\"bri\":{\"word\":\"muted\",\"op\":\"gte\"}}}}")), (std::vector<std::string> { "Glass Pluck", "Sub Distort" }));
    CHECK_EQ (t::names (L ("{\"filters\":{\"axes\":{\"bri\":{\"word\":\"muted\",\"op\":\"lte\"}}}}")), (std::vector<std::string> { "Sub Distort" }));
    CHECK_EQ (t::names (L ("{\"filters\":{\"kind\":[],\"pack\":[],\"category\":[],\"mood\":[],\"genre\":[],\"tag\":[],\"axes\":{},\"favorite\":false,\"minRating\":0}}")).size(), (std::size_t) 6);
    CHECK_EQ (t::names (L ("{\"filters\":{\"axes\":{\"bri\":\"muted\",\"war\":\"warm\"}}}")), (std::vector<std::string> { "Sub Distort" }));
    CHECK_EQ ((int) pu::getNum (L ("{\"filters\":{\"axis\":{\"bri\":\"any\"}}}"), "total"), 6);
    // tags, genre (alias normalised, string or array in the file), kind filter
    CHECK_EQ (t::names (L ("{\"filters\":{\"tag\":\"reese\"}}")), (std::vector<std::string> { "Sub Distort" }));
    CHECK_EQ (t::names (L ("{\"filters\":{\"genre\":\"drum&bass\"}}")), (std::vector<std::string> { "Dark Obsidian", "Halftime 174", "Heavy Impacts" }));
    CHECK_EQ (t::names (L ("{\"filters\":{\"kind\":[\"kit\",\"sequence\"]}}")), (std::vector<std::string> { "Halftime 174", "Heavy Impacts" }));

    // search: case-insensitive substring over name+subcategory+desc+category+author+tags+mood
    CHECK_EQ (t::names (L ("{\"search\":\"GLASS\"}")), (std::vector<std::string> { "Glass Pluck" }));
    CHECK_EQ (t::names (L ("{\"search\":\"sub\"}")), (std::vector<std::string> { "Dark Obsidian", "Sub Distort" }));
    CHECK_EQ (t::names (L ("{\"search\":\"fixture author\"}")).size(), (std::size_t) 5);   // author is searchable (Init has none)
    CHECK_EQ (t::names (L ("{\"search\":\"ethereal\"}")), (std::vector<std::string> { "Glass Pluck" }));   // mood
    CHECK_EQ (t::names (L ("{\"search\":\"hybrid\"}")), (std::vector<std::string> { "Heavy Impacts" }));   // tag
    CHECK_EQ ((int) pu::getNum (L ("{\"search\":\"zzz-no-such\"}"), "total"), 0);

    // sort: true sorting, uncategorised last for type, missing bpm last
    CHECK_EQ (t::names (L ("{\"sort\":\"type\"}")), (std::vector<std::string> { "Sub Distort", "Dark Obsidian", "Heavy Impacts", "Glass Pluck", "Halftime 174", "Init" }));
    CHECK_EQ (t::names (L ("{\"sort\":\"bpm\"}")), (std::vector<std::string> { "Halftime 174", "Dark Obsidian", "Glass Pluck", "Heavy Impacts", "Init", "Sub Distort" }));
    CHECK_EQ (t::names (L ("{\"sort\":{\"key\":\"name\",\"dir\":\"desc\"}}")), (std::vector<std::string> { "Sub Distort", "Init", "Heavy Impacts", "Halftime 174", "Glass Pluck", "Dark Obsidian" }));
    CHECK_EQ (t::ids (L ("{\"sort\":\"path\"}")).front(), std::string ("kit_00000000-0000-4000-8000-000000000020"));   // index order

    // paging
    CHECK_EQ (t::names (L ("{\"limit\":2,\"offset\":1}")), (std::vector<std::string> { "Glass Pluck", "Halftime 174" }));
    CHECK_EQ ((int) pu::getNum (L ("{\"limit\":2,\"offset\":1}"), "total"), 6);

    // item shape = CONTRACT { id, kind, name, pack, meta, rating, favorite, mtime }
    const auto item = (*L ("{\"search\":\"glass\"}").getProperty ("items", juce::var()).getArray())[0];
    for (const char* k : { "id", "kind", "name", "pack", "meta", "rating", "favorite", "mtime" }) CHECK (pu::has (item, k));

    // structured errors for nonsense (never a silent empty list)
    auto bad = r->store->list (t::query ("{\"sort\":\"banana\"}"));
    CHECK (! bad.ok);
    CHECK_EQ (bad.error.code, std::string ("invalid"));
    CHECK (! r->store->list (t::query ("{\"filters\":{\"axis\":{\"zzz\":\"dark\"}}}")).ok);
    CHECK (! r->store->list (t::query ("{\"filters\":{\"axis\":{\"bri\":\"loud\"}}}")).ok);
    CHECK (! r->store->list (t::query ("{\"filters\":5}")).ok);
}

TEST (list_flat_layout)
{
    auto r = makeRig ("list_flat", true, "flat-valid");
    auto res = r->store->list (t::query ("{\"filters\":{\"category\":\"reverb\"},\"sort\":\"name\"}"));
    CHECK (res.ok);
    CHECK_EQ (t::names (res.value), (std::vector<std::string> { "Bright Hall", "Warm Plate" }));
    CHECK_EQ (t::names (r->store->list (t::query ("{\"filters\":{\"axis\":{\"spa\":\"hall\"}}}")).value), (std::vector<std::string> { "Warm Plate" }));
}

// =============================================================================================
TEST (user_data_sidecar_ratings_favorites)
{
    auto r = makeRig ("userdata", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    CHECK_EQ (r->store->setRating (kSub, 6).error.code, std::string ("invalid"));
    CHECK_EQ (r->store->setRating (kSub, -1).error.code, std::string ("invalid"));
    CHECK (r->store->setRating (kSub, 5).ok);
    CHECK (r->store->setRating (kGlass, 3).ok);
    CHECK (r->store->setFavorite ("snd_00000000-0000-4000-8000-000000000009", true).ok);

    // file is keyed by id, never by name
    const auto ud = t::parseV (t::slurp (r->layout.userDataFile));
    CHECK_EQ (pu::getStr (ud, "schema"), std::string ("apc-user-data/1.0"));
    CHECK_EQ ((int) pu::getNum (pu::get (pu::get (ud, "assets"), kSub), "rating"), 5);
    CHECK (pu::getBool (pu::get (pu::get (ud, "assets"), "snd_00000000-0000-4000-8000-000000000009"), "favorite"));

    // joins into list: sort by rating, rating/favorite filters
    CHECK_EQ (t::names (r->store->list (t::query ("{\"sort\":\"rating\"}")).value).front(), std::string ("Sub Distort"));
    CHECK_EQ (t::names (r->store->list (t::query ("{\"sort\":\"rating\"}")).value)[1], std::string ("Glass Pluck"));
    CHECK_EQ (t::names (r->store->list (t::query ("{\"filters\":{\"rating\":4}}")).value), (std::vector<std::string> { "Sub Distort" }));
    CHECK_EQ (t::names (r->store->list (t::query ("{\"filters\":{\"favorite\":true}}")).value), (std::vector<std::string> { "Init" }));

    // survives a rescan and a brand-new Store instance (a rename would not matter: keyed by id)
    CHECK (r->store->rescan (true).ok);
    Store again (r->cfg);
    CHECK_EQ (again.userEntry (kSub).rating, 0);   // not loaded yet ...
    CHECK (again.rescan().ok);
    CHECK_EQ (again.userEntry (kSub).rating, 5);   // ... loaded by the scan
    for (const auto& row : again.index()->rows) if (row.id == kSub) CHECK_EQ (row.rating, 5);

    // unknown keys written by a newer version are carried through a write
    auto doc = t::parseV (t::slurp (r->layout.userDataFile));
    pu::set (doc, "future_section", 42);
    pu::set (pu::get (pu::get (doc, "assets"), kGlass), "note", "keep me");
    t::writeText (r->layout.userDataFile, pu::toJsonText (doc));
    CHECK (r->store->setRating (kGlass, 4).ok);
    const auto after = t::parseV (t::slurp (r->layout.userDataFile));
    CHECK_EQ ((int) pu::getNum (after, "future_section"), 42);
    CHECK_EQ (pu::getStr (pu::get (pu::get (after, "assets"), kGlass), "note"), std::string ("keep me"));
    CHECK_EQ ((int) pu::getNum (pu::get (pu::get (after, "assets"), kGlass), "rating"), 4);

    // damaged file: quarantined, new file started, warning queued - ratings are never silently lost
    t::writeText (r->layout.userDataFile, "{ broken");
    CHECK (r->store->setRating (kSub, 2).ok);
    bool quarantined = false;
    for (const auto& e : fs::directory_iterator (r->layout.userDataFile.parent_path()))
        if (e.path().filename().string().find ("user-data.json.corrupt-") == 0) quarantined = true;
    CHECK (quarantined);
    CHECK (! r->store->takeWarnings().empty());
}

TEST (user_data_concurrent_writers)
{
    auto r = makeRig ("userdata_mt", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    const std::vector<std::string> targets = { kSub, kGlass, kPatch, "snd_00000000-0000-4000-8000-000000000009" };
    std::vector<std::thread> th;
    std::atomic<int> failed { 0 };
    for (std::size_t i = 0; i < targets.size(); ++i)
        th.emplace_back ([&, i]
        {
            for (int n = 0; n < 15; ++n)
                if (! r->store->setRating (targets[i], 1 + (n % 5)).ok) ++failed;
        });
    for (auto& x : th) x.join();
    CHECK_EQ (failed.load(), 0);
    const auto ud = t::parseV (t::slurp (r->layout.userDataFile));
    for (const auto& id : targets) CHECK (pu::has (pu::get (ud, "assets"), id.c_str()));   // nobody lost another writer's update
}

// =============================================================================================
TEST (load_applies_defaults_first_and_reports)
{
    auto r = makeRig ("load", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    r->live->user ("unison_on", true);      // pre-existing non-default state must not leak into the loaded preset
    r->live->user ("filter_res", 0.9);
    r->live->setCalls = 0;
    auto res = r->store->load (kSub);
    CHECK (res.ok);
    CHECK_EQ (r->live->num ("filter_cutoff_hz"), 95.5);
    CHECK_EQ (r->live->num ("filter_res"), 0.35);
    CHECK_EQ (r->live->str ("osc1_wave"), std::string ("saw"));
    CHECK_EQ (std::get<bool> (r->live->values["unison_on"]), false);          // not in the file -> declared default
    CHECK_EQ (r->live->num ("osc1_sub_level"), 0.25);
    CHECK_EQ (r->live->setCalls, (int) r->live->decls.size());                // every declared param exactly once
    CHECK_EQ (r->live->batchDepth, 0);
    bool sawDefaulted = false;
    for (const auto& d : res.value.defaulted) sawDefaulted = sawDefaulted || d == "osc1_sub_level";
    CHECK (sawDefaulted);
    CHECK (res.value.readOnly);                                               // factory pack
    CHECK (! r->store->isDirty());
    CHECK_EQ (pu::getStr (pu::get (r->store->stateVar(), "current"), "name"), std::string ("Sub Distort"));

    // errors are structured
    auto missing = r->store->load ("snd_nope");
    CHECK (! missing.ok);
    CHECK_EQ (missing.error.code, std::string ("not_found"));
    Store noLive (r->cfg);
    CHECK (noLive.rescan().ok);
    CHECK_EQ (noLive.load (kSub).error.code, std::string ("no_live_state"));
    CHECK (! missing.error.message.empty());

    // damaged file: visible error with the path, state untouched
    const auto f = r->layout.presets / "Typed_Factory/sounds/Glass_Pluck.snd";
    t::writeText (f, "{ oops");
    CHECK (r->store->rescan().ok);
    CHECK (r->store->index()->find (kGlass) == nullptr);   // not even indexed
    t::writeText (f, t::slurp (t::fixtures() / "typed-valid/presets/Typed_Factory/sounds/Glass_Pluck.snd"));
    CHECK (r->store->rescan().ok);
    t::writeText (f, "{ oops");   // changed after the index: load itself must catch it
    const auto bad = r->store->load (kGlass);
    CHECK (! bad.ok);
    CHECK_EQ (bad.error.code, std::string ("bad_json"));
    CHECK (bad.error.path.find ("Glass_Pluck.snd") != std::string::npos);
    CHECK_EQ (r->live->num ("filter_cutoff_hz"), 95.5);
}

TEST (save_roundtrip_copy_on_write_and_overwrite_rules)
{
    auto r = makeRig ("save", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    const std::string factoryBefore = t::slurp (r->layout.presets / "Typed_Factory/sounds/Sub_Distort.snd");
    CHECK (r->store->load (kSub).ok);
    r->live->user ("filter_cutoff_hz", 400.0);
    r->live->user ("osc1_wave", std::string ("pulse"));
    r->store->notifyParamChanged();
    CHECK (r->store->isDirty());

    // Quick Save on a read-only factory asset == copy-on-write into User
    SaveRequest req;
    auto saved = r->store->save (req);
    CHECK (saved.ok);
    CHECK (saved.value.copiedFromReadOnly);
    CHECK_EQ (saved.value.pack, std::string ("User"));
    CHECK (saved.value.id != std::string (kSub));
    CHECK_EQ (saved.value.id.substr (0, 4), std::string ("snd_"));
    CHECK (t::exists (r->layout.presets / "User/sounds/Sub Distort.snd"));
    CHECK (t::exists (r->layout.presets / "User/pack.json"));
    CHECK_EQ (t::slurp (r->layout.presets / "Typed_Factory/sounds/Sub_Distort.snd"), factoryBefore);   // factory untouched
    CHECK (! r->store->isDirty());
    CHECK (! r->store->current().readOnly);

    const auto doc = t::parseV (t::slurp (r->layout.presets / "User/sounds/Sub Distort.snd"));
    CHECK_EQ (pu::getStr (doc, "schema"), std::string ("apc-preset/1.0"));
    CHECK_EQ (pu::getStr (doc, "derived_from"), std::string (kSub));
    CHECK_EQ (pu::getStr (doc, "app_version"), std::string ("1.1.0"));
    CHECK (! pu::has (doc, "engine"));          // asset files never carry engine state
    CHECK (! pu::has (doc, "state_version"));
    CHECK_EQ (pu::getNum (pu::get (doc, "params"), "filter_cutoff_hz"), 400.0);
    CHECK_EQ (pu::getStr (pu::get (doc, "params"), "osc1_wave"), std::string ("pulse"));   // choice stored as LABEL
    CHECK_EQ (pu::get (doc, "params").getDynamicObject()->getProperties().size(), 9);       // FULL snapshot, every declared param
    CHECK_EQ (pu::getStr (pu::get (doc, "meta"), "category"), std::string ("bass"));        // descriptive fields carried over

    // the list sees it at once (incremental index update) and a reload gives identical state
    CHECK_EQ ((int) pu::getNum (r->store->list (t::query ("{}")).value, "total"), 7);
    r->live->user ("filter_cutoff_hz", 1.0 * 20);
    CHECK (r->store->load (saved.value.id).ok);
    CHECK_EQ (r->live->num ("filter_cutoff_hz"), 400.0);
    CHECK_EQ (r->live->str ("osc1_wave"), std::string ("pulse"));

    // second Quick Save overwrites in place, keeps the id, leaves ONE .bak
    r->live->user ("filter_cutoff_hz", 777.0);
    r->store->notifyParamChanged();
    auto again = r->store->save (SaveRequest {});
    CHECK (again.ok);
    CHECK (! again.value.copiedFromReadOnly);
    CHECK_EQ (again.value.id, saved.value.id);
    CHECK (t::exists (r->layout.presets / "User/sounds/Sub Distort.snd.bak"));
    CHECK_EQ (pu::getNum (pu::get (t::parseV (t::slurp (r->layout.presets / "User/sounds/Sub Distort.snd.bak")), "params"), "filter_cutoff_hz"), 400.0);
    CHECK_EQ (pu::getNum (pu::get (t::parseV (t::slurp (r->layout.presets / "User/sounds/Sub Distort.snd")), "params"), "filter_cutoff_hz"), 777.0);
    CHECK_EQ ((int) pu::getNum (r->store->list (t::query ("{}")).value, "total"), 7);   // .bak is not an asset

    // Save As: a NEW id; a name collision with another file is an error unless confirmed
    SaveRequest as; as.name = "Other"; as.saveAs = true;
    auto other = r->store->save (as);
    CHECK (other.ok);
    CHECK (other.value.id != saved.value.id);
    SaveRequest clash; clash.name = "Sub Distort"; clash.saveAs = true;
    auto clashed = r->store->save (clash);
    CHECK (! clashed.ok);
    CHECK_EQ (clashed.error.code, std::string ("exists"));
    CHECK (clashed.error.path.find ("Sub Distort.snd") != std::string::npos);
    clash.overwrite = true;
    auto over = r->store->save (clash);
    CHECK (over.ok);
    CHECK (over.value.overwrote);
    CHECK_EQ (over.value.id, saved.value.id);   // the replaced file keeps its identity (ratings stay attached)

    // explicit save into a factory pack is refused
    SaveRequest toFactory; toFactory.name = "Nope"; toFactory.pack = "Typed_Factory"; toFactory.saveAs = true;
    CHECK_EQ (r->store->save (toFactory).error.code, std::string ("readonly"));
    // validation errors
    SaveRequest noName; noName.name = "   "; noName.saveAs = true;
    CHECK_EQ (r->store->save (noName).error.code, std::string ("name_required"));
    SaveRequest badKind; badKind.name = "X"; badKind.kind = "banana"; badKind.saveAs = true;
    CHECK_EQ (r->store->save (badKind).error.code, std::string ("bad_kind"));
    // sanitised file name (P-06)
    SaveRequest odd; odd.name = "A/B: C?"; odd.saveAs = true;
    auto oddR = r->store->save (odd);
    CHECK (oddR.ok);
    CHECK (t::exists (r->layout.presets / "User/sounds/A-B- C-.snd"));
    CHECK_EQ (pu::getStr (t::parseV (t::slurp (r->layout.presets / "User/sounds/A-B- C-.snd")), "name"), std::string ("A/B: C?"));   // display name keeps its characters
}

TEST (save_configuration_errors_and_license_gate)
{
    auto r = makeRig ("save_cfg", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    CHECK (r->store->load (kSub).ok);
    r->cfg.soundExt.clear();
    recreate (*r);
    SaveRequest req; req.name = "X"; req.saveAs = true; req.kind = "sound";
    auto e = r->store->save (req);
    CHECK_EQ (e.error.code, std::string ("no_extension"));
    CHECK (e.error.message.find ("preset.sound_ext") != std::string::npos);   // names the option, never invents one

    r->cfg.soundExt = ".snd";
    bool allow = false;
    r->cfg.gate = [&allow] (Gate) { return allow; };
    recreate (*r);
    CHECK (r->store->rescan().ok);
    CHECK (r->store->load (kSub).ok);
    auto gated = r->store->save (req);
    CHECK_EQ (gated.error.code, std::string ("gated"));
    CHECK (! t::exists (r->layout.presets / "User/sounds/X.snd"));
    CHECK_EQ (r->store->importAsset ("", "{}").error.code, std::string ("gated"));
    CHECK_EQ (r->store->exportPack ({ kSub }).error.code, std::string ("gated"));
    allow = true;
    CHECK (r->store->save (req).ok);

    // flat plugin: a typed kind is refused
    auto f = makeRig ("save_flat", true, "flat-valid");
    CHECK (f->store->rescan().ok);
    SaveRequest sr; sr.name = "Mine"; sr.kind = "sound"; sr.saveAs = true;
    CHECK_EQ (f->store->save (sr).error.code, std::string ("bad_kind"));
    sr.kind = "";
    auto ok = f->store->save (sr);
    CHECK (ok.ok);
    CHECK_EQ (ok.value.kind, std::string ("preset"));
    CHECK (t::exists (f->layout.presets / "User/Mine.preset"));   // flat: directly in the pack
}

TEST (atomic_write_kill_between_temp_and_rename)
{
    auto r = makeRig ("atomic", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    CHECK (r->store->load (kSub).ok);
    auto first = r->store->save (SaveRequest {});    // COW into User
    CHECK (first.ok);
    const auto file = r->layout.presets / "User/sounds/Sub Distort.snd";
    const std::string before = t::slurp (file);

    bool kill = false;
    r->cfg.atomic.fault = [&kill] (apc::FaultPoint p) { return kill && p == apc::FaultPoint::BeforeRename; };
    recreate (*r);
    CHECK (r->store->rescan().ok);
    CHECK (r->store->load (first.value.id).ok);
    CHECK (r->store->setRating (kSub, 4).ok);
    const std::string ud = t::slurp (r->layout.userDataFile);
    kill = true;
    r->live->user ("filter_cutoff_hz", 12345.0);
    r->store->notifyParamChanged();
    const auto res = r->store->save (SaveRequest {});
    CHECK (! res.ok);
    CHECK_EQ (res.error.code, std::string ("io"));
    CHECK (! res.error.message.empty());
    CHECK_EQ (t::slurp (file), before);                 // the old file is intact, byte for byte
    CHECK (r->store->isDirty());                        // and the user is told, state still dirty

    int temps = 0;
    for (const auto& e : fs::directory_iterator (file.parent_path()))
        if (e.path().filename().string().find (".tmp-") != std::string::npos) ++temps;
    CHECK_EQ (temps, 1);                                 // the "killed" process left its temp behind ...
    CHECK (r->store->rescan().ok);
    CHECK_EQ ((int) r->store->index()->rows.size(), 7);  // ... and it is never mistaken for an asset
    CHECK_EQ (apc::cleanupStaleTemps (file.parent_path(), 0), 1);

    // same for the user-data sidecar: failed write -> error + old file intact
    CHECK (! r->store->setRating (kSub, 1).ok);
    CHECK_EQ (t::slurp (r->layout.userDataFile), ud);

    kill = false;
    CHECK (r->store->save (SaveRequest {}).ok);
    CHECK_EQ (pu::getNum (pu::get (t::parseV (t::slurp (file)), "params"), "filter_cutoff_hz"), 12345.0);
}

// =============================================================================================
TEST (dirty_tracking_revert_init_and_ab_slots)
{
    auto r = makeRig ("ab", false, "typed-valid");
    // a plugin whose parameter listener fires DURING our apply must not make a fresh load dirty
    auto ls = r->live->make();
    auto inner = ls.setParam;
    ls.setParam = [&, inner] (const apc::ParamDecl& d, const apc::Value& v) { inner (d, v); r->store->notifyParamChanged(); };
    r->store->setLiveState (ls);
    CHECK (r->store->rescan().ok);
    CHECK (r->store->load (kGlass).ok);
    CHECK (! r->store->isDirty());

    // A/B
    CHECK_EQ (r->store->ab ("copyBtoA").error.code, std::string ("empty"));
    CHECK_EQ (r->store->ab ("banana").error.code, std::string ("invalid"));
    CHECK (! pu::getBool (pu::get (r->store->stateVar(), "ab"), "hasB"));
    r->live->user ("filter_cutoff_hz", 500.0);
    r->store->notifyParamChanged();
    CHECK (r->store->isDirty());
    CHECK (r->store->ab ("toggle").ok);                     // first toggle: B = copy of A, B active
    CHECK_EQ (pu::getStr (pu::get (r->store->stateVar(), "ab"), "active"), std::string ("B"));
    CHECK (pu::getBool (pu::get (r->store->stateVar(), "ab"), "hasB"));
    CHECK_EQ (r->live->num ("filter_cutoff_hz"), 500.0);
    r->live->user ("filter_cutoff_hz", 800.0);
    CHECK (r->store->ab ("toggle").ok);                     // back to A
    CHECK_EQ (r->live->num ("filter_cutoff_hz"), 500.0);
    CHECK (r->store->ab ("toggle").ok);                     // B again keeps its own edit
    CHECK_EQ (r->live->num ("filter_cutoff_hz"), 800.0);
    CHECK (r->store->isDirty());
    CHECK (r->store->ab ("toggle").ok);                     // on A (500)
    CHECK (r->store->ab ("copyAtoB").ok);                   // B := A
    CHECK (r->store->ab ("toggle").ok);
    CHECK_EQ (r->live->num ("filter_cutoff_hz"), 500.0);
    r->live->user ("filter_cutoff_hz", 900.0);              // B = 900, active B
    CHECK (r->store->ab ("copyBtoA").ok);                   // A := B(900); active slot is B so live unchanged
    CHECK (r->store->ab ("toggle").ok);
    CHECK_EQ (r->live->num ("filter_cutoff_hz"), 900.0);

    // revert = reload from disk, clears dirty
    CHECK (r->store->isDirty());
    CHECK (r->store->revert().ok);
    CHECK_EQ (r->live->num ("filter_cutoff_hz"), 95.5);
    CHECK (! r->store->isDirty());

    // Init = declared defaults (never random), also resets plugin-side structured state
    r->live->user ("filter_cutoff_hz", 4000.0);
    pu::set (r->live->extras, "modulation", pu::newArray());
    CHECK (r->store->init().ok);
    CHECK_EQ (r->live->num ("filter_cutoff_hz"), 1000.0);
    CHECK (! pu::has (r->live->extras, "modulation"));
    CHECK_EQ (pu::getStr (pu::get (r->store->stateVar(), "current"), "name"), std::string ("INIT"));
    CHECK_EQ (pu::getStr (pu::get (r->store->stateVar(), "current"), "id"), std::string ("init"));
    CHECK (pu::getBool (pu::get (r->store->stateVar(), "current"), "readOnly"));
    CHECK (! r->store->isDirty());
    CHECK_EQ (r->store->revert().ok, true);    // INIT: revert == init (no file)
    // quick Save on INIT has nowhere to write: it needs a name (the UI opens Save As); with a name it creates a normal asset
    CHECK_EQ (r->store->save (SaveRequest {}).error.code, std::string ("name_required"));

    // usage + recents join the sort keys
    CHECK (r->store->load (kGlass).ok);
    juce::Thread::sleep (6);
    CHECK (r->store->load (kGlass).ok);
    juce::Thread::sleep (6);
    CHECK (r->store->load (kSub).ok);
    CHECK_EQ (t::names (r->store->list (t::query ("{\"sort\":\"used\"}")).value).front(), std::string ("Glass Pluck"));
    CHECK_EQ (t::names (r->store->list (t::query ("{\"sort\":\"recent\"}")).value)[0], std::string ("Sub Distort"));
    CHECK_EQ (t::names (r->store->list (t::query ("{\"sort\":\"recent\"}")).value)[1], std::string ("Glass Pluck"));
}

// =============================================================================================
TEST (reference_resolution_and_missing_placeholder)
{
    auto r = makeRig ("refs", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    const auto patchFile = r->layout.presets / "Typed_Factory/patches/Dark_Obsidian.pat";
    auto doc = t::parseV (t::slurp (patchFile));

    auto refs = r->store->resolveReferences (doc, patchFile, "Typed_Factory");
    CHECK_EQ ((int) refs.size(), 3);                     // kit, its sound (transitive), sequence
    std::map<std::string, std::string> st;
    for (const auto& x : refs) st[x.where + "@" + std::to_string (x.depth)] = x.status;
    CHECK_EQ (st["kits[0]@0"], std::string ("found"));
    CHECK_EQ (st["slots[0]@1"], std::string ("found"));
    CHECK_EQ (st["sequences[0]@0"], std::string ("found"));

    // 1) kit file deleted -> [Missing: ...], the load itself still succeeds (never crash, never substitute silently)
    fs::remove (r->layout.presets / "Typed_Factory/kits/Heavy_Impacts.kit");
    CHECK (r->store->rescan().ok);
    auto res = r->store->load (kPatch);
    CHECK (res.ok);
    bool sawPlaceholder = false;
    for (const auto& w : res.value.warnings) sawPlaceholder = sawPlaceholder || w == "[Missing: Heavy_Impacts]";
    CHECK (sawPlaceholder);
    int unusable = 0;
    for (const auto& x : res.value.refs) if (! x.usable) { ++unusable; CHECK_EQ (x.status, std::string ("missing")); CHECK_EQ (x.placeholder, std::string ("[Missing: Heavy_Impacts]")); }
    CHECK_EQ (unusable, 1);
    CHECK (r->live->lastRefs.isArray());   // the plugin gets the resolution to render the badge

    // 2) absolute / escaping / wrong-kind / embedded
    auto mk = [&] (const char* json) { return t::parseV (json); };
    auto one = [&] (const juce::var& d) { auto v = r->store->resolveReferences (d, patchFile, "Typed_Factory"); return v.empty() ? RefInfo {} : v.front(); };
    CHECK_EQ (one (mk ("{\"kind\":\"patch\",\"kits\":[{\"ref\":\"C:/x/y.kit\"}]}")).status, std::string ("absolute"));
    CHECK_EQ (one (mk ("{\"kind\":\"patch\",\"kits\":[{\"ref\":\"/etc/y.kit\"}]}")).status, std::string ("absolute"));
    CHECK_EQ (one (mk ("{\"kind\":\"patch\",\"kits\":[{\"ref\":\"../../../User/y.kit\"}]}")).status, std::string ("escape"));
    CHECK_EQ (one (mk ("{\"kind\":\"patch\",\"kits\":[{\"ref\":\"../sounds/Sub_Distort.snd\"}]}")).status, std::string ("wrong-kind"));
    const auto emb = one (mk ("{\"kind\":\"patch\",\"kits\":[{\"ref\":\"../kits/Gone.kit\",\"id\":\"kit_embedded\"}],\"embedded\":{\"kit_embedded\":{}}}"));
    CHECK_EQ (emb.status, std::string ("embedded"));
    CHECK (emb.usable);
    const auto cs = one (mk ("{\"kind\":\"patch\",\"kits\":[{\"ref\":\"../Sounds/Sub_Distort.snd\"}]}"));
    CHECK (! cs.usable);   // case-only mismatch is rejected (breaks on case-sensitive systems)
    CHECK (one (mk ("{\"kind\":\"patch\",\"kits\":[{}]}")).status == "empty");

    // 3) moved file: path fails, ID lookup rebinds; next save rewrites the reference (only inside a writable pack)
    auto m = makeRig ("refs_move", false, "typed-valid");
    t::copyTree (m->layout.presets / "Typed_Factory", m->layout.presets / "Mine");
    // make "Mine" a plain user pack
    auto pj = t::parseV (t::slurp (m->layout.presets / "Mine/pack.json"));
    pu::set (pj, "license", "user");
    pu::set (pj, "id", "pack_00000000-0000-4000-8000-0000000009ff");
    t::writeText (m->layout.presets / "Mine/pack.json", pu::toJsonText (pj));
    fs::remove_all (m->layout.presets / "Typed_Factory");
    fs::create_directories (m->layout.presets / "Mine/kits/sub");
    fs::rename (m->layout.presets / "Mine/kits/Heavy_Impacts.kit", m->layout.presets / "Mine/kits/sub/Heavy_Impacts.kit");
    CHECK (m->store->rescan().ok);
    auto lr = m->store->load (kPatch);
    CHECK (lr.ok);
    bool rebound = false;
    for (const auto& x : lr.value.refs) rebound = rebound || (x.where == "kits[0]" && x.status == "rebound" && x.usable);
    CHECK (rebound);
    CHECK (lr.value.warnings.empty());
    CHECK (m->store->save (SaveRequest {}).ok);       // Quick Save in place (user pack)
    const auto saved = t::parseV (t::slurp (m->layout.presets / "Mine/patches/Dark_Obsidian.pat"));
    CHECK_EQ (pu::getStr ((*pu::get (saved, "kits").getArray())[0], "ref"), std::string ("../kits/sub/Heavy_Impacts.kit"));   // rewritten, file-relative
    CHECK_EQ (pu::getStr ((*pu::get (saved, "kits").getArray())[0], "id"), std::string ("kit_00000000-0000-4000-8000-000000000020"));
    auto after = m->store->resolveReferences (saved, m->layout.presets / "Mine/patches/Dark_Obsidian.pat", "Mine");
    CHECK_EQ (after.front().status, std::string ("found"));
}

TEST (sample_resolution_order)
{
    auto r = makeRig ("samples", false, "typed-valid");
    const auto pack = r->layout.packDir ("Typed_Factory");
    CHECK (t::exists (pack / "samples/kick_raw.wav"));
    auto entry = Store::makeSampleEntry (pack, "Typed_Factory", "samples/kick_raw.wav");
    CHECK_EQ (pu::getStr (entry, "sha256").size(), (std::size_t) 64);
    CHECK_EQ (r->store->resolveSample (entry, "Typed_Factory").status, std::string ("found"));
    // moved: relative ref fails, content hash finds it
    fs::create_directories (pack / "samples/sub");
    fs::rename (pack / "samples/kick_raw.wav", pack / "samples/sub/kick.wav");
    const auto moved = r->store->resolveSample (entry, "Typed_Factory");
    CHECK_EQ (moved.status, std::string ("rebound-by-hash"));
    CHECK (moved.path.find ("kick.wav") != std::string::npos);
    // changed content at the same name: never silently accepted
    t::writeText (pack / "samples/kick_raw.wav", "different audio");
    CHECK_EQ (r->store->resolveSample (entry, "Typed_Factory").status, std::string ("rebound-by-hash"));   // hash lookup still finds the real one
    fs::remove (pack / "samples/sub/kick.wav");
    CHECK_EQ (r->store->resolveSample (entry, "Typed_Factory").status, std::string ("hash-mismatch"));
    // embedded copy saves the day, otherwise a visible placeholder
    fs::remove (pack / "samples/kick_raw.wav");
    auto withEmb = entry.clone();
    pu::set (withEmb, "embedded_b64", "AAAA");
    CHECK_EQ (r->store->resolveSample (withEmb, "Typed_Factory").status, std::string ("embedded"));
    const auto gone = r->store->resolveSample (entry, "Typed_Factory");
    CHECK_EQ (gone.status, std::string ("missing"));
    CHECK_EQ (gone.message, std::string ("[Missing: samples/kick_raw.wav]"));
    // unsafe refs are never read
    auto evil = entry.clone();
    pu::set (evil, "ref", "../../secret.wav");
    pu::set (evil, "sha256", "");
    CHECK (! r->store->resolveSample (evil, "Typed_Factory").usable());
}

// =============================================================================================
TEST (defaults_first_golden_load)
{
    auto r = makeRig ("golden", false, "golden");
    CHECK (r->store->rescan().ok);
    const std::string id = "snd_00000000-0000-4000-8000-000000005001";
    auto res = r->store->load (id);
    CHECK (res.ok);
    // file written with manifest v1: osc1_wave, filter_cutoff_hz, filter_res, drive_amount, legacy_removed_param
    CHECK_EQ (r->live->num ("filter_cutoff_hz"), 95.5);
    CHECK_EQ (r->live->num ("filter_res"), 0.35);
    CHECK_EQ (r->live->num ("drive_amount"), 0.62);
    CHECK_EQ (r->live->str ("osc1_wave"), std::string ("saw"));
    // parameters ADDED since the file was written come up neutral (declared default), old files load forever
    CHECK_EQ (r->live->num ("osc1_sub_level"), 0.25);
    CHECK_EQ (std::get<bool> (r->live->values["unison_on"]), false);
    CHECK_EQ (r->live->num ("amp_env_attack_s"), 0.005);
    // a parameter this build no longer declares is NOT dropped
    CHECK_EQ (res.value.unknown, (std::vector<std::string> { "legacy_removed_param" }));
    SaveRequest as; as.name = "Roundtrip"; as.saveAs = true;
    auto saved = r->store->save (as);
    CHECK (saved.ok);
    const auto doc = t::parseV (t::slurp (pu::pathOf (saved.value.path)));
    CHECK_EQ (saved.value.pack, std::string ("Golden"));          // a writable (non-factory) pack is saved in place, not copied away
    CHECK_EQ (pu::getNum (pu::get (doc, "params"), "legacy_removed_param"), 1.5);
    CHECK_EQ (pu::getNum (pu::get (doc, "params"), "osc1_sub_level"), 0.25);

    // bad values: numeric choice, wrong type, out of range -> default / clamp + reported, never a crash
    auto bad = pu::newObject();
    pu::set (bad, "schema", "apc-preset/1.0"); pu::set (bad, "kind", "sound"); pu::set (bad, "id", "snd_00000000-0000-4000-8000-0000000050ff"); pu::set (bad, "name", "Bad Values");
    auto p = pu::newObject();
    pu::set (p, "osc1_wave", 1); pu::set (p, "filter_cutoff_hz", 99999.0); pu::set (p, "unison_on", "yes"); pu::set (p, "filter_res", "loud");
    pu::set (bad, "params", p);
    t::writeText (r->layout.presets / "User/sounds/Bad.snd", pu::toJsonText (bad));
    CHECK (r->store->rescan().ok);
    auto lr = r->store->load ("snd_00000000-0000-4000-8000-0000000050ff");
    CHECK (lr.ok);
    CHECK_EQ (r->live->str ("osc1_wave"), std::string ("saw"));          // index rejected -> default
    CHECK_EQ (r->live->num ("filter_cutoff_hz"), 20000.0);                 // clamped
    CHECK_EQ (r->live->num ("filter_res"), 0.2);                           // string rejected -> default
    CHECK_EQ ((int) lr.value.invalid.size(), 3);
    CHECK_EQ ((int) lr.value.clamped.size(), 1);
}

// =============================================================================================
TEST (import_without_clobber_and_pack_zip_roundtrip)
{
    auto r = makeRig ("import", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    const std::string glass = t::slurp (r->layout.presets / "Typed_Factory/sounds/Glass_Pluck.snd");

    // inline JSON import: colliding id gets a fresh one, colliding name gets " 2"
    auto first = r->store->importAsset ("", glass);
    CHECK (first.ok);
    CHECK_EQ ((int) first.value.items.size(), 1);
    CHECK (first.value.items[0].idChanged);
    auto second = r->store->importAsset ("", glass);
    CHECK (second.ok);
    CHECK (t::exists (r->layout.presets / "User/sounds/Glass Pluck.snd"));
    CHECK (t::exists (r->layout.presets / "User/sounds/Glass Pluck 2.snd"));
    CHECK_EQ (t::slurp (r->layout.presets / "Typed_Factory/sounds/Glass_Pluck.snd"), glass);   // nothing overwritten
    CHECK (first.value.items[0].id != second.value.items[0].id);
    CHECK_EQ ((int) pu::getNum (r->store->list (t::query ("{\"search\":\"glass\"}")).value, "total"), 3);

    // import from a file path; engine section is stripped from assets
    auto withEngine = t::parseV (glass);
    pu::set (withEngine, "id", "snd_00000000-0000-4000-8000-0000000077aa");
    pu::set (withEngine, "engine", t::parseV ("{\"oversampling\":8}"));
    t::writeText (r->base / "incoming.snd", pu::toJsonText (withEngine));
    auto fp = r->store->importAsset (pu::pathToUtf8 (r->base / "incoming.snd"), "");
    CHECK (fp.ok);
    CHECK (! fp.value.items[0].idChanged);
    CHECK (! pu::has (t::parseV (t::slurp (pu::pathOf (fp.value.items[0].path))), "engine"));

    // failures are structured
    CHECK_EQ (r->store->importAsset ("", "{ nope").error.code, std::string ("bad_json"));
    CHECK_EQ (r->store->importAsset ("", "{\"a\":1}").error.code, std::string ("bad_schema"));
    CHECK_EQ (r->store->importAsset ("", "").error.code, std::string ("invalid"));
    CHECK_EQ (r->store->importAsset (pu::pathToUtf8 (r->base / "nope.snd"), "").error.code, std::string ("io"));
    CHECK_EQ (r->store->importAsset ("", glass, "Typed_Factory").error.code, std::string ("readonly"));
    auto newer = t::parseV (glass);
    pu::set (newer, "schema", "apc-preset/2.0");
    CHECK_EQ (r->store->importAsset ("", pu::toJsonText (newer)).error.code, std::string ("bad_schema"));

    // export the patch (+ kit + sound + sequence) as a pack archive ...
    auto ex = r->store->exportPack ({ kPatch }, "My Export");
    CHECK (ex.ok);
    if (! ex.ok) return;
    CHECK (t::exists (pu::pathOf (ex.value)));
    std::set<std::string> entries;
    {
        juce::ZipFile zf (pu::fileOf (pu::pathOf (ex.value)));
        for (int i = 0; i < zf.getNumEntries(); ++i) entries.insert (zf.getEntry (i)->filename.toStdString());
    }
    CHECK (entries.count ("pack.json"));
    CHECK (entries.count ("patches/Dark_Obsidian.pat"));
    CHECK (entries.count ("kits/Heavy_Impacts.kit"));
    CHECK (entries.count ("sequences/Halftime_174.seq"));
    CHECK (entries.count ("sounds/Sub_Distort.snd"));    // pulled in through kit -> sound
    CHECK (! entries.count ("sounds/Init.snd"));          // nothing else
    CHECK_EQ (r->store->exportPack ({}).error.code, std::string ("invalid"));
    CHECK_EQ (r->store->exportPack ({ "pat_unknown" }).error.code, std::string ("not_found"));

    // ... and install it into a clean machine
    auto clean = makeRig ("import_clean", false, nullptr);
    CHECK (clean->store->rescan().ok);
    auto inst = clean->store->importAsset (ex.value, "");
    CHECK (inst.ok);
    CHECK_EQ ((int) inst.value.items.size(), 4);
    CHECK_EQ (inst.value.packFolder, std::string ("My Export"));
    CHECK (t::exists (clean->layout.presets / "My Export/patches/Dark_Obsidian.pat"));
    CHECK ((int) pu::getNum (clean->store->list (t::query ("{}")).value, "total") == 4);
    auto lp = clean->store->load (kPatch);
    CHECK (lp.ok);
    for (const auto& x : lp.value.refs) CHECK (x.usable);   // references still resolve inside the installed pack
    // same pack, same version: no-op instead of a silent duplicate
    auto again = clean->store->importAsset (ex.value, "");
    CHECK (again.ok);
    CHECK_EQ (again.value.skipped, std::string ("already-installed"));
    CHECK ((int) pu::getNum (clean->store->list (t::query ("{}")).value, "total") == 4);

    // zip-slip: any hostile entry aborts BEFORE anything is written
    for (const char* hostile : { "../evil.txt", "/abs.txt", "C:/win.txt", "a/../../b.txt", "ok/..\\..\\c.txt" })
    {
        juce::ZipFile::Builder zb;
        const std::string pj = "{\"schema\":\"apc-pack/1.0\",\"id\":\"pack_x\",\"name\":\"Hostile\",\"version\":\"1\"}";
        zb.addEntry (std::make_unique<juce::MemoryInputStream> (pj.data(), pj.size(), true), 9, "pack.json", juce::Time::getCurrentTime());
        zb.addEntry (std::make_unique<juce::MemoryInputStream> ("x", 1, true), 9, hostile, juce::Time::getCurrentTime());
        juce::MemoryOutputStream mos;
        zb.writeToStream (mos, nullptr);
        auto bad = clean->store->importAsset ("", std::string (static_cast<const char*> (mos.getData()), mos.getDataSize()));
        CHECK (! bad.ok);
        CHECK_EQ (bad.error.code, std::string ("unsafe_path"));
        CHECK (! t::exists (clean->layout.presets / "Hostile"));
        CHECK (! t::exists (clean->base / "Mfr" / "evil.txt"));
        CHECK (! t::exists (clean->layout.presets / "evil.txt"));
    }
}

TEST (restore_factory_layout_hook_seed_and_zip)
{
    auto r = makeRig ("factory", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    t::writeText (r->layout.presets / "User/sounds/Mine.snd", t::slurp (r->layout.presets / "Typed_Factory/sounds/Glass_Pluck.snd"));
    // no source configured
    CHECK_EQ (r->store->restoreFactoryLayout().error.code, std::string ("no_factory_source"));

    // shared seed
    const auto seed = r->base / "seed";
    t::copyTree (t::fixtures() / "typed-valid/presets/Typed_Factory", seed / "Typed_Factory");
    t::writeText (seed / "User/sounds/FromSeed.snd", "{}");   // user content is never restored from a seed
    r->cfg.layout.factorySeed = seed;
    recreate (*r);
    fs::remove_all (r->layout.presets / "Typed_Factory");
    CHECK (r->store->rescan().ok);
    CHECK_EQ ((int) r->store->index()->rows.size(), 1);
    auto rs = r->store->restoreFactoryLayout();
    CHECK (rs.ok);
    CHECK_EQ ((int) r->store->index()->rows.size(), 7);
    CHECK (t::exists (r->layout.presets / "Typed_Factory/sounds/Sub_Distort.snd"));
    CHECK (! t::exists (r->layout.presets / "User/sounds/FromSeed.snd"));
    CHECK (t::exists (r->layout.presets / "User/sounds/Mine.snd"));

    // custom hook (e.g. extract the embedded archive); failure is reported with its code
    r->cfg.restoreFactory = [] (const fs::path&) { return Status::fail ("io", "disk full"); };
    recreate (*r);
    CHECK_EQ (r->store->restoreFactoryLayout().error.message, std::string ("disk full"));
    bool called = false;
    r->cfg.restoreFactory = [&called] (const fs::path& presets) { called = true; t::copyTree (t::fixtures() / "flat-valid/presets/Flat_Factory", presets / "Restored"); return Status::success(); };
    recreate (*r);
    CHECK (r->store->restoreFactoryLayout().ok);
    CHECK (called);
    CHECK (t::exists (r->layout.presets / "Restored/Init.preset"));

    // embedded archive in memory
    auto ex = r->store->exportPack ({ kSub }, "Factory Zip");
    CHECK (ex.ok);
    std::string bytes = t::slurp (pu::pathOf (ex.value));
    fs::remove_all (r->layout.presets / "Factory Zip");
    CHECK (r->store->restoreFromZip (bytes.data(), bytes.size()).ok);
    CHECK (t::exists (r->layout.presets / "Factory Zip/sounds/Sub_Distort.snd"));
}

// =============================================================================================
TEST (host_chunk_roundtrip_with_engine_section)
{
    auto r = makeRig ("chunk", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    CHECK (r->store->load (kSub).ok);
    r->live->user ("filter_cutoff_hz", 321.5);
    pu::set (r->live->engine, "voices", 8);
    pu::set (r->live->engine, "oversampling", 4);
    pu::set (r->live->extras, "modulation", t::parseV ("[{\"src\":\"lfo1\",\"dst\":\"filter_cutoff_hz\",\"amount\":0.5}]"));
    r->store->notifyParamChanged();
    CHECK (r->store->ab ("toggle").ok);
    r->live->user ("drive_amount", 0.9);

    auto chunk = r->store->serializeChunk();
    CHECK (chunk.ok);
    const auto doc = t::parseV (chunk.value);
    CHECK_EQ (pu::getStr (doc, "schema"), std::string ("apc-preset/1.0"));
    CHECK_EQ ((int) pu::getNum (doc, "state_version"), 1);
    CHECK_EQ (pu::getStr (doc, "app_version"), std::string ("1.1.0"));
    CHECK_EQ (pu::getStr (doc, "kind"), std::string ("patch"));
    CHECK_EQ (pu::getStr (doc, "id").substr (0, 4), std::string ("pat_"));
    CHECK_EQ ((int) pu::getNum (pu::get (doc, "engine"), "voices"), 8);
    CHECK_EQ ((int) pu::getNum (pu::get (doc, "engine"), "oversampling"), 4);
    CHECK_EQ (pu::get (doc, "params").getDynamicObject()->getProperties().size(), 9);   // full snapshot, not "what was touched"
    CHECK (pu::get (doc, "modulation").isArray());
    CHECK (Store::looksLikeChunk (chunk.value.data(), chunk.value.size()));

    // a new instance in a new project: defaults everywhere ...
    auto r2 = makeRig ("chunk2", false, "typed-valid");
    CHECK (r2->store->rescan().ok);
    auto rest = r2->store->restoreChunk (chunk.value.data(), chunk.value.size());
    CHECK (rest.ok);
    CHECK (rest.value.engineApplied);
    CHECK_EQ (r2->live->num ("filter_cutoff_hz"), 321.5);
    CHECK_EQ (r2->live->num ("drive_amount"), 0.9);
    CHECK_EQ ((int) pu::getNum (r2->live->engine, "voices"), 8);                   // engine travels with the project (X-08)
    CHECK_EQ ((int) pu::getNum (r2->live->engine, "oversampling"), 4);
    CHECK (pu::get (r2->live->extras, "modulation").isArray());
    CHECK (r2->store->isDirty());                                                  // the project was saved dirty
    CHECK_EQ (r2->store->current().name, std::string ("Sub Distort"));
    CHECK_EQ (r2->store->current().id, std::string (kSub));
    CHECK_EQ (pu::getStr (pu::get (r2->store->stateVar(), "ab"), "active"), std::string ("B"));
    CHECK (pu::getBool (pu::get (r2->store->stateVar(), "ab"), "hasB"));
    CHECK (r2->store->ab ("toggle").ok);                                            // slot A survived: cutoff 321.5, drive as loaded from the file (0.62)
    CHECK_EQ (r2->live->num ("drive_amount"), 0.62);
    CHECK_EQ (r2->live->num ("filter_cutoff_hz"), 321.5);
    CHECK (r2->store->revert().ok);                                                  // and the file can still be reverted to
    CHECK_EQ (r2->live->num ("filter_cutoff_hz"), 95.5);

    // machine scope: no engine section is written, a chunk engine section is ignored
    auto m = makeRig ("chunk_machine", false, "typed-valid");
    m->cfg.engineInChunk = false;
    recreate (*m);
    pu::set (m->live->engine, "voices", 3);
    auto mc = m->store->serializeChunk();
    CHECK (mc.ok);
    CHECK (! pu::has (t::parseV (mc.value), "engine"));
    auto withEng = t::parseV (chunk.value);
    auto before = pu::toJsonText (m->live->engine, true);
    CHECK (m->store->restoreChunk (pu::toJsonText (withEng).data(), pu::toJsonText (withEng).size()).ok);
    CHECK_EQ (pu::toJsonText (m->live->engine, true), before);

    // forward compatibility + unknown keys survive a round trip
    auto future = t::parseV (chunk.value);
    pu::set (future, "state_version", 99);
    pu::set (pu::get (future, "params"), "param_from_the_future", 7);
    const std::string ft = pu::toJsonText (future);
    auto fr = r2->store->restoreChunk (ft.data(), ft.size());
    CHECK (fr.ok);
    CHECK (! fr.value.warnings.empty());
    CHECK_EQ (fr.value.stateVersionFound, 99);
    CHECK_EQ (pu::getNum (pu::get (t::parseV (r2->store->serializeChunk().value), "params"), "param_from_the_future"), 7.0);

    // garbage in -> structured error, live state NOT half-applied
    const double keep = r2->live->num ("filter_cutoff_hz");
    for (const char* bad : { "", "not json", "<?xml version=\"1.0\"?><x/>", "[1,2,3]", "{\"schema\":\"something-else/1\"}" })
    {
        auto e = r2->store->restoreChunk (bad, std::strlen (bad));
        CHECK (! e.ok);
        CHECK_EQ (e.error.code, std::string ("bad_chunk"));
        CHECK (! e.error.message.empty());
    }
    CHECK (! Store::looksLikeChunk ("<?xml", 5));
    CHECK_EQ (r2->live->num ("filter_cutoff_hz"), keep);
    const std::string v2 = "{\"schema\":\"apc-preset/2.0\",\"kind\":\"patch\",\"id\":\"pat_x\",\"name\":\"n\"}";
    CHECK_EQ (r2->store->restoreChunk (v2.data(), v2.size()).error.code, std::string ("bad_schema"));

    // asset files saved after an engine change still carry no engine section
    SaveRequest sr; sr.name = "NoEngine"; sr.saveAs = true;
    CHECK (r2->store->save (sr).ok);
    CHECK (! pu::has (t::parseV (t::slurp (r2->layout.presets / "User/sounds/NoEngine.snd")), "engine"));
}

// =============================================================================================
TEST (concurrent_list_during_rescan)
{
    auto r = makeRig ("mt", false, "typed-valid");
    CHECK (r->store->rescan().ok);
    std::atomic<bool> stop { false };
    std::atomic<int> wrong { 0 }, errors { 0 };
    std::thread scanner ([&] { for (int i = 0; i < 25; ++i) if (! r->store->rescan (i % 2 == 0).ok) ++errors; stop = true; });
    std::thread userData ([&] { for (int i = 0; i < 25; ++i) r->store->setFavorite (kSub, i % 2 == 0); });
    while (! stop.load())
    {
        const auto res = r->store->list (t::query ("{\"sort\":\"type\"}"));
        if (! res.ok || (int) pu::getNum (res.value, "total") != 6) ++wrong;
    }
    scanner.join();
    userData.join();
    CHECK_EQ (wrong.load(), 0);
    CHECK_EQ (errors.load(), 0);
}

TEST (compiled_in_vocabulary_matches_schema_file)
{
    const auto v = t::parseV (t::slurp (fs::path (APC_REPO_ROOT) / "schemas" / "pmx1-vocabulary.json"));
    CHECK (pu::isObject (v));
    const auto* axes = pu::get (v, "axes").getArray();
    CHECK (axes != nullptr);
    if (axes == nullptr) return;
    CHECK_EQ ((int) axes->size(), (int) apc::presets::axisTable().size());
    for (int i = 0; i < axes->size(); ++i)
    {
        CHECK_EQ (pu::getStr ((*axes)[i], "key"), std::string (apc::presets::axisTable()[(std::size_t) i].key));
        const auto* words = pu::get ((*axes)[i], "words").getArray();
        CHECK (words != nullptr);
        if (words == nullptr) continue;
        CHECK_EQ ((int) words->size(), (int) apc::presets::axisTable()[(std::size_t) i].words.size());
        for (int w = 0; w < words->size(); ++w) CHECK_EQ (pu::ss ((*words)[w].toString()), std::string (apc::presets::axisTable()[(std::size_t) i].words[(std::size_t) w]));
    }
    const auto* genres = pu::get (v, "genres").getArray();
    CHECK (genres != nullptr);
    if (genres == nullptr) return;
    CHECK_EQ ((int) genres->size(), (int) apc::presets::genreTable().size());
    for (int i = 0; i < genres->size(); ++i)
    {
        const auto& g = apc::presets::genreTable()[(std::size_t) i];
        CHECK_EQ (pu::getStr ((*genres)[i], "slug"), std::string (g.slug));
        CHECK_EQ (pu::getStr ((*genres)[i], "label"), std::string (g.label));
        const auto* al = pu::get ((*genres)[i], "aliases").getArray();
        CHECK_EQ ((int) (al ? al->size() : 0), (int) g.aliases.size());
        if (al != nullptr) for (int a = 0; a < al->size() && a < (int) g.aliases.size(); ++a) CHECK_EQ (pu::ss ((*al)[a].toString()), std::string (g.aliases[(std::size_t) a]));
    }
}

// =============================================================================================
namespace
{
struct Tracked
{
    static std::atomic<int>& live() { static std::atomic<int> n { 0 }; return n; }
    explicit Tracked (int v) : value (v) { ++live(); }
    ~Tracked() { --live(); }
    int value;
};
}

TEST (pending_swap_audio_thread_handoff)
{
    {
        apc::PendingSwap<Tracked> swap;
        CHECK (swap.acquire() == nullptr);
        swap.publish (std::make_unique<Tracked> (1));
        CHECK_EQ (swap.acquire()->value, 1);
        swap.publish (std::make_unique<Tracked> (2));
        swap.publish (std::make_unique<Tracked> (3));    // 2 never reached the audio thread: freed by the producer
        CHECK_EQ (Tracked::live().load(), 2);
        CHECK_EQ (swap.acquire()->value, 3);
        swap.collectGarbage();
        CHECK_EQ (Tracked::live().load(), 1);            // 1 went through the trash ring and was deleted off the audio thread
        CHECK (swap.generation() == 3);

        // stress: the "audio thread" only acquires; values must be monotonic, nothing leaks, nothing double-frees
        std::atomic<bool> done { false };
        std::atomic<int> backwards { 0 }, maxSeen { 0 };
        std::thread audio ([&]
        {
            int last = 0;
            while (! done.load())
            {
                if (const auto* p = swap.acquire()) { if (p->value < last) ++backwards; last = p->value; maxSeen = last; }
            }
        });
        for (int i = 10; i < 20010; ++i)
        {
            swap.publish (std::make_unique<Tracked> (i));
            if (i % 64 == 0) std::this_thread::yield();
        }
        for (int i = 0; i < 25; ++i) { swap.collectGarbage(); std::this_thread::sleep_for (std::chrono::milliseconds (1)); }   // producer-side tidy-up frees trash slots
        done = true;
        audio.join();
        swap.collectGarbage();
        CHECK_EQ (backwards.load(), 0);
        CHECK_EQ (maxSeen.load(), 20009);
        CHECK (Tracked::live().load() <= 2);   // active + at most the pending one
    }
    CHECK_EQ (Tracked::live().load(), 0);       // destructor frees everything
}

// =============================================================================================
// Cross-check against the Node reference implementation (scripts/apc-presets.js `index`).
// Enabled by --xcheck <dir>: <dir>/Mfr/{Typed,Flat}/presets were indexed by `apc presets index` first.
TEST (xcheck_identical_to_node_index)
{
    if (g_xcheckDir.empty()) { std::cout << "  (skipped: no --xcheck)\n"; return; }
    for (const char* plug : { "Typed", "Flat" })
    {
        const bool flat = std::string (plug) == "Flat";
        const auto layout = t::layoutIn (fs::path (g_xcheckDir), plug);
        CHECK (layout.valid);
        const auto nodeIndex = t::parseV (t::slurp (layout.indexFile));
        const auto* nodeRows = pu::get (nodeIndex, "rows").getArray();
        CHECK (nodeRows != nullptr);
        if (nodeRows == nullptr) continue;

        // user-data (ratings/favorites) as seeded by the test: C++ must join exactly like Node
        auto cfg = flat ? t::flatConfig (layout) : t::typedConfig (layout);
        Store store (cfg);
        auto res = store.rescan (true);   // ignore Node's cache: parse everything ourselves
        CHECK (res.ok);
        const auto idx = store.index();
        CHECK_EQ ((int) idx->rows.size(), (int) nodeRows->size());
        for (int i = 0; i < nodeRows->size() && i < (int) idx->rows.size(); ++i)
        {
            const auto& n = (*nodeRows)[i];
            const auto& c = idx->rows[(std::size_t) i];
            const std::string where = std::string (plug) + ":" + c.path;
            if (pu::getStr (n, "id") != c.id) std::cout << "  row " << i << " " << where << " id differs\n";
            CHECK_EQ (c.id, pu::getStr (n, "id"));
            CHECK_EQ (c.kind, pu::getStr (n, "kind"));
            CHECK_EQ (c.name, pu::getStr (n, "name"));
            CHECK_EQ (c.pack, pu::getStr (n, "pack"));
            CHECK_EQ (c.path, pu::getStr (n, "path"));
            CHECK_EQ (c.hash, pu::getStr (n, "hash"));
            CHECK_EQ (c.size, (std::int64_t) pu::getNum (n, "size"));
            CHECK_EQ (c.rating, (int) pu::getNum (n, "rating"));
            CHECK_EQ (c.favorite, pu::getBool (n, "favorite"));
            CHECK_EQ (c.hasUses, pu::has (n, "uses"));
            if (c.hasUses) CHECK_EQ (c.uses, (int) pu::getNum (n, "uses"));
            CHECK_EQ (pu::toJsonText (c.meta, true), pu::toJsonText (pu::get (n, "meta"), true));
            const auto dm = c.mtime - (std::int64_t) pu::getNum (n, "mtime");
            if (dm != 0) std::cout << "  mtime differs by " << dm << " ms for " << where << "\n";
            CHECK_EQ (c.mtime, (std::int64_t) pu::getNum (n, "mtime"));   // same floor(ms) rule
        }
        // list(sort=path) is the index order; every other order is derived from the same rows
        auto byPath = store.list (t::query ("{\"sort\":\"path\"}"));
        CHECK (byPath.ok);
        std::vector<std::string> nodeIds;
        for (int i = 0; i < nodeRows->size(); ++i) nodeIds.push_back (pu::getStr ((*nodeRows)[i], "id"));
        CHECK_EQ (t::ids (byPath.value), nodeIds);
        // ratings/favorites seeded into user-data.json reach list() identically
        for (int i = 0; i < nodeRows->size(); ++i)
        {
            const auto it = store.userEntry (pu::getStr ((*nodeRows)[i], "id"));
            CHECK_EQ (it.rating, (int) pu::getNum ((*nodeRows)[i], "rating"));
            CHECK_EQ (it.favorite, pu::getBool ((*nodeRows)[i], "favorite"));
        }
        // the cache we leave behind must be reusable by Node (mtime+size semantics are identical) - verified by the wrapper
    }
}
