#pragma once

#include <visage/ui.h>
#include <visage/graphics.h>
#include "BinaryData.h"
#include <juce_core/juce_core.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <string>

// Visage UI for Gnarly3 (Swiss minimal, real layout scaffold).
class VisageMainView : public visage::Frame {
public:
    enum class ParamId {
        Drive = 0,
        Cutoff = 1,
        Resonance = 2
    };

    using ParamChangeFn = std::function<void(ParamId, float)>;

    VisageMainView() = default;

    void init() override {
        updateFonts();
    }

    void dpiChanged() override {
        updateFonts();
    }

    void resized() override {
        layout();
    }

    void draw(visage::Canvas& canvas) override {
        // Background
        canvas.setColor(0xffffffff);
        canvas.fill(0, 0, width(), height());

        // Title
        if (fonts_ready_) {
            canvas.setColor(0xff000000);
            canvas.text("GNARLY", title_font_, visage::Font::kCenter,
                        0, layout_.title_y, width(), layout_.title_h);
        }

        // Graph container
        canvas.setColor(0xfff8f8f8);
        canvas.rectangle(layout_.content_x, layout_.graph_y, layout_.content_w, layout_.graph_h);
        canvas.fill(layout_.content_x, layout_.graph_y, layout_.content_w, layout_.graph_h);
        canvas.setColor(0xff000000);
        canvas.rectangleBorder(layout_.content_x, layout_.graph_y, layout_.content_w, layout_.graph_h, 1.0f);

        drawFilterGraph(canvas, layout_.content_x, layout_.graph_y, layout_.content_w, layout_.graph_h);

        // Controls container
        canvas.setColor(0xffffffff);
        canvas.rectangle(layout_.content_x, layout_.controls_y, layout_.content_w, layout_.controls_h);
        canvas.fill(layout_.content_x, layout_.controls_y, layout_.content_w, layout_.controls_h);
        canvas.setColor(0xff000000);
        canvas.rectangleBorder(layout_.content_x, layout_.controls_y, layout_.content_w, layout_.controls_h, 1.0f);

        drawControls(canvas);
    }

    void mouseDown(const visage::MouseEvent& e) override {
        const auto pos = e.relativePosition();
        active_knob_ = hitTestKnob(pos.x, pos.y);
        if (active_knob_ >= 0) {
            drag_start_y_ = pos.y;
            drag_start_value_ = knobs_[active_knob_].value01;
            knobs_[active_knob_].dragging = true;
            setMouseRelativeMode(true);
            setCursorVisible(false);
        }
    }

    void mouseDrag(const visage::MouseEvent& e) override {
        if (active_knob_ < 0)
            return;

        const auto pos = e.relativePosition();
        const float delta = (drag_start_y_ - pos.y);
        const float base_sens = 0.006f;
        const float fine = e.isShiftDown() ? 0.25f : 1.0f;
        float new_value = drag_start_value_ + delta * base_sens * fine;
        new_value = std::clamp(new_value, 0.0f, 1.0f);
        setKnobValue(active_knob_, new_value, true);
    }

    void mouseUp(const visage::MouseEvent& e) override {
        (void)e;
        if (active_knob_ >= 0) {
            knobs_[active_knob_].dragging = false;
        }
        active_knob_ = -1;
        setCursorVisible(true);
        setMouseRelativeMode(false);
    }

    void setParameterValues(float drive_db, float cutoff_hz, float resonance) {
        setKnobValue(static_cast<int>(ParamId::Drive), normalizeDrive(drive_db), false);
        setKnobValue(static_cast<int>(ParamId::Cutoff), normalizeCutoff(cutoff_hz), false);
        setKnobValue(static_cast<int>(ParamId::Resonance), std::clamp(resonance, 0.0f, 1.0f), false);
    }

    void setParamChangeCallback(ParamChangeFn fn) { on_param_change_ = std::move(fn); }

private:
    struct KnobState {
        float value01 = 0.0f;
        bool dragging = false;
        float cx = 0.0f;
        float cy = 0.0f;
        float r = 0.0f;
        const char* label = "";
    };

    struct Layout {
        float pad = 20.0f;
        float title_h = 32.0f;
        float graph_h = 120.0f;
        float controls_h = 140.0f;
        float gap = 20.0f;
        float content_w = 380.0f;
        float content_x = 0.0f;
        float title_y = 20.0f;
        float graph_y = 64.0f;
        float controls_y = 204.0f;
    };

    void layout() {
        layout_.content_w = std::min(380.0f, width() - layout_.pad * 2.0f);
        layout_.content_x = (width() - layout_.content_w) * 0.5f;
        layout_.title_y = layout_.pad;
        layout_.graph_y = layout_.title_y + layout_.title_h + 12.0f;
        layout_.controls_y = layout_.graph_y + layout_.graph_h + layout_.gap;

        const float knob_d = 70.0f;
        const float knob_gap = 20.0f;
        const float total_w = knob_d * 3.0f + knob_gap * 2.0f;
        const float start_x = layout_.content_x + (layout_.content_w - total_w) * 0.5f;
        const float center_y = layout_.controls_y + 52.0f;

        knobs_[0].cx = start_x + knob_d * 0.5f;
        knobs_[1].cx = start_x + knob_d * 1.5f + knob_gap;
        knobs_[2].cx = start_x + knob_d * 2.5f + knob_gap * 2.0f;
        knobs_[0].cy = center_y;
        knobs_[1].cy = center_y;
        knobs_[2].cy = center_y;
        knobs_[0].r = knob_d * 0.5f;
        knobs_[1].r = knob_d * 0.5f;
        knobs_[2].r = knob_d * 0.5f;

        knobs_[0].label = "Drive";
        knobs_[1].label = "Cutoff";
        knobs_[2].label = "Resonance";
    }

    void drawFilterGraph(visage::Canvas& canvas, float x, float y, float w, float h) {
        const float drive_db = denormalizeDrive(knobs_[0].value01);
        const float cutoff = denormalizeCutoff(knobs_[1].value01);
        const float resonance = knobs_[2].value01;

        const float min_db = -24.0f;
        const float max_db = 24.0f;

        auto dbToY = [&](float db) {
            float t = (db - min_db) / (max_db - min_db);
            float py = y + h - (t * h);
            return std::clamp(py, y + 1.0f, y + h - 1.0f);
        };

        canvas.setColor(0xff000000);
        const int steps = 160;
        float last_x = x;
        float last_y = y + h * 0.5f;

        for (int i = 0; i <= steps; ++i) {
            float t = static_cast<float>(i) / static_cast<float>(steps);
            float freq = 20.0f * std::pow(1000.0f, t); // 20Hz -> 20kHz

            float lowpass = 1.0f / (1.0f + std::pow(freq / cutoff, 4.0f));
            // Stronger, sharper resonance peak
            float peak = (1.0f + 2.2f * resonance) * resonance *
                         std::exp(-std::pow(std::log(freq / cutoff), 2.0f) / 0.025f);
            float base = lowpass + peak;

            float drive_norm = std::clamp((drive_db + 24.0f) / 48.0f, 0.0f, 1.0f);
            float logx = std::log(freq / 20.0f) / std::log(1000.0f);
            float grit = (0.03f + 0.08f * drive_norm) * std::sin(18.0f * logx + drive_norm * 3.0f)
                       * (0.5f + 0.5f * std::sin(5.0f * logx + resonance * 2.0f));
            float asym = 1.0f + 0.15f * drive_norm * std::sin(3.0f * logx);
            float mag = std::tanh((base + grit) * (1.0f + drive_norm * 2.5f)) * asym;

            // Drive only affects vertical shift subtly (~10%)
            float db = 20.0f * std::log10(std::max(0.0001f, mag)) + drive_db * 0.1f;

            float px = x + t * w;
            float py = dbToY(db);

            if (i > 0) {
                canvas.segment(last_x, last_y, px, py, 2.0f, true);
            }
            last_x = px;
            last_y = py;
        }
    }

    void drawControls(visage::Canvas& canvas) {
        const float drive_db = denormalizeDrive(knobs_[0].value01);
        const float cutoff = denormalizeCutoff(knobs_[1].value01);
        const float resonance = knobs_[2].value01;

        drawKnob(canvas, knobs_[0], formatDrive(drive_db).c_str());
        drawKnob(canvas, knobs_[1], formatCutoff(cutoff).c_str());
        drawKnob(canvas, knobs_[2], formatResonance(resonance).c_str());
    }

    void drawKnob(visage::Canvas& canvas, const KnobState& k, const char* value) {
        // Knob body
        canvas.setColor(0xffffffff);
        canvas.circle(k.cx - k.r, k.cy - k.r, k.r * 2.0f);
        canvas.setColor(0xff000000);
        canvas.ring(k.cx - k.r, k.cy - k.r, k.r * 2.0f, 2.0f);

        // Indicator
        // Rotate knob start so 0.0 ~ 7:00 position (user expectation)
        const float angle_offset = -90.0f;
        const float angle = (-135.0f + 270.0f * k.value01 + angle_offset) * (3.14159265f / 180.0f);
        const float len = k.r * 0.7f;
        float ix = k.cx + std::cos(angle) * len;
        float iy = k.cy + std::sin(angle) * len;
        canvas.segment(k.cx, k.cy, ix, iy, 2.0f, true);

        if (fonts_ready_) {
            canvas.setColor(0xff000000);
            canvas.text(k.label, label_font_, visage::Font::kCenter,
                        k.cx - k.r, k.cy + k.r + 8.0f, k.r * 2.0f, 16.0f);
            canvas.setColor(0xff666666);
            canvas.text(value, value_font_, visage::Font::kCenter,
                        k.cx - k.r, k.cy + k.r + 24.0f, k.r * 2.0f, 14.0f);
        }
    }

    int hitTestKnob(float x, float y) const {
        for (int i = 0; i < static_cast<int>(knobs_.size()); ++i) {
            const auto& k = knobs_[i];
            const float dx = x - k.cx;
            const float dy = y - k.cy;
            if ((dx * dx + dy * dy) <= (k.r * k.r))
                return i;
        }
        return -1;
    }

    void setKnobValue(int index, float value01, bool from_user) {
        if (index < 0 || index >= static_cast<int>(knobs_.size()))
            return;
        if (knobs_[index].dragging && !from_user)
            return;

        knobs_[index].value01 = std::clamp(value01, 0.0f, 1.0f);
        if (from_user && on_param_change_)
            on_param_change_(static_cast<ParamId>(index), knobs_[index].value01);
        redraw();
    }

    static float normalizeDrive(float db) {
        return std::clamp((db + 24.0f) / 48.0f, 0.0f, 1.0f);
    }

    static float denormalizeDrive(float norm) {
        return -24.0f + 48.0f * std::clamp(norm, 0.0f, 1.0f);
    }

    static float normalizeCutoff(float hz) {
        float clamped = std::clamp(hz, 20.0f, 20000.0f);
        return std::log(clamped / 20.0f) / std::log(1000.0f);
    }

    static float denormalizeCutoff(float norm) {
        float t = std::clamp(norm, 0.0f, 1.0f);
        return 20.0f * std::pow(1000.0f, t);
    }

    static std::string formatDrive(float db) {
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%.1f dB", db);
        return buf;
    }

    static std::string formatCutoff(float hz) {
        char buf[32];
        if (hz >= 1000.0f)
            std::snprintf(buf, sizeof(buf), "%.1f kHz", hz / 1000.0f);
        else
            std::snprintf(buf, sizeof(buf), "%.0f Hz", hz);
        return buf;
    }

    static std::string formatResonance(float r) {
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%.2f", r);
        return buf;
    }

    void updateFonts() {
        const float dpi = std::max(1.0f, dpiScale());
        const auto* font_data = reinterpret_cast<const unsigned char*>(gnarly3_BinaryData::LatoRegular_ttf);
        title_font_ = visage::Font(24.0f, font_data, gnarly3_BinaryData::LatoRegular_ttfSize, dpi);
        label_font_ = visage::Font(14.0f, font_data, gnarly3_BinaryData::LatoRegular_ttfSize, dpi);
        value_font_ = visage::Font(12.0f, font_data, gnarly3_BinaryData::LatoRegular_ttfSize, dpi);
        fonts_ready_ = true;
    }

    bool fonts_ready_ = false;
    visage::Font title_font_;
    visage::Font label_font_;
    visage::Font value_font_;

    Layout layout_;
    std::array<KnobState, 3> knobs_ {};
    ParamChangeFn on_param_change_;
    int active_knob_ = -1;
    float drag_start_y_ = 0.0f;
    float drag_start_value_ = 0.0f;
};
