# apc-sanitizers.cmake - opt-in sanitizer support for APC targets.
#
#   set(APC_SANITIZE asan)            # or -DAPC_SANITIZE=asan on the command line
#   include(cmake/apc-sanitizers.cmake)
#   apc_enable_sanitizers(MyTarget)
#
# APC_SANITIZE values:
#   none   (default) no instrumentation
#   asan   AddressSanitizer   (clang, gcc, MSVC /fsanitize=address)
#   ubsan  UndefinedBehaviorSanitizer (clang, gcc only; not available on MSVC)
#   tsan   ThreadSanitizer    (clang, gcc only; NOT supported on MSVC)
#
# Unsupported combinations produce a clear message: tsan on MSVC is a
# FATAL_ERROR (a silent no-op would look like a clean run), ubsan on MSVC is a
# WARNING and the target is left uninstrumented.
#
# Sanitized binaries are for validation runs only - never ship them. Use a
# separate build directory (see .agents/guides/audio-validation.md).

if(NOT DEFINED APC_SANITIZE OR "${APC_SANITIZE}" STREQUAL "")
    set(APC_SANITIZE "none")
endif()
string(TOLOWER "${APC_SANITIZE}" APC_SANITIZE)
set(APC_SANITIZE "${APC_SANITIZE}" CACHE STRING "Sanitizer: asan|ubsan|tsan|none" FORCE)
set_property(CACHE APC_SANITIZE PROPERTY STRINGS none asan ubsan tsan)

if(NOT APC_SANITIZE MATCHES "^(none|asan|ubsan|tsan)$")
    message(FATAL_ERROR "APC_SANITIZE='${APC_SANITIZE}' is invalid. Use asan, ubsan, tsan or none.")
endif()

function(apc_enable_sanitizers target)
    if(NOT TARGET ${target})
        message(FATAL_ERROR "apc_enable_sanitizers: '${target}' is not a target")
    endif()
    if(APC_SANITIZE STREQUAL "none")
        return()
    endif()

    if(MSVC)
        if(APC_SANITIZE STREQUAL "asan")
            # MSVC ASan is incompatible with /RTC1 and incremental linking, and
            # needs the debug-info format that survives it (Z7 / ProgramDatabase).
            target_compile_options(${target} PRIVATE /fsanitize=address /Zi)
            target_link_options(${target} PRIVATE /INCREMENTAL:NO)
            foreach(cfg IN ITEMS DEBUG RELWITHDEBINFO)
                string(REGEX REPLACE "/RTC[1csu]+" "" CMAKE_CXX_FLAGS_${cfg} "${CMAKE_CXX_FLAGS_${cfg}}")
                set(CMAKE_CXX_FLAGS_${cfg} "${CMAKE_CXX_FLAGS_${cfg}}" PARENT_SCOPE)
            endforeach()
            message(STATUS "APC sanitizers: ${target} -> MSVC /fsanitize=address "
                           "(the ASan runtime DLLs must be on PATH at run time; they ship with the VS 'C++ AddressSanitizer' component)")
        elseif(APC_SANITIZE STREQUAL "tsan")
            message(FATAL_ERROR
                "APC_SANITIZE=tsan is not supported with MSVC (no ThreadSanitizer). "
                "Run the tsan gate on Linux/macOS with clang or gcc.")
        else()
            message(WARNING
                "APC_SANITIZE=ubsan is not supported with MSVC; '${target}' is built WITHOUT instrumentation. "
                "Use clang-cl or a Linux/macOS toolchain for UBSan.")
        endif()
        return()
    endif()

    if(NOT (CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU"))
        message(FATAL_ERROR "APC_SANITIZE=${APC_SANITIZE}: unsupported compiler '${CMAKE_CXX_COMPILER_ID}'")
    endif()

    if(APC_SANITIZE STREQUAL "asan")
        set(_apc_san_flags -fsanitize=address)
        list(APPEND _apc_san_flags -fno-omit-frame-pointer)
    elseif(APC_SANITIZE STREQUAL "ubsan")
        set(_apc_san_flags -fsanitize=undefined -fno-sanitize-recover=undefined)
    else() # tsan
        set(_apc_san_flags -fsanitize=thread)
    endif()
    target_compile_options(${target} PRIVATE ${_apc_san_flags} -g)
    target_link_options(${target} PRIVATE ${_apc_san_flags})
    message(STATUS "APC sanitizers: ${target} -> ${_apc_san_flags}")
endfunction()
