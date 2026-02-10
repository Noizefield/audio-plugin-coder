#pragma once

#include "c74_min.h"

// Helper to extract native window handle using C-API calls via object_method
// This avoids strict linking requirements for deep Max SDK headers in some build configs.
class MaxWindowHandle
{
public:
    static void* getNativeHandle(c74::min::object_base* maxObject)
    {
        using namespace c74::min;

        // 1. Get t_object
        t_object* obj = maxObject->maxobj();
        if (!obj) return nullptr;

        // 2. Get Patcher View (via 'getview' or 'get_patcherview' depending on object type)
        // For a jbox (UI object), we usually query the box first.

        // Try getting the view from the box directly
        t_object* view = (t_object*)object_method(obj, gensym("getview"));

        // If that fails, maybe we need to treat it as a box first to get patcherview
        // Note: Standard jbox_get_patcherview logic via messages
        if (!view) {
             view = (t_object*)object_method(obj, gensym("get_patcherview"));
        }

        if (!view) return nullptr;

        // 3. Get jwindow from view
        t_object* jwindow = (t_object*)object_method(view, gensym("get_jwindow"));
        if (!jwindow) return nullptr;

        // 4. Get Native Window (NSView* or HWND)
        void* handle = object_method(jwindow, gensym("get_native_window"));

        return handle;
    }
};
