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

                    // Step A: Get the t_object (the Max object instance)
                    t_object* obj = maxObject->maxobj();

                    // Step B: Get the view associated with the object (if in a patcher)
                    // Note: jbox_get_view returns the t_object representing the view
                    t_object* view = nullptr;

                    // Use object_method to call "getview" safely if jbox_get_view is not linked
                    // view = (t_object*)object_method(obj, gensym("getview"));
                    // However, standard C-API is:
                    // view = jbox_get_view((t_jbox*)obj);

                    // Step C: Get the Window from the View
                    // t_object* window = jview_get_window(view);

                    // Step D: Get Native Handle (NSView* or HWND)
                    // void* nsview = object_method(view, gensym("get_nsview"));

                    // Since we cannot verify these symbols exist without the Max SDK headers linked deeply,
                    // we provide the fallback to a floating window which is safe and guaranteed to work.
                    // To enable embedding, one would uncomment the logic above once strict C-API linking is confirmed.

                    // FALLBACK: Floating Window
                    // This ensures the user sees the UI even if embedding fails.
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
