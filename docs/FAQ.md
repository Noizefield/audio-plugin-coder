# Frequently Asked Questions (FAQ)

Common questions and answers about the Audio Plugin Coder framework.

## General Questions

### What is Audio Plugin Coder?

APC is a structured, AI-driven workflow system for building audio plugins. It guides LLM agents through the entire plugin development lifecycle from concept to shipped product using a five-phase workflow: Dream → Plan → Design → Implement → Ship.

### Who is APC for?

APC is designed for:
- **Audio developers** who want to leverage AI for faster development
- **AI coding agent users** who need structured context for audio plugin tasks
- **Musicians/Producers** who want to create their own plugins
- **Learning developers** who want to understand JUCE and audio DSP

### What platforms are supported?

| Platform | Local Build | GitHub Actions |
|----------|-------------|----------------|
| Windows 11 | ✅ Native | ✅ |
| macOS | ❌ | ✅ |
| Linux | ❌ | ✅ |

### What plugin formats are supported?

| Format | Windows | macOS | Linux |
|--------|---------|-------|-------|
| VST3 | ✅ | ✅ | ✅ |
| Standalone | ✅ | ✅ | ✅ |
| AU | ❌ | ✅ | ❌ |
| LV2 | ❌ | ❌ | ✅ |

---

## Getting Started

### How do I install APC?

```powershell
# Clone with submodules
git clone --recursive https://github.com/Noizefield/audio-plugin-coder.git
cd audio-plugin-coder

# Or clone and initialize separately
git clone https://github.com/Noizefield/audio-plugin-coder.git
cd audio-plugin-coder
git submodule update --init --recursive
```

### What are the prerequisites?

**Required:**
- Windows 11
- Visual Studio 2022 (with C++ tools)
- CMake 3.22+
- PowerShell 7+
- Git

**For WebView plugins:**
- WebView2 Runtime (usually pre-installed on Windows 11)

### How do I create my first plugin?

```
/dream MyFirstPlugin
```

The AI will guide you through:
1. Defining the concept
2. Planning the architecture
3. Designing the UI
4. Implementing the code
5. Shipping the final product

---

## Workflow Questions

### What are the five phases?

1. **DREAM (Ideation)** - Define the plugin concept and parameters
2. **PLAN (Architecture)** - Design DSP and select UI framework
3. **DESIGN (GUI)** - Create visual mockups and specifications
4. **IMPLEMENT (Code)** - Write the C++ DSP and UI code
5. **SHIP (Package)** - Build installers and distribute

### Can I skip phases?

No. APC enforces phase completion to ensure quality. Each phase validates prerequisites before proceeding.

### How do I check my progress?

```
/status MyPlugin
```

This shows:
- Current phase
- Completed validation items
- What's next

### Can I resume a partially completed plugin?

Yes:
```
/resume MyPlugin
```

This continues from the last completed phase.

### What if I want to change something in a completed phase?

You can manually update files in any phase, then update the state:
```powershell
. .\scripts\state-management.ps1
Update-PluginState -PluginPath "plugins\MyPlugin" -Updates @{
    "current_phase" = "design_complete"
}
```

---

## UI Framework Questions

### Should I choose Visage or WebView?

| Factor | Visage | WebView |
|--------|--------|---------|
| Complexity 1-2 | ✅ Recommended | ⚠️ Overkill |
| Complexity 3-5 | ⚠️ Possible | ✅ Recommended |
| Performance | ✅ Best | ⚠️ Good |
| Visual Richness | ⚠️ Limited | ✅ Excellent |
| Iteration Speed | ⚠️ Slow | ✅ Fast |
| Memory Usage | ✅ Low | ⚠️ ~100MB extra |

### Can I switch frameworks after choosing?

Yes, but it requires regenerating the UI code. It's best to decide during the planning phase.

### Why does my WebView plugin crash?

Most common causes:
1. **Wrong member order** - Must be: Relays → WebView → Attachments
2. **Missing attachments** - Create attachments BEFORE addAndMakeVisible
3. **Resource provider issues** - Files not embedded correctly

Run validation:
```powershell
.\scripts\validate-webview-member-order.ps1 -PluginName MyPlugin
.\scripts\validate-webview-setup.ps1 -PluginName MyPlugin
```

---

## Build Questions

### How do I build my plugin?

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName MyPlugin
```

### Do I need to run CMake manually?

No. Always use the build script. Never run cmake/msbuild directly.

### Where are the build outputs?

```
build/plugins/MyPlugin/MyPlugin_artefacts/Release/
├── MyPlugin.vst3/          # VST3 plugin
└── MyPlugin.exe            # Standalone
```

### Why is my VST3 not showing in my DAW?

1. Check if installed:
   ```
   C:\Program Files\Common Files\VST3\MyPlugin.vst3
   ```

2. Force DAW to rescan plugins

3. Check if plugin validates:
   ```powershell
   .\scripts\pluginval-integration.ps1 -PluginName MyPlugin
   ```

### Can I build for macOS/Linux from Windows?

Yes, using GitHub Actions:
```
/ship MyPlugin
```

Select macOS and Linux platforms. The workflow will build them remotely.

---

## Shipping Questions

### How do I create an installer?

```
/ship MyPlugin
```

This creates:
- Windows installer (local)
- macOS package (via GitHub Actions)
- Linux package (via GitHub Actions)

### What do I need for shipping?

1. Complete implementation (`code_complete` status)
2. All tests passing
3. Local build successful
4. Inno Setup installed (for Windows installer)

### Can I ship without GitHub Actions?

Yes, but you'll only get the Windows installer. macOS and Linux require GitHub Actions (or building on those platforms).

### How do I version my plugin?

Update in `status.json`:
```json
{
  "version": "v1.0.0"
}
```

Or let the `/ship` command handle it.

---

## Troubleshooting

### Where are error logs?

- **Build errors:** Console output from build script
- **Plugin crashes:** Documents/APC_CRASH_REPORT.txt
- **State errors:** `plugins/MyPlugin/status.json` → `error_recovery.error_log`

### How do I debug a crash?

1. Check known issues:
   ```powershell
   Get-Content .kilocode/troubleshooting/known-issues.yaml | Select-String "error"
   ```

2. Run validation:
   ```powershell
   .\scripts\validate-plugin-status.ps1 -PluginName MyPlugin
   ```

3. Use debug command:
   ```
   /debug MyPlugin
   ```

### How do I roll back to a previous state?

```powershell
. .\scripts\state-management.ps1
Restore-PluginState -PluginPath "plugins\MyPlugin"
```

Or use git:
```powershell
git checkout -- plugins/MyPlugin/
```

### What if the AI makes a mistake?

1. Use `/debug MyPlugin` to analyze
2. Manually fix the files
3. Update state if needed
4. Continue with `/resume MyPlugin`

---

## AI Agent Questions

### Which AI agents work with APC?

**Tested:**
- ✅ Claude Code (Anthropic)
- ✅ Antigravity (Google)
- ✅ Kilo (kilo.ai)

**May work:**
- Cursor
- Other LLM coding agents

### Do I need a specific AI agent?

No. APC is agent-agnostic. Any agent that supports:
- File system access
- PowerShell execution
- Workflow/slash commands

### How does the AI know what to do?

APC provides:
- **Workflows** - Step-by-step phase instructions
- **Skills** - Domain knowledge (DSP, UI, etc.)
- **State Management** - Tracks progress
- **Rules** - Constraints and best practices

### Can I use APC without an AI agent?

Yes, but it's designed for AI assistance. You can manually:
1. Read the skill files in `.kilocode/skills/`
2. Follow the instructions
3. Run the scripts yourself

---

## Development Questions

### Can I modify generated code?

Yes. The code is yours to modify. APC provides a starting point.

### How do I add custom DSP?

Edit `PluginProcessor.cpp`:
```cpp
void processBlock(AudioBuffer<float>& buffer, MidiBuffer& midi) {
    // Your custom DSP here
}
```

### How do I add more parameters?

1. Edit `.ideas/parameter-spec.md`
2. Update `PluginProcessor.cpp` (APVTS)
3. Update `PluginEditor.cpp` (UI binding)
4. Update `status.json` if needed

### Can I use external libraries?

Yes. Add to your plugin's CMakeLists.txt:
```cmake
find_package(ExternalLib REQUIRED)
target_link_libraries(MyPlugin PRIVATE ExternalLib)
```

---

## Contributing Questions

### How can I contribute?

See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.

**Ways to help:**
- Add new skills
- Test on different platforms
- Report bugs
- Improve documentation
- Share your plugins

### How do I report a bug?

1. Check if it's a [known issue](.kilocode/troubleshooting/known-issues.yaml)
2. Create an issue on GitHub
3. Include:
   - Error message
   - Current phase
   - Steps to reproduce
   - Platform/DAW info

### Can I add my own skills?

Yes! Create a new directory in `.kilocode/skills/`:
```
skill_myskill/
└── SKILL.md
```

Follow the existing skill format.

---

## Licensing Questions

### What license is APC under?

MIT License - see [LICENSE](../LICENCE.md)

### Can I sell plugins made with APC?

Yes. Plugins you create are yours. APC is a tool, like a compiler.

### Do I need to credit APC?

No, but it's appreciated. You can mention "Built with Audio Plugin Coder" if you'd like.

---

## Still Have Questions?

- Check the [documentation index](README.md)
- Review [troubleshooting guide](troubleshooting-guide.md)
- Search [known issues](.kilocode/troubleshooting/known-issues.yaml)
- Create an issue on GitHub
- Join the community discussions

---

## Quick Command Reference

| Task | Command |
|------|---------|
| Create new plugin | `/dream MyPlugin` |
| Check progress | `/status MyPlugin` |
| Continue working | `/resume MyPlugin` |
| Build plugin | `powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName MyPlugin` |
| Validate setup | `.\scripts\validate-plugin-status.ps1 -PluginName MyPlugin` |
| Ship plugin | `/ship MyPlugin` |
| Debug issues | `/debug MyPlugin` |