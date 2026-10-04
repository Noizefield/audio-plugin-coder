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
static void npsCrashHandler(void*) {
    auto logFile = juce::File::getSpecialLocation(juce::File::userDocumentsDirectory)
                   .getChildFile("APC_CRASH_REPORT.txt");
    juce::String report = "TIME: " + juce::Time::getCurrentTime().toString(true, true) + "\n";
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
            // backbuffer_ is in raster pixels (native, or the windowless
            // cap from applyCanvasSizing); the editor bounds are logical —
            // stretchToFit bridges them. Low resample quality: a fast
            // software blit beats a few % of sharpness at 60 Hz.
            g.setImageResamplingQuality (juce::Graphics::lowResamplingQuality);
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
        onResize(getWidth(), getHeight());
        if (canvas_)
            applyCanvasSizing();
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

        onRender();   // cheap state sync every tick — input handling stays 60 Hz

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
            const double px = double(getWidth()) * double(getHeight())
                              * double(s) * double(s);
            constexpr double kMaxRasterPixels = 2160.0 * 1080.0;
            if (px > kMaxRasterPixels)
                raster = float (s * std::sqrt (kMaxRasterPixels / px));
        }
        const int nw = juce::jmax(1, juce::roundToInt(getWidth()  * raster));
        const int nh = juce::jmax(1, juce::roundToInt(getHeight() * raster));

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
    juce::Image backbuffer_;
    visage::Frame* event_root_ = nullptr;
    visage::MouseButton last_button_id_ = visage::kMouseButtonLeft;
};
