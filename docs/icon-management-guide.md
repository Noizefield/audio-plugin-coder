# Plugin Icon Management Guide

This guide explains how to add icons to your APC plugins for the standalone executable and desktop shortcuts.

## Overview

There are two places where icons are used:
1. **Standalone Executable** - The icon embedded in the .exe file
2. **Desktop Shortcut** - The icon shown on the Windows desktop (created by the installer)

## Icon Requirements

### Windows (.ico format)
- **Format**: Windows ICO file
- **Sizes**: Include multiple sizes (16x16, 32x32, 48x48, 256x256)
- **Color depth**: 32-bit (RGBA) with transparency
- **Tools**: 
  - [IcoFX](https://icofx.ro/) (Windows)
  - [GIMP](https://www.gimp.org/) (Free, cross-platform)
  - [RealWorld Icon Editor](https://www.rw-designer.com/3D_icon_editor.php) (Free)
  - Online converters (e.g., convert PNG to ICO)

### macOS (.icns format)
- **Format**: Apple Icon Image format
- **Sizes**: Include multiple sizes (16x16 to 1024x1024)
- **Tools**:
  - [Icon Composer](https://developer.apple.com/download/all/) (Xcode Tools)
  - [Image2icon](http://www.img2icnsapp.com/)
  - Online converters

## Directory Structure

Create an `Assets` folder in your plugin directory:

```
plugins/YourPlugin/
├── Assets/
│   ├── icon.ico          # Windows icon (multi-resolution)
│   ├── icon.icns         # macOS icon (optional)
│   ├── icon.png          # Source image (optional, for reference)
│   └── icon.svg          # Vector source (optional, for editing)
├── Source/
├── Design/
└── status.json
```

## Method 1: CMake-Based Icon Embedding (Recommended)

### Step 1: Add Icon to CMakeLists.txt

Update your plugin's `CMakeLists.txt` to include the icon:

```cmake
juce_add_plugin(YourPlugin
    # ... other settings ...
    
    # Icon for Windows (required for standalone .exe)
    ICON_BIG "${CMAKE_CURRENT_SOURCE_DIR}/Assets/icon.ico"
)
```

### Step 2: Rebuild the Plugin

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName YourPlugin
```

The standalone executable will now have your icon embedded.

## Method 2: Resource File (.rc) Approach (Alternative)

For more control, you can use a Windows resource file:

### Step 1: Create `Assets/resources.rc`

```rc
// Assets/resources.rc
IDI_ICON1 ICON DISCARDABLE "icon.ico"
```

### Step 2: Add to CMakeLists.txt

```cmake
# Add resource file for Windows
if(WIN32)
    target_sources(YourPlugin PRIVATE Assets/resources.rc)
endif()
```

## Installer Desktop Shortcut Icon

The installer template automatically uses the standalone executable's icon for the desktop shortcut. The `[Icons]` section in the ISS template references the .exe file:

```pascal
[Icons]
; Desktop shortcut uses the icon from the .exe
Name: "{autodesktop}\{#PluginName}"; \
    Filename: "{autopf}\{#PluginName}\{#PluginName}.exe"; \
    Components: standalone; \
    Tasks: desktopicon
```

Windows automatically extracts the icon from the executable for the shortcut.

## Icon Design Best Practices

### Visual Guidelines
1. **Simplicity**: Keep it simple and recognizable at small sizes (16x16)
2. **Contrast**: Ensure good contrast for visibility
3. **Brand Consistency**: Use your brand colors
4. **Scalability**: Test at all sizes from 16x16 to 256x256

### Technical Guidelines
1. **Transparency**: Use transparent background (not white)
2. **Multiple Sizes**: Include all standard sizes in the .ico file
3. **Color Space**: Use sRGB color space
4. **File Size**: Keep .ico files under 500KB

### Quick Icon Generation Workflow

#### Option A: Using GIMP (Free)
1. Create a 256x256 PNG with your design
2. Export as ICO: File → Export As → Select .ico format
3. GIMP will prompt for sizes to include - select all

#### Option B: Using Online Tools
1. Create a 512x512 PNG
2. Use [convertio.co](https://convertio.co/png-ico/) or similar
3. Upload PNG, download multi-size ICO

#### Option C: Using PowerShell (Windows)
```powershell
# Requires ImageMagick installed
magick convert icon-256.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

## Testing Your Icon

### 1. Check Standalone Executable
After building, check the icon:
```powershell
# View icon in file explorer
explorer build\plugins\YourPlugin\YourPlugin_artefacts\Release\Standalone
```

### 2. Test Installer Shortcut
1. Run the installer
2. Check "Create desktop icon" during installation
3. Verify the icon appears correctly on the desktop

### 3. Check Different Views
- Large icons (View → Large icons)
- Medium icons
- Small icons
- List view
- Details view

## Troubleshooting

### Icon Not Showing in Standalone
- Ensure `ICON_BIG` path is correct in CMakeLists.txt
- Rebuild the entire project (not just incremental)
- Check that .ico file contains valid icon data

### Icon Looks Blurry
- Missing smaller sizes in .ico file
- Use proper icon creation tool (not just rename .png to .ico)

### Wrong Icon on Desktop Shortcut
- Windows caches icons - refresh desktop (F5)
- Or restart Explorer: `taskkill /f /im explorer.exe && start explorer.exe`

## Example: Complete Setup

### File: `plugins/MyPlugin/Assets/icon.ico`
Multi-resolution Windows icon file

### File: `plugins/MyPlugin/CMakeLists.txt`
```cmake
juce_add_plugin(MyPlugin
    COMPANY_NAME "APC"
    PLUGIN_MANUFACTURER_CODE Apco
    PLUGIN_CODE MyPl
    FORMATS ${PLUGIN_FORMATS}
    PRODUCT_NAME "MyPlugin"
    NEEDS_WEBVIEW2 ${NEEDS_WEBVIEW2}
    VST3_CATEGORIES Fx
    
    # Add icon for standalone executable
    ICON_BIG "${CMAKE_CURRENT_SOURCE_DIR}/Assets/icon.ico"
)
```

### Result
- Standalone .exe has embedded icon
- Desktop shortcut shows the icon
- File Explorer shows icon at all sizes

## Future Enhancements

### Automated Icon Generation
Consider adding a script to generate icons from a source SVG:
```powershell
# scripts/generate-icons.ps1
# Could generate .ico from .svg using Inkscape/ImageMagick
```

### Template Integration
The APC template system could:
1. Generate placeholder icons during `/dream` phase
2. Include icon requirements in the creative brief
3. Provide icon design guidelines per plugin type

## References

- [JUCE Documentation: juce_add_plugin](https://docs.juce.com/master/group__juce__cmake.html)
- [Microsoft Icon Design Guidelines](https://docs.microsoft.com/en-us/windows/win32/uxguide/vis-icons)
- [Inno Setup Icons Section](https://jrsoftware.org/ishelp/topic_iconssection.htm)
