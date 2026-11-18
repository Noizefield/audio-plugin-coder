// apc::dsp::DenormalGuard - RAII flush-to-zero / denormals-are-zero.
//
//   x86/x64 (SSE)  sets MXCSR FTZ (bit 15) and DAZ (bit 6), restores on destruction.
//   ARM64          sets FPCR.FZ (bit 24), restores on destruction.
//                  (The GCC/Clang path uses mrs/msr; the MSVC-ARM64 path uses
//                  _ReadStatusReg and has not been compiled by the APC test-suite -
//                  treat it as unverified.)
//   anything else  no-op (kSupported == false).
//
// Put one on the stack at the top of processBlock(). The control register is per-thread,
// so it must be created on the audio thread (every callback is fine; it is two register
// moves).
//
// flushDenormal(x) is a software fallback for values you keep across blocks (filter
// state, feedback paths) and for platforms where the guard is a no-op.
//
// Real-time safety: no allocation, no locks, no system calls.
//
// Std-only C++17, no JUCE dependency.
#pragma once

#include <cmath>
#include <cstdint>
#include <limits>

#if defined(__SSE__) || defined(__SSE2__) || defined(_M_X64) || (defined(_M_IX86_FP) && _M_IX86_FP >= 1)
 #define APC_DSP_DENORMAL_X86 1
 #include <xmmintrin.h>
#elif defined(__aarch64__) || defined(_M_ARM64)
 #define APC_DSP_DENORMAL_ARM64 1
 #if defined(_MSC_VER) && !defined(__clang__)
  #include <intrin.h>
 #endif
#endif

namespace apc::dsp {

class DenormalGuard {
public:
#if defined(APC_DSP_DENORMAL_X86) || defined(APC_DSP_DENORMAL_ARM64)
    static constexpr bool kSupported = true;
#else
    static constexpr bool kSupported = false;
#endif

    DenormalGuard() noexcept : saved_(readControl()) { writeControl(withFlush(saved_)); }
    ~DenormalGuard() { writeControl(saved_); }

    DenormalGuard(const DenormalGuard&) = delete;
    DenormalGuard& operator=(const DenormalGuard&) = delete;

private:
#if defined(APC_DSP_DENORMAL_X86)
    static std::uint64_t readControl() noexcept { return _mm_getcsr(); }
    static void writeControl(std::uint64_t v) noexcept { _mm_setcsr(static_cast<unsigned int>(v)); }
    static std::uint64_t withFlush(std::uint64_t v) noexcept { return v | 0x8040u; } // FTZ | DAZ
#elif defined(APC_DSP_DENORMAL_ARM64)
 #if defined(_MSC_VER) && !defined(__clang__)
    static std::uint64_t readControl() noexcept { return static_cast<std::uint64_t>(_ReadStatusReg(0x5A20)); }
    static void writeControl(std::uint64_t v) noexcept { _WriteStatusReg(0x5A20, static_cast<__int64>(v)); }
 #else
    static std::uint64_t readControl() noexcept {
        std::uint64_t v;
        __asm__ __volatile__("mrs %0, fpcr" : "=r"(v));
        return v;
    }
    static void writeControl(std::uint64_t v) noexcept { __asm__ __volatile__("msr fpcr, %0" : : "r"(v)); }
 #endif
    static std::uint64_t withFlush(std::uint64_t v) noexcept { return v | (std::uint64_t(1) << 24); } // FZ
#else
    static std::uint64_t readControl() noexcept { return 0; }
    static void writeControl(std::uint64_t) noexcept {}
    static std::uint64_t withFlush(std::uint64_t v) noexcept { return v; }
#endif
    std::uint64_t saved_;
};

/// Software flush: returns 0 for subnormal (and exactly-zero) inputs, else x.
template <typename T>
inline T flushDenormal(T x) noexcept {
    return std::fabs(x) < std::numeric_limits<T>::min() ? T(0) : x;
}

/// True if x is a subnormal (denormal) number.
template <typename T>
inline bool isDenormal(T x) noexcept {
    return x != T(0) && std::fabs(x) < std::numeric_limits<T>::min();
}

} // namespace apc::dsp
