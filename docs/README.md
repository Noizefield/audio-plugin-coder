# APC Documentation

Welcome to the comprehensive documentation for Audio Plugin Coder (APC) - the AI-powered framework for building professional audio plugins.

## Quick Start

New to APC? Start here:

1. **[Project Overview](../README.md)** - What is APC and key features
2. **[Plugin Development Lifecycle](plugin-development-lifecycle.md)** - The five-phase workflow
3. **[Command Reference](command-reference.md)** - All available commands
4. **[FAQ](FAQ.md)** - Common questions answered

## Documentation Index

### Getting Started

| Document | Description |
|----------|-------------|
| [Project Structure](PROJECT_STRUCTURE.md) | Complete directory layout and file organization |
| [Plugin Development Lifecycle](plugin-development-lifecycle.md) | Detailed guide to all five phases |
| [Command Reference](command-reference.md) | All slash commands and PowerShell scripts |
| [FAQ](FAQ.md) | Frequently asked questions |

### Core Concepts

| Document | Description |
|----------|-------------|
| [State Management Deep Dive](state-management-deep-dive.md) | How APC tracks and manages project state |
| [Build System](build-system.md) | CMake configuration and build scripts |
| [WebView Framework](webview-framework.md) | Building plugins with HTML/CSS/JS UIs |

### Workflows & Processes

| Document | Description |
|----------|-------------|
| [Ship Workflow](ship-workflow.md) | Packaging and distribution process |
| [GitHub Actions](github-actions.md) | CI/CD for cross-platform builds |
| [Icon Management](icon-management-guide.md) | Adding icons to plugins |
| [Installer Creation](installer-creation.md) | Creating platform installers |

### Troubleshooting & Support

| Document | Description |
|----------|-------------|
| [Troubleshooting Guide](troubleshooting-guide.md) | Common issues and solutions |
| [Known Issues](../.agent/troubleshooting/known-issues.yaml) | Database of known problems |

### Reference

| Document | Location | Description |
|----------|----------|-------------|
| Agent Rules | [.agent/rules/agent.md](../.agent/rules/agent.md) | Critical rules for AI agents |
| File Naming | [.agent/rules/file-naming-conventions.md](../.agent/rules/file-naming-conventions.md) | Naming conventions |
| JUCE Protocols | [.agent/rules/juce-build-protocols.md](../.agent/rules/juce-build-protocols.md) | Build system rules |
| State Guide | [.agent/guides/state-management-guide.md](../.agent/guides/state-management-guide.md) | State management guide |
| WebView Templates | [.agent/templates/webview/](../.agent/templates/webview/) | Starter templates |

## The Five-Phase Workflow

APC uses a structured workflow for plugin development:

```
💭 DREAM → 📋 PLAN → 🎨 DESIGN → 💻 IMPLEMENT → 🚀 SHIP
```

| Phase | Command | Output |
|-------|---------|--------|
| **DREAM** | `/dream MyPlugin` | Concept + Parameters |
| **PLAN** | `/plan MyPlugin` | Architecture + Framework |
| **DESIGN** | `/design MyPlugin` | UI Specifications |
| **IMPLEMENT** | `/impl MyPlugin` | Working Code |
| **SHIP** | `/ship MyPlugin` | Distribution Package |

Learn more: [Plugin Development Lifecycle](plugin-development-lifecycle.md)

## Common Commands

### Slash Commands (AI Agent)

```
/dream MyPlugin      # Start new plugin
/plan MyPlugin       # Define architecture
/design MyPlugin     # Create UI design
/impl MyPlugin       # Implement code
/ship MyPlugin       # Package and distribute
/status MyPlugin     # Check progress
/resume MyPlugin     # Continue development
/test MyPlugin       # Run validation
/debug MyPlugin      # Debug issues
```

### PowerShell Scripts

```powershell
# Build plugin
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName MyPlugin

# Validate setup
.\scripts\validate-plugin-status.ps1 -PluginName MyPlugin

# Check system
.\scripts\system-check.ps1
```

Full reference: [Command Reference](command-reference.md)

## UI Frameworks

APC supports two UI frameworks:

### WebView (HTML/CSS/JS)
- Modern web technologies
- Fast iteration with hot reload
- Rich visualizations
- Best for: Complex UIs, real-time graphics

Learn more: [WebView Framework Guide](webview-framework.md)

### Visage (Pure C++)
- Native C++ UI via Visage frames
- Maximum performance
- Full C++ control
- Best for: Simple UIs, performance-critical plugins

*Note: Visage integration is in active testing and may be unstable on some hosts.*

## Platform Support

| Platform | Local Build | GitHub Actions | Formats |
|----------|-------------|----------------|---------|
| Windows 11 | ✅ Native | ✅ | VST3, Standalone |
| macOS | ❌ | ✅ | VST3, AU, Standalone |
| Linux | ❌ | ✅ | VST3, LV2, Standalone |

## Project Structure

```
audio-plugin-coder/
├── .agent/              # AI agent configuration
│   ├── skills/             # Domain knowledge
│   ├── workflows/          # Slash commands
│   ├── rules/              # System constraints
│   └── troubleshooting/    # Known issues
├── _tools/                 # JUCE, pluginval
├── docs/                   # This documentation
├── plugins/                # Your plugins
├── scripts/                # Build automation
└── build/                  # Build artifacts
```

Learn more: [Project Structure](PROJECT_STRUCTURE.md)

## State Management

Every plugin has a `status.json` file that tracks:
- Current development phase
- UI framework selection
- Validation checkpoints
- Error recovery points

This enables:
- Resume development anytime
- Switch AI agents without losing context
- Automatic prerequisite validation
- Rollback capabilities

Learn more: [State Management Deep Dive](state-management-deep-dive.md)

## Troubleshooting

Having issues? Check these resources:

1. **[Troubleshooting Guide](troubleshooting-guide.md)** - Common problems and solutions
2. **[Known Issues](../.agent/troubleshooting/known-issues.yaml)** - Database of known problems
3. **Validation Scripts:**
   ```powershell
   .\scripts\validate-plugin-status.ps1 -PluginName MyPlugin
   .\scripts\validate-webview-setup.ps1 -PluginName MyPlugin
   ```

## Contributing

Want to improve APC? See [CONTRIBUTING.md](../CONTRIBUTING.md) for:
- Adding new skills
- Reporting bugs
- Improving documentation
- Testing on different platforms

## External Resources

- [JUCE Documentation](https://docs.juce.com/) - Audio plugin framework
- [VST3 SDK](https://developer.steinberg.help/display/VST/VST+3+Home) - Steinberg's VST3 docs
- [WebView2 Documentation](https://docs.microsoft.com/en-us/microsoft-edge/webview2/) - Microsoft's WebView2

## License

APC is licensed under the MIT License. See [LICENSE](../LICENCE.md) for details.

---

**Need help?** Check the [FAQ](FAQ.md) or review the [troubleshooting guide](troubleshooting-guide.md).

