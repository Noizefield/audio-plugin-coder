#pragma once

#include "c74_min.h"
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_events/juce_events.h>
#include <juce_core/juce_core.h>

#include "JuceDSP.h"

using namespace c74::min;

/**
 * Bridges the gap between Max's jbox (UI Object) and JUCE's Component system.
 * Handles extracting the native window handle and attaching the JUCE editor.
 */
class JuceBridge : public juce::ComponentListener
{
public:
    JuceBridge(JuceDSP* processor, object_base* maxObject)
        : processor(processor), maxObject(maxObject)
    {
    }

    ~JuceBridge() override
    {
        if (editor)
        {
            // Clean up: Remove from desktop and delete
            editor->removeComponentListener(this);
            if (editor->isShowing())
                editor->removeFromDesktop();
            editor = nullptr;
        }
    }

    // ==============================================================================
    // BRIDGE LOGIC: Attach to Max Window
    // ==============================================================================

    void attachToMaxWindow()
    {
        // For this deliverable, we create the editor.
        // We use MessageManager::callAsync to ensure UI creation happens on the main thread

        if (!editor)
        {
            // Create the editor on the message thread
            juce::MessageManager::callAsync([this]() {

                // 1. Create Editor
                editor.reset(processor->createEditor());

                if (editor)
                {
                    editor->addComponentListener(this);

                    // ATTEMPT EMBEDDING LOGIC
                    // To properly embed a JUCE Component inside a Max jbox, we need the native window handle.
                    // Max exposes this via the 'jview' API, but Min-API hides some of this.
                    // We must use the underlying C-API.

                    void* nativeHandle = nullptr;

                    // ==============================================================================
                    // NATIVE WINDOW HANDLE EXTRACTION (TITAN STRATEGY)
                    // ==============================================================================
                    // Note: This block uses standard Max C-API calls. Ensure you link against
                    // the Max SDK C-Includes (which Min-API usually wraps).

                    // 1. Get the t_object (the Max object instance)
                    t_object* obj = maxObject->maxobj();

                    // 2. Cast to t_jbox* (assuming we are a UI object inheriting from jbox)
                    t_jbox* box = (t_jbox*)obj;

                    // 3. Get the Patcher View containing this box
                    // t_object* patcherview = jbox_get_patcherview(box);
                    // (Note: Requires linking 'jbox_get_patcherview')

                    // 4. Get the Native Window Handle from the View
                    // On macOS (Cocoa): We need the NSView*
                    // On Windows: We need the HWND

                    // Using object_method is safer if symbols are not directly linked:
                    /*
                    if (box) {
                        t_object* patcherview = (t_object*)object_method((t_object*)box, gensym("get_patcherview"));
                        if (patcherview) {
                            t_object* jwindow = (t_object*)object_method(patcherview, gensym("get_jwindow"));
                            if (jwindow) {
                                nativeHandle = (void*)object_method(jwindow, gensym("get_native_window"));
                            }
                        }
                    }
                    */

                    // Since we cannot verify these symbols exist without full SDK setup in this template context,
                    // we provide the placeholder logic. To enable embedding:
                    // 1. Ensure you link against MaxAPI.framework / MaxAPI.lib
                    // 2. Uncomment the block above.
                    // 3. Pass 'nativeHandle' to addToDesktop below.

                    // FALLBACK: Floating Window
                    // This ensures the user sees the UI even if embedding fails or is not enabled.
                    int flags = juce::ComponentPeer::windowHasTitleBar |
                                juce::ComponentPeer::windowIsResizable |
                                juce::ComponentPeer::windowAppearsOnTaskbar;

                    if (nativeHandle) {
                        editor->addToDesktop(0, nativeHandle);
                    } else {
                        // Add as a top-level window
                        editor->addToDesktop(flags);
                    }

                    editor->setVisible(true);
                    editor->toFront(true);
                }
            });
        }
        else
        {
            // Already created, just bring to front
            juce::MessageManager::callAsync([this]() {
                if (editor)
                {
                    editor->setVisible(true);
                    editor->toFront(true);
                }
            });
        }
    }

    // ==============================================================================
    // JUCE COMPONENT LISTENER
    // ==============================================================================

    void componentBeingDeleted(juce::Component& component) override
    {
        if (&component == editor.get())
        {
            // Use a raw pointer release or just let unique_ptr die?
            // Usually if the component is being deleted by something else, we should release ownership.
            // But here we own it. This callback usually happens if we delete it.
            // If the user closes the window (native close button), we might want to just hide it or destroy it.

            // If it's a native window close, we usually want to destroy the editor to save resources.
            // But unique_ptr manages it. We need to be careful not to double delete.
            // If component is being deleted, it's already dying.
             editor.release(); // Release ownership so unique_ptr doesn't delete again
        }
    }

private:
    JuceDSP* processor;
    object_base* maxObject;
    std::unique_ptr<juce::AudioProcessorEditor> editor;
};
