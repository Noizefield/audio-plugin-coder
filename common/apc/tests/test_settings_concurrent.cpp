// test_settings_concurrent.cpp - several writers hammer ONE settings.json; no key may be lost.
//   * threads  : each thread has its OWN SettingsStore object (like separate plugin instances), plus two
//                threads share one object (in-process serialization).
//   * processes: the test re-launches itself with --writer so real cross-process locking is exercised.
//   * a reader thread loads continuously: it must never observe a torn / corrupt file.
//   * the shared once-per-day slot must be won by EXACTLY ONE writer across all threads and processes.
// Usage: test_settings_concurrent            (driver)
//        test_settings_concurrent --writer <file> <id> <count>   (child; prints "OK <wins>" or "ERR <msg>")
#include "ApcSettingsStore.h"

#include <cstdio>
#include <cstdlib>
#include <memory>
#include <thread>

static int g_fail = 0, g_checks = 0;
#define CHECK(c) do { ++g_checks; if (!(c)) { ++g_fail; std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); } } while (0)

namespace fs = std::filesystem;
using namespace apc;

static const int64_t kNow = 1800000000;

// One writer's whole life: N distinct keys + a race for the daily slot. Returns slot wins, or -1 on error.
static int runWriter(SettingsStore& s, int id, int count, std::string& err) {
    int wins = 0;
    for (int i = 0; i < count; ++i) {
        if (!s.set("w" + std::to_string(id) + ".k" + std::to_string(i), (int64_t) (id * 1000 + i), err)) return -1;
        if (i % 7 == 0 && s.claimTimeSlot("update.last_check_unix", kNow, 86400)) ++wins;
    }
    if (s.claimTimeSlot("update.last_check_unix", kNow, 86400)) ++wins;
    return wins;
}

static int childMain(int argc, char** argv) {
    if (argc < 5) return 2;
    SettingsStore::Options o; o.filePath = argv[2];
    SettingsStore s(o);
    std::string err;
    const int wins = runWriter(s, std::atoi(argv[3]), std::atoi(argv[4]), err);
    if (wins < 0) { std::printf("ERR %s\n", err.c_str()); return 1; }
    std::printf("OK %d\n", wins);
    return 0;
}

static std::string quote(const std::string& s) { return "\"" + s + "\""; }

int main(int argc, char** argv) {
    if (argc >= 2 && std::string(argv[1]) == "--writer") return childMain(argc, argv);

    const fs::path dir = fs::temp_directory_path() / ("apc_test_settings_conc_" + std::to_string(sysutil::currentProcessId()));
    fs::remove_all(dir); fs::create_directories(dir);
    const fs::path file = dir / "settings.json";
    const int kThreads = 4, kProcs = 4, kKeys = 30;

    // pre-existing content from "another version": must survive everything below
    {
        std::ofstream f(file, std::ios::binary);
        f << "{\"schema\":\"apc-settings/1.0\",\"x_future\":{\"keep\":true},\"ui\":{\"theme\":\"night\",\"future_key\":[1,2,3]}}";
    }

    // ---------------- threads, separate store objects ----------------
    std::atomic<int> totalWins { 0 }, errors { 0 }, readerFailures { 0 }, readerWarnings { 0 };
    std::atomic<bool> stopReader { false };
    std::thread reader([&] {
        SettingsStore rs([&] { SettingsStore::Options o; o.filePath = file; return o; }());
        while (!stopReader) {
            std::string e;
            if (!rs.load(e)) ++readerFailures;
            if (!rs.takeWarnings().empty()) ++readerWarnings;          // a torn file would be quarantined + warned
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
    });

    std::vector<std::thread> threads;
    SettingsStore shared([&] { SettingsStore::Options o; o.filePath = file; return o; }());   // used by 2 threads
    for (int t = 0; t < kThreads; ++t) {
        threads.emplace_back([&, t] {
            SettingsStore::Options o; o.filePath = file;
            SettingsStore own(o);
            SettingsStore& s = (t < 2) ? shared : own;
            std::string err;
            const int w = runWriter(s, t, kKeys, err);
            if (w < 0) { ++errors; std::fprintf(stderr, "thread %d: %s\n", t, err.c_str()); } else totalWins += w;
        });
    }
    for (auto& th : threads) th.join();
    CHECK(errors == 0);
    CHECK(totalWins == 1);                       // exactly one winner of the daily slot among all threads

    // ---------------- processes ----------------
    std::vector<FILE*> pipes;
    const std::string exe = argv[0];
    for (int p = 0; p < kProcs; ++p) {
        std::string cmd = quote(exe) + " --writer " + quote(file.string()) + " " + std::to_string(100 + p) + " " + std::to_string(kKeys);
#if defined(_WIN32)
        FILE* f = _popen(("\"" + cmd + "\"").c_str(), "r");       // cmd.exe strips one outer quote pair
#else
        FILE* f = popen(cmd.c_str(), "r");
#endif
        CHECK(f != nullptr);
        pipes.push_back(f);
    }
    int procWins = 0, procOk = 0;
    for (FILE* f : pipes) {
        if (!f) continue;
        char buf[512] = {};
        std::string out;
        while (std::fgets(buf, sizeof buf, f)) out += buf;
#if defined(_WIN32)
        const int rc = _pclose(f);
#else
        const int rc = pclose(f);
#endif
        if (rc == 0 && out.compare(0, 3, "OK ") == 0) { ++procOk; procWins += std::atoi(out.c_str() + 3); }
        else std::fprintf(stderr, "child failed rc=%d output=%s\n", rc, out.c_str());
    }
    CHECK(procOk == kProcs);
    CHECK(procWins == 0);                        // the slot was already taken by the threads' winner (same `now`)

    stopReader = true; reader.join();
    CHECK(readerFailures == 0);
    CHECK(readerWarnings == 0);

    // ---------------- verify: nothing lost ----------------
    SettingsStore check([&] { SettingsStore::Options o; o.filePath = file; return o; }());
    std::string err;
    CHECK(check.load(err));
    int missing = 0;
    for (int t = 0; t < kThreads; ++t)
        for (int i = 0; i < kKeys; ++i)
            if (check.getInt("w" + std::to_string(t) + ".k" + std::to_string(i), -1) != t * 1000 + i) ++missing;
    for (int p = 0; p < kProcs; ++p)
        for (int i = 0; i < kKeys; ++i)
            if (check.getInt("w" + std::to_string(100 + p) + ".k" + std::to_string(i), -1) != (100 + p) * 1000 + i) ++missing;
    if (missing) std::fprintf(stderr, "LOST %d of %d keys\n", missing, (kThreads + kProcs) * kKeys);
    CHECK(missing == 0);
    CHECK(check.getBool("x_future.keep", false));                   // unknown keys preserved
    CHECK(check.getString("ui.theme", "") == "night" && check.get("ui.future_key").size() == 3);
    CHECK(check.getInt("update.last_check_unix", 0) == kNow);
    CHECK(check.getString("schema", "") == "apc-settings/1.0");

    int leftovers = 0, corrupt = 0;
    for (const auto& e : fs::directory_iterator(dir)) {
        const std::string n = e.path().filename().string();
        if (n.find(".tmp.") != std::string::npos || n.find(".lock") != std::string::npos) ++leftovers;
        if (n.find(".corrupt-") != std::string::npos) ++corrupt;
    }
    CHECK(leftovers == 0);
    CHECK(corrupt == 0);

    std::error_code ec; fs::remove_all(dir, ec);
    std::printf("test_settings_concurrent: %d checks, %d failed (%d threads + %d processes x %d keys)\n", g_checks, g_fail, kThreads, kProcs, kKeys);
    return g_fail == 0 ? 0 : 1;
}
