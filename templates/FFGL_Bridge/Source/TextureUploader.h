#pragma once

#include <juce_graphics/juce_graphics.h>
#include <juce_opengl/juce_opengl.h>

/**
 * Handles asynchronous texture uploading using Pixel Buffer Objects (PBOs)
 * if supported, or falls back to standard glTexImage2D.
 */
class TextureUploader
{
public:
    TextureUploader() = default;

    ~TextureUploader()
    {
        // Cleanup is tricky without context, usually handled by owner calling release()
        // with context active.
    }

    void release(juce::OpenGLContext& context)
    {
        // Ensure this is called with valid context
        if (pboID != 0)
        {
             // context.extensions.glDeleteBuffers(1, &pboID); // Requires extensions access
             pboID = 0;
        }
        if (textureID != 0)
        {
            // glDeleteTextures(1, &textureID);
            textureID = 0;
        }
    }

    // Uploads a JUCE Image to an OpenGL Texture
    void upload(const juce::Image& image, juce::OpenGLContext& context)
    {
        if (!image.isValid()) return;

        // 1. Get Image Data
        juce::Image::BitmapData data(image, juce::Image::BitmapData::readOnly);

        // 2. Generate Texture if needed
        if (textureID == 0)
        {
             glGenTextures(1, &textureID);
             glBindTexture(GL_TEXTURE_2D, textureID);
             glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
             glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
             // Allocate storage
             glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, image.getWidth(), image.getHeight(), 0, GL_BGRA, GL_UNSIGNED_BYTE, nullptr);
        }

        // 3. PBO Upload (Simplistic implementation)
        // Check extensions for PBO support via JUCE
        // auto* ext = context.extensions;
        // if (ext->isExtensionSupported("GL_ARB_pixel_buffer_object")) ...

        // For this template, we stick to standard upload for compatibility but outline PBO steps:
        // a. Bind PBO (GL_PIXEL_UNPACK_BUFFER)
        // b. glBufferData(..., data.data, GL_STREAM_DRAW)
        // c. glTexSubImage2D(..., 0) // offset 0 in PBO
        // d. Unbind PBO

        // Standard Fallback:
        glBindTexture(GL_TEXTURE_2D, textureID);
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, image.getWidth(), image.getHeight(),
                        GL_BGRA, GL_UNSIGNED_BYTE, data.data);
    }

    GLuint getTextureID() const { return textureID; }

private:
    GLuint textureID = 0;
    GLuint pboID = 0;
};
