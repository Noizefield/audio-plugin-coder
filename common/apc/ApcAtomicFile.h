// ApcAtomicFile.h - crash-safe preset/data file I/O for the apc-preset/1.0 standard.
//
// Header-only, C++17, NO JUCE dependency (std::filesystem + platform file APIs).
// Decisions: P-06 (atomic writes, imports never overwrite), U-13 (every failure is
// reported with the failing path, never swallowed).
//
//   apc::atomicWrite()      write "<file>.tmp-<pid>", flush to disk, rename over the target.
//                           A crash at any point leaves the previous target intact.
//   apc::importNoClobber()  save under a sanitized name, never overwriting an existing file:
//                           "Name.ext", "Name 2.ext", "Name 3.ext", ... (atomic, race-free).
//   apc::sanitizeFilename() same rule as scripts/apc-presets.js (illegal chars -> '-').
//   apc::cleanupStaleTemps() remove orphaned "*.tmp-<pid>" files left by a killed process.
//
// Every operation returns an IoResult. Callers MUST surface !ok to the user (error text
// already contains the failing path) - silent I/O failure is a defect (fixed rule 1).
//
// Fault injection (tests): AtomicWriteOptions::fault is called at named points; returning
// true simulates the process being killed there (the temp file is deliberately left behind).
#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <functional>
#include <string>
#include <string_view>
#include <system_error>

#if defined(_WIN32)
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN
 #endif
 #include <windows.h>
#else
 #include <cerrno>
 #include <fcntl.h>
 #include <sys/stat.h>
 #include <unistd.h>
#endif

namespace apc
{
namespace fs = std::filesystem;

struct IoResult
{
    bool ok = true;
    std::string error;   // human readable; includes the failing path. Empty when ok.
    fs::path path;       // the file written (ok) or the path that failed (!ok)
    explicit operator bool() const { return ok; }
};

enum class FaultPoint
{
    AfterTempCreate,   // temp file exists, empty
    AfterTempWrite,    // temp file fully written but not yet flushed
    BeforeRename       // temp file flushed and closed, target not yet replaced
};

struct AtomicWriteOptions
{
    bool keepBackup = false;   // keep ONE "<file>.bak" of the previous version on overwrite
    bool flushToDisk = true;   // fsync / FlushFileBuffers before the rename
    std::function<bool (FaultPoint)> fault;   // tests only: return true to "crash" here
};

namespace detail
{
inline int currentPid()
{
#if defined(_WIN32)
    return static_cast<int> (::GetCurrentProcessId());
#else
    return static_cast<int> (::getpid());
#endif
}

inline IoResult makeError (const std::string& what, const fs::path& p, const std::string& why)
{
    IoResult r;
    r.ok = false;
    r.path = p;
    r.error = what + ": " + p.string() + (why.empty() ? std::string() : " (" + why + ")");
    return r;
}

#if defined(_WIN32)
using NativeHandle = HANDLE;
inline NativeHandle invalidHandle() { return INVALID_HANDLE_VALUE; }

inline std::string winError (const char* api)
{
    return std::string (api) + " failed, error " + std::to_string (static_cast<unsigned long> (::GetLastError()));
}

inline NativeHandle openTemp (const fs::path& p, std::string& err)
{
    HANDLE h = ::CreateFileW (p.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) err = winError ("CreateFile");
    return h;
}

inline bool writeAll (NativeHandle h, const char* data, std::size_t n, std::string& err)
{
    while (n > 0)
    {
        const DWORD chunk = n > (1u << 30) ? (1u << 30) : static_cast<DWORD> (n);
        DWORD written = 0;
        if (! ::WriteFile (h, data, chunk, &written, nullptr) || written == 0)
        {
            err = winError ("WriteFile");
            return false;
        }
        data += written;
        n -= written;
    }
    return true;
}

inline bool flushHandle (NativeHandle h, std::string& err)
{
    if (! ::FlushFileBuffers (h)) { err = winError ("FlushFileBuffers"); return false; }
    return true;
}

inline void closeHandle (NativeHandle h) { ::CloseHandle (h); }

// 0 = ok, 1 = target exists (only when !replace), 2 = error
inline int publish (const fs::path& tmp, const fs::path& target, bool replace, bool flush, std::string& err)
{
    DWORD flags = flush ? MOVEFILE_WRITE_THROUGH : 0;
    if (replace) flags |= MOVEFILE_REPLACE_EXISTING;
    if (::MoveFileExW (tmp.c_str(), target.c_str(), flags)) return 0;
    const DWORD e = ::GetLastError();
    if (! replace && (e == ERROR_ALREADY_EXISTS || e == ERROR_FILE_EXISTS)) return 1;
    err = "MoveFileEx failed, error " + std::to_string (static_cast<unsigned long> (e));
    return 2;
}
#else
using NativeHandle = int;
inline NativeHandle invalidHandle() { return -1; }

inline std::string posixError (const char* api) { return std::string (api) + " failed: " + std::strerror (errno); }

inline NativeHandle openTemp (const fs::path& p, std::string& err)
{
    const int fd = ::open (p.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) err = posixError ("open");
    return fd;
}

inline bool writeAll (NativeHandle fd, const char* data, std::size_t n, std::string& err)
{
    while (n > 0)
    {
        const ssize_t w = ::write (fd, data, n);
        if (w < 0)
        {
            if (errno == EINTR) continue;
            err = posixError ("write");
            return false;
        }
        data += w;
        n -= static_cast<std::size_t> (w);
    }
    return true;
}

inline bool flushHandle (NativeHandle fd, std::string& err)
{
    if (::fsync (fd) != 0) { err = posixError ("fsync"); return false; }
    return true;
}

inline void closeHandle (NativeHandle fd) { ::close (fd); }

inline void syncDirectory (const fs::path& dir)
{
    const int fd = ::open (dir.empty() ? "." : dir.c_str(), O_RDONLY);
    if (fd >= 0) { ::fsync (fd); ::close (fd); }
}

inline int publish (const fs::path& tmp, const fs::path& target, bool replace, bool flush, std::string& err)
{
    if (replace)
    {
        if (::rename (tmp.c_str(), target.c_str()) != 0) { err = posixError ("rename"); return 2; }
    }
    else
    {
        // link() fails with EEXIST instead of clobbering: atomic and race-free.
        if (::link (tmp.c_str(), target.c_str()) == 0)
        {
            ::unlink (tmp.c_str());
        }
        else if (errno == EEXIST)
        {
            return 1;
        }
        else
        {
            // Filesystems without hard links (FAT/exFAT, some network shares): best effort.
            std::error_code ec;
            if (fs::exists (target, ec)) return 1;
            if (::rename (tmp.c_str(), target.c_str()) != 0) { err = posixError ("rename"); return 2; }
        }
    }
    if (flush) syncDirectory (target.parent_path());
    return 0;
}
#endif

// Shared by atomicWrite and importNoClobber: writes the temp file completely.
// Returns ok=false on error (temp removed) or simulated crash (temp kept, crashed=true).
inline IoResult writeTempFile (const fs::path& tmp, std::string_view data, const AtomicWriteOptions& opt, bool& crashed)
{
    crashed = false;
    std::string err;
    NativeHandle h = openTemp (tmp, err);
    if (h == invalidHandle())
        return makeError ("cannot create temporary file", tmp, err);

    auto crashHere = [&] (FaultPoint p) {
        if (opt.fault && opt.fault (p)) { closeHandle (h); crashed = true; return true; }
        return false;
    };
    auto fail = [&] (const char* what) {
        closeHandle (h);
        std::error_code ec;
        fs::remove (tmp, ec);
        return makeError (what, tmp, err);
    };

    if (crashHere (FaultPoint::AfterTempCreate))
        return makeError ("simulated crash after temp create", tmp, {});
    if (! writeAll (h, data.data(), data.size(), err))
        return fail ("cannot write temporary file");
    if (crashHere (FaultPoint::AfterTempWrite))
        return makeError ("simulated crash after temp write", tmp, {});
    if (opt.flushToDisk && ! flushHandle (h, err))
        return fail ("cannot flush temporary file to disk");
    closeHandle (h);
    h = invalidHandle();

    if (opt.fault && opt.fault (FaultPoint::BeforeRename))
    {
        crashed = true;
        return makeError ("simulated crash before rename", tmp, {});
    }
    IoResult ok;
    ok.path = tmp;
    return ok;
}

inline fs::path tempPathFor (const fs::path& target)
{
    fs::path tmp = target;
    tmp += ".tmp-" + std::to_string (currentPid());
    return tmp;
}
} // namespace detail

// ---------------------------------------------------------------------------
// Filename sanitisation (P-06). Mirrors sanitizeFilename() in scripts/apc-presets.js:
//   / \ : * ? " < > |  and control chars -> '-'; leading spaces and trailing dots/spaces
//   trimmed; Windows device names (CON, NUL, COM1...) get a '_' prefix; empty -> "untitled";
//   capped at maxBytes UTF-8 bytes without cutting a code point.
// ---------------------------------------------------------------------------
inline std::string sanitizeFilename (std::string_view name, std::size_t maxBytes = 120)
{
    std::string s;
    s.reserve (name.size());
    for (const char ch : name)
    {
        const auto c = static_cast<unsigned char> (ch);
        const bool illegal = c < 0x20 || ch == '/' || ch == '\\' || ch == ':' || ch == '*'
                             || ch == '?' || ch == '"' || ch == '<' || ch == '>' || ch == '|';
        s.push_back (illegal ? '-' : ch);
    }
    std::size_t start = 0;
    while (start < s.size() && s[start] == ' ') ++start;
    std::size_t end = s.size();
    while (end > start && (s[end - 1] == '.' || s[end - 1] == ' ')) --end;
    s = s.substr (start, end - start);

    // reserved device names (compare the part before the first dot)
    std::string stem = s.substr (0, s.find ('.'));
    for (auto& c : stem) if (c >= 'A' && c <= 'Z') c = static_cast<char> (c - 'A' + 'a');
    const bool reserved = stem == "con" || stem == "prn" || stem == "aux" || stem == "nul"
        || (stem.size() == 4 && (stem.compare (0, 3, "com") == 0 || stem.compare (0, 3, "lpt") == 0)
            && stem[3] >= '1' && stem[3] <= '9');
    if (reserved) s.insert (s.begin(), '_');
    if (s.empty()) s = "untitled";

    if (s.size() > maxBytes)
    {
        std::size_t cut = maxBytes;
        while (cut > 0 && (static_cast<unsigned char> (s[cut]) & 0xC0) == 0x80) --cut;
        s.resize (cut);
        while (! s.empty() && (s.back() == '.' || s.back() == ' ')) s.pop_back();
        if (s.empty()) s = "untitled";
    }
    return s;
}

// ---------------------------------------------------------------------------
// Atomic write: temp + flush + rename. The target is either the old version or the
// complete new version, never a truncated file.
// ---------------------------------------------------------------------------
inline IoResult atomicWrite (const fs::path& target, std::string_view data, const AtomicWriteOptions& opt = {})
{
    std::error_code ec;
    const fs::path dir = target.parent_path();
    if (! dir.empty())
    {
        fs::create_directories (dir, ec);
        if (ec) return detail::makeError ("cannot create folder", dir, ec.message());
    }

    const fs::path tmp = detail::tempPathFor (target);
    bool crashed = false;
    IoResult w = detail::writeTempFile (tmp, data, opt, crashed);
    if (! w.ok) return w;   // on a simulated crash the temp file is intentionally left behind

    if (opt.keepBackup && fs::exists (target, ec))
    {
        fs::path bak = target;
        bak += ".bak";
        fs::copy_file (target, bak, fs::copy_options::overwrite_existing, ec);
        if (ec)
        {
            fs::remove (tmp, ec);
            return detail::makeError ("cannot create backup", bak, ec.message());
        }
    }

    std::string err;
    if (detail::publish (tmp, target, true, opt.flushToDisk, err) != 0)
    {
        fs::remove (tmp, ec);
        return detail::makeError ("cannot replace file", target, err);
    }
    IoResult ok;
    ok.path = target;
    return ok;
}

// First free path "<dir>/<stem><ext>", then "<stem> 2<ext>", "<stem> 3<ext>", ...
inline fs::path uniquePath (const fs::path& dir, const std::string& stem, const std::string& ext, int startIndex = 1)
{
    std::error_code ec;
    for (int i = startIndex; i < 100000; ++i)
    {
        const std::string name = i <= 1 ? stem + ext : stem + " " + std::to_string (i) + ext;
        const fs::path p = dir / fs::path (name);
        if (! fs::exists (p, ec)) return p;
    }
    return dir / fs::path (stem + " (overflow)" + ext);
}

// Import: never overwrites. `ext` includes the dot (".snd"). Returns the final path in result.path.
inline IoResult importNoClobber (const fs::path& dir, std::string_view desiredName, const std::string& ext,
                                 std::string_view data, const AtomicWriteOptions& opt = {})
{
    std::error_code ec;
    fs::create_directories (dir, ec);
    if (ec) return detail::makeError ("cannot create folder", dir, ec.message());

    const std::string stem = sanitizeFilename (desiredName);
    const fs::path tmp = detail::tempPathFor (dir / fs::path (stem + ext));
    bool crashed = false;
    IoResult w = detail::writeTempFile (tmp, data, opt, crashed);
    if (! w.ok) return w;

    int index = 1;
    for (int attempt = 0; attempt < 10000; ++attempt)
    {
        const fs::path target = uniquePath (dir, stem, ext, index);
        std::string err;
        const int rc = detail::publish (tmp, target, false, opt.flushToDisk, err);
        if (rc == 0)
        {
            IoResult ok;
            ok.path = target;
            return ok;
        }
        if (rc == 2)
        {
            fs::remove (tmp, ec);
            return detail::makeError ("cannot import file", target, err);
        }
        ++index;   // somebody created that name between the check and the publish: try the next
    }
    fs::remove (tmp, ec);
    return detail::makeError ("no free file name", dir / fs::path (stem + ext), "too many collisions");
}

// Remove orphaned "*.tmp-<digits>" files (left by a killed process) older than minAgeSeconds.
// Non-recursive. Returns the number of files removed.
inline int cleanupStaleTemps (const fs::path& dir, long long minAgeSeconds = 3600)
{
    std::error_code ec;
    int removed = 0;
    const auto now = fs::file_time_type::clock::now();
    for (fs::directory_iterator it (dir, ec), end; ! ec && it != end; it.increment (ec))
    {
        if (! it->is_regular_file (ec)) continue;
        const std::string name = it->path().filename().string();
        const auto pos = name.rfind (".tmp-");
        if (pos == std::string::npos || pos + 5 >= name.size()) continue;
        bool digits = true;
        for (std::size_t i = pos + 5; i < name.size(); ++i) digits = digits && name[i] >= '0' && name[i] <= '9';
        if (! digits) continue;
        const auto age = std::chrono::duration_cast<std::chrono::seconds> (now - fs::last_write_time (it->path(), ec));
        if (ec || age.count() < minAgeSeconds) continue;
        if (fs::remove (it->path(), ec)) ++removed;
    }
    return removed;
}

// Whole-file read helper with the same error contract.
inline IoResult readFileToString (const fs::path& file, std::string& out)
{
    out.clear();
    std::error_code ec;
    const auto size = fs::file_size (file, ec);
    if (ec) return detail::makeError ("cannot read file", file, ec.message());
    FILE* f =
#if defined(_WIN32)
        ::_wfopen (file.c_str(), L"rb");
#else
        std::fopen (file.c_str(), "rb");
#endif
    if (f == nullptr) return detail::makeError ("cannot open file", file, "open failed");
    out.resize (static_cast<std::size_t> (size));
    const std::size_t got = out.empty() ? 0 : std::fread (&out[0], 1, out.size(), f);
    std::fclose (f);
    if (got != out.size()) { out.clear(); return detail::makeError ("cannot read file", file, "short read"); }
    IoResult ok;
    ok.path = file;
    return ok;
}

} // namespace apc
