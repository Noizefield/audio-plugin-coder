// ApcPendingSwap.h - lock-free "prepare off-thread, swap on the audio thread" hand-off.
//
// C++17, std only (no JUCE). Header-only. Brand-agnostic.
//
// THE PATTERN (decision X-03: the audio thread never parses, allocates, locks or waits)
//
//   message / worker thread                          audio thread (processBlock)
//   -----------------------                          ---------------------------
//   parse JSON, validate, build an IMMUTABLE         const Engine* e = swap.acquire();   // wait-free
//   `Engine` object (all allocation happens here)    if (e) render with *e;
//   swap.publish (std::move (engineUniquePtr));
//   ...                                              the NEXT acquire() that finds a newer object
//   swap.collectGarbage();   // delete retired ones  hands the previous one back through the trash
//                                                    ring - the audio thread never calls delete.
//
// Guarantees
//   * publish() : one producer thread at a time (message thread or one worker). Allocation-free except the
//     object the caller already built. If a not-yet-consumed object is replaced it is deleted on the
//     producer thread (the audio thread never saw it).
//   * acquire() : ONE consumer thread (the audio thread). Wait-free: one atomic exchange, one bounded loop
//     over the fixed trash ring (kTrash slots). Never allocates, locks or deletes. The returned pointer
//     stays valid until the next acquire() call on the same thread (use it for the whole block).
//   * If the trash ring is full (message thread starved) the swap is POSTPONED to a later block: the audio
//     thread keeps rendering with the old object. Correct, merely late.
//   * collectGarbage() : producer side, call after publish() and from a timer. Deletes retired objects.
//   * generation() increments on every publish: "state restore supersedes a pending selection" (P-12) -
//     a deferred program change records generation() when requested and drops itself if it changed.
//
// What may be inside T: anything immutable once published (resolved parameter tables, a modulation matrix,
// a sample map, engine settings). Do NOT put juce::var / std::string you intend to mutate there.
#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <utility>

namespace apc
{
template <class T, std::size_t kTrash = 4>
class PendingSwap
{
public:
    PendingSwap() = default;
    PendingSwap (const PendingSwap&) = delete;
    PendingSwap& operator= (const PendingSwap&) = delete;

    ~PendingSwap()
    {
        delete pending_.exchange (nullptr);
        delete active_;
        for (auto& s : trash_) delete s.exchange (nullptr);
    }

    // ---- producer (message / worker thread) ---------------------------------------------------------
    void publish (std::unique_ptr<T> next)
    {
        T* old = pending_.exchange (next.release(), std::memory_order_acq_rel);
        delete old;   // never reached the audio thread
        generation_.fetch_add (1, std::memory_order_acq_rel);
        collectGarbage();
    }

    void collectGarbage()
    {
        for (auto& s : trash_)
            if (T* t = s.exchange (nullptr, std::memory_order_acq_rel)) delete t;
    }

    std::uint64_t generation() const noexcept { return generation_.load (std::memory_order_acquire); }
    bool hasPending() const noexcept { return pending_.load (std::memory_order_acquire) != nullptr; }

    // ---- consumer (audio thread) ---------------------------------------------------------------------
    // Returns the newest published object (or nullptr before the first publish).
    const T* acquire() noexcept
    {
        if (pending_.load (std::memory_order_acquire) == nullptr) return active_;

        if (active_ != nullptr)
        {
            // Retire the old object BEFORE taking the new one so nothing is lost if the ring is full.
            std::size_t slot = kTrash;
            for (std::size_t i = 0; i < kTrash; ++i)
                if (trash_[i].load (std::memory_order_acquire) == nullptr) { slot = i; break; }
            if (slot == kTrash) return active_;   // postpone the swap, keep rendering the old object

            // Only this (consumer) thread fills trash slots and the producer only ever EMPTIES them, so the
            // slot found empty above is still empty: a plain release store is enough.
            T* fresh = pending_.exchange (nullptr, std::memory_order_acq_rel);
            if (fresh == nullptr) return active_;   // producer took it back meanwhile

            trash_[slot].store (active_, std::memory_order_release);
            active_ = fresh;
            return active_;
        }

        active_ = pending_.exchange (nullptr, std::memory_order_acq_rel);
        return active_;
    }

private:
    std::atomic<T*> pending_ { nullptr };
    T* active_ = nullptr;   // audio thread only
    std::array<std::atomic<T*>, kTrash> trash_ {};
    std::atomic<std::uint64_t> generation_ { 0 };
};

} // namespace apc
