/*
  ==============================================================================
    VisageJuceHost.h
    Bridge for JUCE 8 + Visage (Fixed Rendering Pipeline)
  ==============================================================================
*/
#pragma once
#include <juce_core/juce_core.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_events/juce_events.h>
#include "visage/app.h"
#include "visage/ui.h"
#include "visage/graphics.h"
#include <cstdlib>
#include <chrono>
#if defined(__SSE2__) || defined(_M_X64) || defined(_M_AMD64)
#include <emmintrin.h>
#endif

// Crash Handler
#if JUCE_WINDOWS
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <DbgHelp.h>
#endif

// Windows: `opaque` is the EXCEPTION_POINTERS* JUCE passes from its
// SEH wrapper — the dump captures the real faulting stack, which the
// text backtrace in the report often can't resolve.
static void npsCrashHandler(void* opaque) {
    auto docs = juce::File::getSpecialLocation(juce::File::userDocumentsDirectory);
#if JUCE_WINDOWS
    if (auto* dbghelp = ::LoadLibraryW(L"dbghelp.dll"))
    {
        typedef BOOL (WINAPI* MiniDumpWriteDumpFn) (HANDLE, DWORD, HANDLE,
            MINIDUMP_TYPE, PMINIDUMP_EXCEPTION_INFORMATION,
            PMINIDUMP_USER_STREAM_INFORMATION, PMINIDUMP_CALLBACK_INFORMATION);
        if (auto* writeDump = (MiniDumpWriteDumpFn) ::GetProcAddress(dbghelp, "MiniDumpWriteDump"))
        {
            const auto dumpPath = docs.getChildFile("APC_CRASH_MINIDUMP.dmp")
                                      .getFullPathName();
            HANDLE hf = ::CreateFileW(dumpPath.toWideCharPointer(),
                GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
            if (hf != INVALID_HANDLE_VALUE)
            {
                MINIDUMP_EXCEPTION_INFORMATION mei {};
                mei.ThreadId = ::GetCurrentThreadId();
                mei.ExceptionPointers = static_cast<EXCEPTION_POINTERS*>(opaque);
                mei.ClientPointers = FALSE;
                writeDump(::GetCurrentProcess(), ::GetCurrentProcessId(), hf,
                    (MINIDUMP_TYPE) (MiniDumpWithIndirectlyReferencedMemory
                                   | MiniDumpScanMemory),
                    opaque != nullptr ? &mei : nullptr, nullptr, nullptr);
                ::CloseHandle(hf);
            }
        }
        ::FreeLibrary(dbghelp);
    }
#endif
    auto logFile = docs.getChildFile("APC_CRASH_REPORT.txt");
    juce::String report = "TIME: " + juce::Time::getCurrentTime().toString(true, true) + "\n";
#if JUCE_WINDOWS
    if (auto* ep = static_cast<EXCEPTION_POINTERS*>(opaque))
        if (ep->ExceptionRecord != nullptr)
            report += "EXCEPTION: code=0x" + juce::String::toHexString(
                          (juce::int64) ep->ExceptionRecord->ExceptionCode)
                    + " addr=0x" + juce::String::toHexString(
                          (juce::int64) ep->ExceptionRecord->ExceptionAddress)
                    + " thread=0x" + juce::String::toHexString(
                          (juce::int64) ::GetCurrentThreadId()) + "\n";
#endif
    report += juce::SystemStats::getStackBacktrace();
    logFile.replaceWithText(report);
}

/**
 * VisagePluginEditor - A JUCE AudioProcessorEditor that hosts Visage UI
 * 
 * This class properly integrates Visage's rendering pipeline with JUCE's OpenGL context.
 * 
 * Key concepts:
 * 1. Visage uses a Frame hierarchy where each Frame has a Region
 * 2. The Canvas manages rendering and needs regions added to it
 * 3. Frames must be initialized and have their event handlers set up
 * 4. The redraw() mechanism triggers actual drawing via drawToRegion()
 */
class VisagePluginEditor : public juce::AudioProcessorEditor,
                           private juce::Timer
{
public:
    VisagePluginEditor(juce::AudioProcessor& p) : AudioProcessorEditor(&p) {
        static bool crashHandlerSet = false;
        if (!crashHandlerSet) {
            juce::SystemStats::setApplicationCrashHandler(npsCrashHandler);
            crashHandlerSet = true;
        }
        
        setOpaque(true);
        startTimerHz(60);
    }

    ~VisagePluginEditor() override {
        stopTimer();
        teardownVisage();
    }

    void paint(juce::Graphics& g) override {
        g.fillAll(juce::Colours::black);

        if (windowless_ && backbuffer_.isValid()) {
            // backbuffer_ is in raster pixels (native, or below native while
            // rasterQuality_ has stepped down); the editor bounds are logical —
            // stretchToFit bridges them. Bilinear when sizes differ so thin
            // hairline art doesn't stair-step into dashes on large windows;
            // at 1:1 JUCE blits straight through anyway.
            g.setImageResamplingQuality (juce::Graphics::mediumResamplingQuality);
            g.drawImageWithin(backbuffer_, 0, 0, getWidth(), getHeight(),
                              juce::RectanglePlacement::stretchToFit);
        }
    }

    void mouseDown(const juce::MouseEvent& e) override {
        dispatchMouse(e, MouseDispatch::Down);
    }

    void mouseDrag(const juce::MouseEvent& e) override {
        dispatchMouse(e, MouseDispatch::Drag);
    }

    void mouseUp(const juce::MouseEvent& e) override {
        dispatchMouse(e, MouseDispatch::Up);
    }

    void mouseMove(const juce::MouseEvent& e) override {
        dispatchMouse(e, MouseDispatch::Move);
    }

    void resized() override {
        settleTicks_ = 0;
        snappedAfterResize_ = false;   // settle window re-arms one native-res render
        onResize(getWidth(), getHeight());
        if (!canvas_)
            return;
        // A drag resize fires resized() per mouse step; reallocating the
        // bgfx framebuffer on every event storms the message thread —
        // that was the "unsharp + unstable for seconds" episode. Defer
        // the realloc until ~130ms of quiet; paint() stretches the old
        // backbuffer meanwhile. Swap-chain mode must track live.
        if (windowless_) {
            pendingResize_ = true;
            resizeQuietTicks_ = 0;
        } else {
            applyCanvasSizing();
        }
    }

    void timerCallback() override {
        if (!rendererInitialized_) {
            tryInitialize();
            return;
        }

        if (!canvas_)
            return;

        // monitor moves can change the peer's platform scale without a resize
        if (std::abs(uiScale() - canvasScale_) > 0.001f)
            applyCanvasSizing();

        // deferred canvas realloc from resized() — fires once the drag
        // has been quiet for ~8 ticks (~130ms), turning a resize storm
        // into one framebuffer realloc + one full repaint
        if (pendingResize_ && ++resizeQuietTicks_ >= 8) {
            pendingResize_ = false;
            applyCanvasSizing();
        }

        onRender();   // cheap state sync every tick — input handling stays 60 Hz
        ++settleTicks_; // wall-clock ticks, not rendered frames — decimation mustn't stretch the resize settle window

        // Whole-pipeline decimation: a rendered tick costs raster +
        // bgfx submit + readback + swizzle, all on the message thread that
        // also carries host calls — a busy DAW (or preset restore) starves
        // when frames eat the slot back-to-back. While a rendered frame
        // costs more than ~1/3 of the 16.6 ms budget the pipeline skips
        // whole ticks (30/20/15 Hz); stale frames stay queued and draw once
        // on the next rendered tick. Input events pull a render early, but
        // never faster than every 2nd tick — a held drag can't defeat the
        // divider.
        const int dec = frameEma_ > 18.0 ? 4
                      : frameEma_ > 11.0 ? 3
                      : frameEma_ >  6.0 ? 2 : 1;
        ++ticksSinceRender_;
        if (dec > 1 && ticksSinceRender_ < dec
            && !(inputPending_ && ticksSinceRender_ >= 2))
            return;
        inputPending_ = false;
        ticksSinceRender_ = 0;

        const auto t0 = std::chrono::steady_clock::now();
        drawStaleFrames();
        const int submitted = canvas_->submit();

        if (windowless_ && (submitted > 0 || !backbuffer_.isValid())) {
            updateBackbufferFromScreenshot(canvas_->takeScreenshot());
            repaint();
        }
        const double ms = std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - t0).count();
        frameEma_ = frameEma_ * 0.75 + ms * 0.25;

        // Adaptive raster quality: rendered cost scales with pixels, so when a
        // rendered frame persistently exceeds the tick budget we shrink the
        // raster in steps and let paint() upsample; when frames are cheap we
        // climb back to native. Sharpness is the default, softness is earned —
        // see the settle snap below.
        if (windowless_ && rendererInitialized_) {
            // Resize settle snap: a just-finished resize re-renders once at
            // native. Without it, a resize that ratcheted quality down only
            // climbs back while frames are cheap, and the [12,16]ms deadband
            // below could pin the reduced raster indefinitely — the resting
            // image must be sharp even when the drag itself was expensive.
            // If native turns out unaffordable the overload step-down walks
            // quality back from here.
            if (!snappedAfterResize_ && settleTicks_ > 30) {
                snappedAfterResize_ = true;
                rasterQuality_ = 1.0f;
                overloadStreak_ = 0;   // native gets a fresh evaluation window
            }

            // ~0.33s cooldown between checks so large windows settle instead of
            // visibly breathing while the cost estimate oscillates. Degrade is
            // the last resort — native raster is the product, so stepping down
            // needs SUSTAINED heavy frames (>24ms ema across ~4 consecutive
            // windows, i.e. seconds of real overload, not a one-off realloc or
            // post-snap spike — that case used to re-blur the UI ~1s after the
            // settle snap). A pathological streak (>45ms ema twice running)
            // still bails quickly to protect the message thread; a single
            // realloc/compile hitch no longer counts. The floor is 0.85 —
            // at 0.70 the bilinear upscale was obvious blur; 0.85 saves ~28%
            // of pixels with softness that's barely visible. Recovery at
            // <14ms climbs back in 0.15 steps so post-spike blur lasts ~1s
            // instead of several.
            constexpr float kRasterFloor = 0.85f;
            if (frameEma_ > 45.0 && rasterQuality_ > kRasterFloor) {
                if (++panicStreak_ >= 2) {
                    rasterQuality_ = juce::jmax (kRasterFloor, rasterQuality_ - 0.10f);
                    panicStreak_ = 0;
                    overloadStreak_ = 0;
                    rasterCooldown_ = 0;
                }
            }
            else {
                panicStreak_ = 0;
            }
            if (++rasterCooldown_ >= 20) {
                if (frameEma_ > 24.0) {
                    if (++overloadStreak_ >= 4 && rasterQuality_ > kRasterFloor) {
                        rasterQuality_ = juce::jmax (kRasterFloor, rasterQuality_ - 0.05f);
                        overloadStreak_ = 0;
                    }
                    rasterCooldown_ = 0;
                }
                else {
                    overloadStreak_ = 0;
                    if (frameEma_ < 14.0 && rasterQuality_ < 1.0f) {
                        rasterQuality_ = juce::jmin (1.0f, rasterQuality_ + 0.15f);
                        rasterCooldown_ = 0;
                    }
                }
            }
            const int step = juce::roundToInt (rasterQuality_ * 20.0f);
            if (step != rasterStep_) {
                rasterStep_ = step;
                applyCanvasSizing();
            }
        }
    }

    // Override these in your subclass
    virtual void onInit() {}
    virtual void onRender() {}
    virtual void onDestroy() {}
    virtual void onResize(int w, int h) {}

protected:
    visage::Canvas& getCanvas() { return *canvas_; }
    visage::FrameEventHandler& getEventHandler() { return eventHandler_; }
    void setEventRoot(visage::Frame* root) { event_root_ = root; }
    
    /**
     * Add a frame to the canvas for rendering.
     * This sets up the frame's region and event handler.
     */
    void addFrameToCanvas(visage::Frame* frame) {
        if (!canvas_ || !frame)
            return;
            
        // Add the frame's region to the canvas
        canvas_->addRegion(frame->region());
        
        // Set up the event handler so redraw() works
        frame->setEventHandler(&eventHandler_);
        
        // Set DPI scale
        frame->setDpiScale(uiScale());
        attachedFrames_.push_back(frame);

        // Initialize the frame
        frame->init();
        
        // Trigger initial redraw
        frame->redrawAll();
    }
    
    /**
     * Remove a frame from the canvas.
     */
    void removeFrameFromCanvas(visage::Frame* frame) {
        if (!frame)
            return;
            
        // Clear event handler
        frame->setEventHandler(nullptr);

        auto fpos = std::find(attachedFrames_.begin(), attachedFrames_.end(), frame);
        if (fpos != attachedFrames_.end())
            attachedFrames_.erase(fpos);

        // Remove from stale list
        auto pos = std::find(staleFrames_.begin(), staleFrames_.end(), frame);
        if (pos != staleFrames_.end())
            staleFrames_.erase(pos);
    }
    
    /**
     * Draw all frames that need redrawing.
     * This is called automatically in renderOpenGL().
     */
    void drawStaleFrames() {
        if (!canvas_)
            return;
            
        // Swap stale list to avoid issues if redraw() is called during draw
        std::vector<visage::Frame*> drawing;
        std::swap(staleFrames_, drawing);
        
        for (visage::Frame* frame : drawing) {
            if (frame && frame->isDrawing())
                frame->drawToRegion(*canvas_);
        }
        
        // Handle any frames that were added during drawing
        for (auto it = staleFrames_.begin(); it != staleFrames_.end();) {
            visage::Frame* frame = *it;
            if (std::find(drawing.begin(), drawing.end(), frame) == drawing.end()) {
                if (frame && frame->isDrawing())
                    frame->drawToRegion(*canvas_);
                it = staleFrames_.erase(it);
            } else {
                ++it;
            }
        }
    }

private:
    enum class MouseDispatch {
        Down,
        Drag,
        Up,
        Move
    };

    void dispatchMouse(const juce::MouseEvent& e, MouseDispatch type) {
        if (!event_root_)
            return;
        inputPending_ = true;   // next tick renders even when decimated

        visage::MouseEvent me;
        me.event_frame = event_root_;
        me.position = { static_cast<float>(e.position.x), static_cast<float>(e.position.y) };
        me.relative_position = me.position;
        // visage hit-tests frames in window-local logical space — the editor
        // fills its peer so component coords are exactly that. getScreenX/Y
        // would be offset by the window's screen position.
        me.window_position = me.position;
        me.repeat_click_count = juce::jmax(1, e.getNumberOfClicks());

        int mods = visage::kModifierNone;
        if (e.mods.isShiftDown()) mods |= visage::kModifierShift;
        if (e.mods.isCtrlDown())  mods |= visage::kModifierRegCtrl;
        if (e.mods.isAltDown())   mods |= visage::kModifierAlt;
        if (e.mods.isCommandDown()) mods |= visage::kModifierCmd;
        me.modifiers = mods;

        int buttons = visage::kMouseButtonNone;
        if (e.mods.isLeftButtonDown())   buttons |= visage::kMouseButtonLeft;
        if (e.mods.isMiddleButtonDown()) buttons |= visage::kMouseButtonMiddle;
        if (e.mods.isRightButtonDown())  buttons |= visage::kMouseButtonRight;
        me.button_state = buttons;

        if (type == MouseDispatch::Down) {
            last_button_id_ = e.mods.isLeftButtonDown() ? visage::kMouseButtonLeft :
                              e.mods.isRightButtonDown() ? visage::kMouseButtonRight :
                              e.mods.isMiddleButtonDown() ? visage::kMouseButtonMiddle :
                              visage::kMouseButtonLeft;
        }
        me.button_id = last_button_id_;
        // a plain move is not a down event — only down and drag carry a press
        me.is_down = (type == MouseDispatch::Down || type == MouseDispatch::Drag);

        switch (type) {
            case MouseDispatch::Down: event_root_->processMouseDown(me); break;
            case MouseDispatch::Drag: event_root_->processMouseDrag(me); break;
            case MouseDispatch::Up:   event_root_->processMouseUp(me); break;
            case MouseDispatch::Move: event_root_->processMouseMove(me); break;
        }
    }

    void tryInitialize() {
        if (rendererInitialized_)
            return;

        auto* peer = getPeer();
        if (!peer)
            return;

        void* nativeWindow = peer->getNativeHandle();
        if (!nativeWindow)
            return;

        // init headless first — a null nwh keeps bgfx's default framebuffer
        // off the HWND so the composite layer's swap chain is the only one
        // bound to the window (two swap chains on one HWND = crash). Caps
        // need a live renderer, so init precedes swapChainSupported().
        visage::Renderer::instance().initialize(nullptr, nullptr);

        canvas_ = std::make_unique<visage::Canvas>();

        // GPU path: a real D3D11/12 swap chain would present straight to
        // the HWND — no per-frame GPU->CPU readback, pixel swizzle or JUCE
        // blit. Visage expects to OWN the window it presents to; on a
        // JUCE-hosted HWND the swap chain initializes but never displays
        // (verified black screen), so it stays an experiment: opt in with
        // MYRIAPLEX_GPUUI=1, force off with =0.
        bool useSwapChain = false;
        if (const char* e = std::getenv("MYRIAPLEX_GPUUI"))
            useSwapChain = *e != '0';
        if (useSwapChain && !visage::Canvas::swapChainSupported())
            useSwapChain = false;

        windowless_ = !useSwapChain;
        if (useSwapChain) {
            // pairToWindow wants the HWND's client rect in native pixels
            const float s = uiScale();
            canvas_->pairToWindow(nativeWindow,
                                  juce::jmax(1, juce::roundToInt(getWidth()  * s)),
                                  juce::jmax(1, juce::roundToInt(getHeight() * s)));
        }
        applyCanvasSizing();

        eventHandler_.request_redraw = [this](visage::Frame* frame) {
            if (std::find(staleFrames_.begin(), staleFrames_.end(), frame) == staleFrames_.end())
                staleFrames_.push_back(frame);
        };

        eventHandler_.remove_from_hierarchy = [this](visage::Frame* frame) {
            auto pos = std::find(staleFrames_.begin(), staleFrames_.end(), frame);
            if (pos != staleFrames_.end())
                staleFrames_.erase(pos);
        };

        rendererInitialized_ = true;
        onInit();
    }

    void teardownVisage() {
        rendererInitialized_ = false;
        staleFrames_.clear();
        onDestroy();
        if (canvas_) {
            canvas_->removeFromWindow();
            canvas_.reset();
        }
        windowless_ = false;
        backbuffer_ = juce::Image();
    }

    // native pixels per logical point for this editor's peer
    float uiScale() const {
        if (auto* peer = getPeer())
            return (float) peer->getPlatformScaleFactor();
        return (float) getDesktopScaleFactor();
    }

    // canvas dimensions are native pixels; visage converts logical layout to
    // native via dpi_scale_ — same contract as visage::ApplicationEditor.
    // Windowless mode additionally caps the raster size: every submitted
    // frame pays a GPU readback + RGBA->ARGB swizzle + JUCE blit over the
    // whole buffer, so beyond ~2.3MP the message thread starves. Past the
    // cap we render at a reduced scale and let paint() upscale — soft at
    // extreme DPI, but the UI stays responsive.
    void applyCanvasSizing() {
        if (!canvas_)
            return;

        const float s = uiScale();
        canvasScale_ = s;
        float raster = s;
        if (windowless_) {
            raster = s * rasterQuality_;
            const double px = double(getWidth()) * double(getHeight())
                              * double(raster) * double(raster);
            constexpr double kMaxRasterPixels = 3840.0 * 2160.0;   // 4K bound
            if (px > kMaxRasterPixels)
                raster = float (raster * std::sqrt (kMaxRasterPixels / px));
        }
        const int nw = juce::jmax(1, juce::roundToInt(getWidth()  * raster));
        const int nh = juce::jmax(1, juce::roundToInt(getHeight() * raster));

        if (const char* dbg = std::getenv("MYRIAPLEX_RASTERLOG")) {
            if (FILE* pf = std::fopen(dbg, "a")) {
                std::fprintf(pf, "canvas=[%d,%d] raster=%.3f quality=%.3f uiScale=%.3f view=[%d,%d] ema=%.2f\n",
                             nw, nh, raster, rasterQuality_, s, getWidth(), getHeight(), frameEma_);
                std::fclose(pf);
            }
        }
        if (windowless_)
            canvas_->setWindowless(nw, nh);
        else
            canvas_->setDimensions(nw, nh);
        canvas_->setDpiScale(raster);
        for (visage::Frame* frame : attachedFrames_)
            frame->setDpiScale(raster);
    }

    void updateBackbufferFromScreenshot(const visage::Screenshot& shot) {
        if (shot.width() <= 0 || shot.height() <= 0)
            return;

        if (!backbuffer_.isValid() || backbuffer_.getWidth() != shot.width() || backbuffer_.getHeight() != shot.height()) {
            backbuffer_ = juce::Image(juce::Image::ARGB, shot.width(), shot.height(), true);
        }

        juce::Image::BitmapData data(backbuffer_, juce::Image::BitmapData::writeOnly);
        const uint8_t* src = shot.data();
        const int w = shot.width(), h = shot.height();
#if defined(__SSE2__) || defined(_M_X64) || defined(_M_AMD64)
        // RGBA -> BGRA (PixelARGB memory order) via SSE2: ~4px/iter vs 1px
        const __m128i keep = _mm_set1_epi32((int) 0xFF00FF00u);  // G,A lanes
        const __m128i lo8  = _mm_set1_epi32(0xFF);
        for (int y = 0; y < h; ++y) {
            auto* dst = reinterpret_cast<uint32_t*>(data.getLinePointer(y));
            const uint8_t* row = src + (size_t) y * w * 4;
            int x = 0;
            for (; x + 4 <= w; x += 4) {
                const __m128i v = _mm_loadu_si128((const __m128i*) (row + (size_t) x * 4));
                const __m128i b = _mm_and_si128(_mm_srli_epi32(v, 16), lo8); // old B -> byte0
                const __m128i r = _mm_slli_epi32(_mm_and_si128(v, lo8), 16); // old R -> byte2
                _mm_storeu_si128((__m128i*) (dst + x),
                                 _mm_or_si128(_mm_or_si128(b, r), _mm_and_si128(v, keep)));
            }
            for (; x < w; ++x) {
                const uint8_t r = row[x * 4], g = row[x * 4 + 1],
                              b = row[x * 4 + 2], a = row[x * 4 + 3];
                reinterpret_cast<juce::PixelARGB*>(dst)[x].setARGB(a, r, g, b);
            }
        }
#else
        for (int y = 0; y < h; ++y) {
            auto* dst = reinterpret_cast<juce::PixelARGB*>(data.getLinePointer(y));
            const uint8_t* row = src + (size_t) y * w * 4;
            for (int x = 0; x < w; ++x) {
                const uint8_t r = row[x * 4 + 0];
                const uint8_t g = row[x * 4 + 1];
                const uint8_t b = row[x * 4 + 2];
                const uint8_t a = row[x * 4 + 3];
                dst[x].setARGB(a, r, g, b);
            }
        }
#endif
    }

    std::unique_ptr<visage::Canvas> canvas_;
    visage::FrameEventHandler eventHandler_;
    std::vector<visage::Frame*> staleFrames_;
    std::vector<visage::Frame*> attachedFrames_;
    float canvasScale_ = 0.0f;  // platform scale the canvas was sized with
    double frameEma_ = 0.0;    // smoothed rendered-tick cost (ms)
    int ticksSinceRender_ = 0; // ticks since the last rendered frame
    bool inputPending_ = false; // input pulls an early render (30 Hz floor)
    bool rendererInitialized_ = false;
    bool windowless_ = false;
    float rasterQuality_ = 1.0f; // windowless raster scale, adapts to frame cost
    int rasterStep_ = 20;        // rasterQuality_ * 20, hysteresis for realloc
    int rasterCooldown_ = 0;     // ticks since last quality step
    int overloadStreak_ = 0;     // consecutive windows over the degrade threshold
    int panicStreak_ = 0;        // consecutive rendered frames >45ms (instant bail)
    int settleTicks_ = 0;        // timer ticks since the last resized()
    bool snappedAfterResize_ = false; // one native-res re-render per settled resize
    bool pendingResize_ = false; // deferred canvas realloc waiting for drag quiet
    int resizeQuietTicks_ = 0;   // ticks since the last resized() event
    juce::Image backbuffer_;
    visage::Frame* event_root_ = nullptr;
    visage::MouseButton last_button_id_ = visage::kMouseButtonLeft;
};
