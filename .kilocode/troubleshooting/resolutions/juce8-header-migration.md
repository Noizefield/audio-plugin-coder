# JUCE 8 Header Migration - JuceHeader.h Removed

**Issue ID:** build-004
**Category:** build
**Severity:** High
**Status:** SOLVED
**Date Resolved:** 2026-01-25

---

## Summary

JUCE 8 removed the convenience header `JuceHeader.h`. Projects must now include specific JUCE modules directly.

---

## Symptoms

```
error C1083: Cannot open include file: 'JuceHeader.h': No such file or directory
```

---

## Root Cause

JUCE 8 modernized the module system:
- Removed `JuceHeader.h` convenience header
- Requires explicit module includes for better compile times
- Reduces unnecessary dependencies

---

## Solution

Replace `#include <JuceHeader.h>` with specific module includes.

### ❌ WRONG (JUCE 7 style):
```cpp
#pragma once

#include <JuceHeader.h>
```

### ✅ CORRECT (JUCE 8 style):
```cpp
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_dsp/juce_dsp.h>
#include <juce_gui_extra/juce_gui_extra.h>
```

---

## Common Module Includes

### For PluginProcessor.h:
```cpp
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_dsp/juce_dsp.h>
```

### For PluginEditor.h:
```cpp
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>  // For WebView
```

### Complete Module List:
- `juce_audio_basics` - AudioBuffer, audio utilities
- `juce_audio_processors` - AudioProcessor base class
- `juce_audio_devices` - Audio I/O
- `juce_audio_formats` - Audio file reading/writing
- `juce_audio_utils` - Additional audio utilities
- `juce_core` - Core utilities (String, File, etc)
- `juce_data_structures` - ValueTree, etc
- `juce_dsp` - DSP processing classes
- `juce_events` - Event handling
- `juce_graphics` - Graphics rendering
- `juce_gui_basics` - Basic GUI components
- `juce_gui_extra` - WebView, advanced GUI

---

## Verification Steps

1. Remove all `#include <JuceHeader.h>` lines
2. Add specific module includes needed by your code
3. Rebuild - should compile without errors
4. Check that all JUCE classes are accessible

---

## Prevention

### For All New Plugins:

1. **Never use JuceHeader.h** in new code
2. **Include only what you need:**
   - Faster compile times
   - Clearer dependencies
   - Better code organization

3. **Use IDE autocomplete** to find correct module for a class
4. **Reference JUCE examples** - all use direct includes

---

## Related Issues

- **webview-005:** JUCE 8 WebView API changes
- **webview-006:** Resource type changes

---

## Notes

This change improves compile times significantly for large projects by avoiding unnecessary header includes.
