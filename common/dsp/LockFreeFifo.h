// apc::dsp::LockFreeFifo<T> - single-producer / single-consumer ring buffer.
//
//   * Exactly ONE thread may call tryPush() and exactly ONE (other) thread may call tryPop().
//   * Capacity is rounded up to a power of two; storage is allocated in prepare() only.
//   * T must be trivially copyable (messages, parameter events, meter values).
//   * Indices are free-running; head is written with release by the producer and read with
//     acquire by the consumer, and vice versa for tail.
//
// Real-time safety: tryPush / tryPop / size* never allocate, never block, never lock,
// and are wait-free. prepare() and the destructor allocate/free - call them off the
// audio thread (or from prepareToPlay) while neither side is running.
//
// Typical use: audio thread -> UI meter values (producer = audio), or
// UI -> audio thread commands (consumer = audio).
//
// Std-only C++17, no JUCE dependency.
#pragma once

#include <atomic>
#include <cstddef>
#include <type_traits>
#include <vector>

#if defined(_MSC_VER)
 #pragma warning(push)
 #pragma warning(disable : 4324) // padded due to alignas: intentional (cache-line separation)
#endif

namespace apc::dsp {

template <typename T>
class LockFreeFifo {
    static_assert(std::is_trivially_copyable<T>::value, "LockFreeFifo<T> requires a trivially copyable T");

public:
    LockFreeFifo() = default;
    explicit LockFreeFifo(std::size_t minCapacity) { prepare(minCapacity); }

    LockFreeFifo(const LockFreeFifo&) = delete;
    LockFreeFifo& operator=(const LockFreeFifo&) = delete;

    /// Allocate storage for at least `minCapacity` elements (rounded up to a power of two)
    /// and clear. NOT thread-safe against push/pop.
    void prepare(std::size_t minCapacity) {
        std::size_t cap = 2;
        while (cap < minCapacity) cap <<= 1;
        storage_.assign(cap, T{});
        mask_ = cap - 1;
        head_.store(0, std::memory_order_relaxed);
        tail_.store(0, std::memory_order_relaxed);
    }

    std::size_t capacity() const noexcept { return storage_.size(); }

    /// Producer thread only. Returns false if the FIFO is full.
    bool tryPush(const T& value) noexcept {
        const std::size_t h = head_.load(std::memory_order_relaxed);
        const std::size_t t = tail_.load(std::memory_order_acquire);
        if (h - t >= storage_.size()) return false;
        storage_[h & mask_] = value;
        head_.store(h + 1, std::memory_order_release);
        return true;
    }

    /// Consumer thread only. Returns false if the FIFO is empty.
    bool tryPop(T& out) noexcept {
        const std::size_t t = tail_.load(std::memory_order_relaxed);
        const std::size_t h = head_.load(std::memory_order_acquire);
        if (h == t) return false;
        out = storage_[t & mask_];
        tail_.store(t + 1, std::memory_order_release);
        return true;
    }

    /// Approximate element count (exact when called from producer or consumer thread).
    std::size_t sizeApprox() const noexcept {
        return head_.load(std::memory_order_acquire) - tail_.load(std::memory_order_acquire);
    }

    bool emptyApprox() const noexcept { return sizeApprox() == 0; }

private:
    // Separate cache lines so producer and consumer do not false-share.
    alignas(64) std::atomic<std::size_t> head_{0};
    alignas(64) std::atomic<std::size_t> tail_{0};
    alignas(64) std::size_t mask_ = 0;
    std::vector<T> storage_;
};

} // namespace apc::dsp

#if defined(_MSC_VER)
 #pragma warning(pop)
#endif
