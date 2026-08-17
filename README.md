# Audio Plugin Coder (APC)
![Audio Plugin Coder Logo](https://github.com/Noizefield/audio-plugin-coder/blob/main/assets/APC_Logo.gif)

> AI-powered open-source framework for vibe-coding audio plugins from concept to shipped product

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![JUCE](https://img.shields.io/badge/JUCE-9.0-blue.svg)](https://juce.com/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D4.svg)](https://github.com/Noizefield/audio-plugin-coder)
[![Sponsor](https://img.shields.io/badge/Sponsor-Project-pink.svg?style=social&logo=heart)](https://github.com/sponsors/Noizefield)

## What's new

- **JUCE 9** — framework pin upgraded to **9.0.1**, including the official `@juce-framework/webview` / TypeScript WebView interop path
- **`/apc-setup`** — guided first-run wizard for toolchain checks, relocatable `plugins` / `build` / `release` folders, UI defaults, and per-phase AI model preferences
- **`/apc-*` commands** — unique slash names (`/apc-dream`, `/apc-plan`, …) to avoid collisions; short forms like `/dream` remain as deprecated aliases
- **Cross-platform** — Windows, macOS, and Linux (Linux needs WebKitGTK + EGL for JUCE 9)

Start here: clone → `/apc-setup` → `/apc-dream <PluginName>`.

## About Audio Plugin Coder

**Audio Plugin Coder (APC)** is the result of a long-standing personal obsession: building creative tools, writing music, and ultimately creating professional audio plugins.

While developing software instruments and effects has always been a dream, building real-world VSTs (with robust DSP, UI, state handling, and packaging) is notoriously complex. Over time, and especially with the rapid advancement of AI-assisted development, that barrier has finally crumbled.

Over the past 18 months, APC has been continuously designed, tested, and re-iterated as a practical **AI-first framework** for building audio plugins. This involved thousands of hours of experimentation, trial-and-error, and yes... occasionally yelling at LLMs to finally render the UI correctly.

APC is designed to be **Agent Agnostic**. Whether you use Codex, Google's Antigravity, Kilo, Claude Code, or Cursor, APC provides the structure they need to succeed.

APC is under active improvement — expect iteration — but the core workflow (setup → dream → plan → design → impl → ship) is ready for real plugin development on Windows, macOS, and Linux.

## What is Audio Plugin Coder?

**Audio Plugin Coder (APC)** is a structured, AI-driven workflow system that guides LLM agents through the entire audio plugin development lifecycle.

It enables the creation of VST3 / AU / CLAP plugins using natural language, predefined workflows, and domain-specific skills- without constantly re-explaining context, architecture, or best practices to the AI.

Instead of manually juggling DSP architecture, UI frameworks, build systems, state tracking, and packaging, APC provides a unified framework where AI agents can operate with **long-term context, validation, and self-improving knowledge.**

## ✨ Key Features

- 🤖 **LLM-Driven Development** - Designed to work with Codex, Antigravity, Kilo, Claude Code, Cursor, or any coding agent.
- 🧭 **Guided Setup** - `/apc-setup` configures toolchain, paths, and model routing via `apc.config.json`.
- 🎯 **Structured Workflows** - Dream → Plan → Design → Implement → Ship (plus test/debug/status/resume).
- 🏷️ **Unique slash commands** - `/apc-*` primary names; short aliases kept for compatibility.
- 🎨 **Dual UI Frameworks** - Choose Visage (pure C++) or WebView (HTML/CSS/JS + JUCE WebView).
- 📊 **State Management** - Automatic progress tracking, validation, and rollback capabilities.
- 🔧 **Self-Improving** - Auto-capture troubleshooting knowledge; the system gets smarter over time.
- 🏗️ **JUCE 9 + CMake** - Modern plugin stack with relocatable plugins/build/release directories.
- 📚 **Comprehensive Skills** - Pre-built domain knowledge for DSP, UI design, testing, and packaging.
- 🎬 **Bridge Templates** - FFGL visual plugins and Max/MSP externals support.

## 🚀 Quick Start

### One-command setup

The fastest way to get started — paste this into any terminal:

```bash
npx github:Noizefield/audio-plugin-coder
```

This will clone the repo, check your tools, and print exactly what to do next for your platform (Windows, macOS, or Linux). Requires [Node.js 18+](https://nodejs.org) and [Git](https://git-scm.com).

> Always pulls the latest version directly from GitHub — no install, no package manager.

---

### Manual setup

If you prefer to clone manually:

**Windows:**
```powershell
git clone --recurse-submodules https://github.com/Noizefield/audio-plugin-coder.git
cd audio-plugin-coder
.\scripts\system-check.ps1 -Human
```

**macOS / Linux:**
```bash
git clone --recurse-submodules https://github.com/Noizefield/audio-plugin-coder.git
cd audio-plugin-coder
bash scripts/system-check.sh --human
```

Then open the repo in your AI agent and run:

1. **`/apc-setup`** — configure paths, models, verify JUCE 9
2. **`/apc-dream <PluginName>`** — create your first plugin

### Prerequisites

**Windows**
- An LLM coding agent (Claude Code, Antigravity, Kilo, Codex, Cursor)
- Git · Node.js (≥18) · Python (≥3.8) · Visual Studio 2022 C++ · CMake (≥3.22) · WebView2 Runtime · JUCE (≥9, via submodule) · pluginval (submodule)

**macOS**
- An LLM coding agent (Claude Code, Antigravity, Kilo, Codex, Cursor)
- macOS 10.13+ · Xcode + Command Line Tools · CMake (≥3.22) · Git (submodules) · Node.js (≥18) · Python (≥3.8) · jq · JUCE (≥9, via submodule) · pluginval (submodule)
- WebView uses system **WKWebView** (no separate WebView2 install)

**Linux**
- An LLM coding agent (Claude Code, Antigravity, Kilo, Codex, Cursor)
- GCC 9+ or Clang 10+ with **C++20** · CMake (≥3.22) · Git (submodules) · make or ninja · Node.js (≥18) · Python (≥3.8) · jq recommended
- **WebKitGTK** (WebView) · **libegl-dev** / EGL (JUCE 9 OpenGL) · JUCE (≥9, via submodule) · pluginval (submodule)
- ALSA (and optionally JACK) for Standalone audio

### Bridge Templates (FFGL & Max/MSP)

If you are specifically interested in building **FFGL Visual Plugins** or **Max for Live Externals**, use the included One-Click Setup script for Windows:

```powershell
.\scripts\setup_bridges.bat
```

This script will:
1.  Check for CMake and Git.
2.  Automatically download JUCE 9 (if missing).
3.  Configure the Visual Studio solution for your chosen bridge.
4.  Open the project ready for compilation.

### Initialize your LLM agent

For **Kilo** / **Claude Code**: workflows are discovered from `.claude/workflows/` (mirrored under `.agent/` / `.kilocode/`).

For **Codex**:
```text
# AGENTS.md and the repo-local skill are discovered automatically
$audio-plugin-coder:audio-plugin-coder setup
$audio-plugin-coder:audio-plugin-coder dream MyReverb
```

For **Claude Code / Kilo / Cursor**:
```
/apc-setup
/apc-dream MyReverb
```

The AI will guide you through the entire process!

## 📖 How It Works

### The Five-Phase Workflow

```
🧭 SETUP (first run)
   ↓ Toolchain, paths, model preferences

💭 DREAM (Ideation)
   ↓ Create creative brief, define parameters

📋 PLAN (Architecture)
   ↓ Design DSP graph, select UI framework

🎨 DESIGN (GUI)
   ↓ Create mockups, iterate on visual design

💻 IMPLEMENT (Code)
   ↓ Build DSP engine, integrate UI

🚀 SHIP (Package)
   ↓ Build installers, test in DAWs
```

### Agent Commands

Prefer the **`/apc-*`** names (unique across frameworks). Short forms (`/dream`, `/plan`, …) still work as deprecated aliases.

Codex uses the `audio-plugin-coder` skill because `/plan` and `/status` are built-in Codex commands.

| Primary (Claude Code / Kilo / Cursor) | Codex | Description |
|---|---|---|
| `/apc-setup` | `$audio-plugin-coder:audio-plugin-coder setup` | First-run toolchain, paths, models |
| `/apc-dream [Name]` | `$audio-plugin-coder:audio-plugin-coder dream [Name]` | Start new plugin (ideation) |
| `/apc-plan [Name]` | `$audio-plugin-coder:audio-plugin-coder plan [Name]` | Architecture + UI framework |
| `/apc-design [Name]` | `$audio-plugin-coder:audio-plugin-coder design [Name]` | GUI mockups and visual design |
| `/apc-impl [Name]` | `$audio-plugin-coder:audio-plugin-coder impl [Name]` | Implement DSP and UI |
| `/apc-test [Name]` | `$audio-plugin-coder:audio-plugin-coder test [Name]` | Run tests / validation |
| `/apc-debug [Name]` | `$audio-plugin-coder:audio-plugin-coder debug [Name]` | Diagnose and fix issues |
| `/apc-ship [Name]` | `$audio-plugin-coder:audio-plugin-coder ship [Name]` | Package and distribute |
| `/apc-status [Name]` | `$audio-plugin-coder:audio-plugin-coder status [Name]` | Progress and state |
| `/apc-resume [Name]` | `$audio-plugin-coder:audio-plugin-coder resume [Name]` | Continue from last incomplete phase |
| `/apc-new [Name]` | `$audio-plugin-coder:audio-plugin-coder new [Name]` | Full workflow with confirmations |

See [Command Reference](docs/command-reference.md), [Codex Compatibility](docs/codex-compatibility.md), and [Model Routing](docs/model-routing.md).

### Example Session

```
You: /apc-setup

AI: Let's configure APC (paths, models, JUCE check)...
    ✅ Setup complete. Next: /apc-dream <PluginName>

You: /apc-dream TapeDelay

AI: Great! Let's define your plugin concept.

    What is the sonic character?
    (e.g., "Warm analog tape delay with wow/flutter")

You: Vintage tape echo with analog saturation

AI: Perfect! What are the top 3-5 parameters you want?

You: Delay time, feedback, wow/flutter amount, saturation, mix

AI: ✅ Dream phase complete!

    Files created:
    - plugins/TapeDelay/.ideas/creative-brief.md
    - plugins/TapeDelay/.ideas/parameter-spec.md
    - plugins/TapeDelay/status.json

    Next step: /apc-plan TapeDelay
```

## 🏗️ Architecture & Self-Correction

APC uses a unique State Management system (status.json) to track development across phases. This allows you to pause, switch agents, or restart specific phases without losing context.

### Directory Structure

```
audio-plugin-coder/
├── AGENTS.md                     # Agent guidance (AGENTS.md standard)
├── .agents/skills/               # Codex repo-local skill discovery
├── .codex-plugin/plugin.json     # Codex plugin manifest
├── skills/                       # Packaged Codex skill
├── .[Agent]/                    # AI agent configuration
│   ├── workflows/               # Slash command orchestrators
│   │   ├── dream.md
│   │   ├── plan.md
│   │   ├── design.md
│   │   ├── impl.md
│   │   └── ship.md
│   ├── skills/                  # Domain knowledge modules
│   │   ├── skill_ideation/
│   │   ├── skill_planning/
│   │   ├── skill_design/
│   │   ├── skill_implementation/
│   │   └── skill_packaging/
│   ├── guides/                  # Reference documentation
│   │   └── state-management-guide.md
│   ├── rules/                   # System constraints
│   │   ├── agent.md
│   │   └── file-naming-conventions.md
│   └── troubleshooting/         # Auto-captured issues
│       ├── known-issues.yaml
│       └── resolutions/
├── templates/                   # Plugin templates (consolidated)
│   ├── visage/                  # Visage (C++) UI templates
│   ├── webview/                 # WebView (HTML5) UI templates
│   ├── ffgl/                    # FFGL visual plugin templates
│   ├── max-external/            # Max/MSP external templates
│   └── status-template.json     # Plugin state template
├── docs/                        # Comprehensive documentation
├── plugins/                     # Generated plugins
│   └── [YourPlugin]/
│       ├── .ideas/              # Specs and planning
│       ├── Design/              # UI mockups
│       ├── Source/              # C++ code
│       └── status.json          # State tracking
├── scripts/                     # Build automation
│   ├── build-and-install.ps1    # Windows build script
│   ├── build-and-install.sh     # macOS build script
│   ├── state-management.ps1     # Windows state management
│   ├── state-management.sh      # macOS state management
│   └── installer/               # Platform-specific installers
├── build/                       # Compilation artifacts
└── release/                     # Ship packages (installers, zips)
```

### How Skills Work

**Skills** contain domain knowledge (the "how"):
- Step-by-step instructions
- Best practices
- Framework-specific guidance
- Code generation patterns

**Workflows** orchestrate skills (the "when"):
- Prerequisites validation
- Phase transitions
- State management
- Error recovery

**Example:** The `/design` workflow checks your UI framework selection (Visage or WebView) from `status.json`, then loads the appropriate design skill automatically.

## 🎨 UI Framework Options

### Visage (Pure C++) - Experimental
- Native C++ UI via Visage frames
- High performance, low overhead
- Full C++ control
- Custom rendering with `visage::Frame`

*Note: Visage integration is in active testing and may be unstable on some hosts.*

### WebView (HTML5 Canvas)
- Modern web technologies
- Rapid iteration with hot reload
- Rich component libraries
- Canvas-based rendering for performance

The AI helps you choose based on your plugin's complexity and requirements during the planning phase.

## 🔧 State Management

Every plugin has a `status.json` file tracking:
- Current development phase
- UI framework selection
- Completed milestones
- Validation checkpoints
- Error recovery points

**Benefits:**
- Resume development any time
- Validate prerequisites automatically
- Rollback on errors
- Track project history

## 🧠 Self-Improving Troubleshooting

APC includes an **auto-capture system** that learns from problems:

1. **AI encounters error** → Searches known issues database
2. **If known** → Applies documented solution immediately
3. **If unknown** → Attempts resolution, tracks attempts
4. **After 3 attempts** → Auto-creates issue entry
5. **When solved** → Documents solution for future use

**Location:** `.agent/troubleshooting/`

**Result:** The system gets smarter with every issue encountered!

## 🤝 Compatible AI Agents

APC works with any LLM-based coding agent that supports:
- Custom workflows, skills, or reusable instructions
- File system access
- Shell execution (PowerShell on Windows, Bash on macOS/Linux)

**Supported:**
- ✅ Codex CLI / IDE (repo skill and `AGENTS.md`)
- ✅ Claude Code (Anthropic)
- ✅ Kilo (kilo.ai)
- [ ] Cursor
- [ ] Others welcome!

## 🛠️ Technology Stack

- **JUCE 9** - Audio plugin framework (includes DSP, GUI, etc.)
- **CMake** - Build system (Visual Studio on Windows, Xcode on macOS)
- **PowerShell / Bash** - Automation scripting (platform-specific)
- **WebView2 / WKWebView** - Web UI (Windows / macOS)
- **YAML** - Knowledge base format
- **Markdown** - Documentation and workflows

## 📋 Supported Plugin Formats

| Format | Windows | macOS | Linux |
|--------|---------|-------|-------|
| VST3 | ✅ | ✅ | ✅ |
| Standalone | ✅ | ✅ | ✅ |
| AU | ❌ | ✅ | ❌ |
| LV2 | ❌ | ❌ | ✅ |

*CLAP support planned for future release.*

## 📚 Documentation

Comprehensive documentation is available in the [`docs/`](docs/) directory:

- **[Getting Started](docs/README.md)** - Documentation index and quick start
- **[Plugin Development Lifecycle](docs/plugin-development-lifecycle.md)** - Detailed phase guide
- **[Command Reference](docs/command-reference.md)** - All commands and scripts
- **[FAQ](docs/FAQ.md)** - Frequently asked questions
- **[Troubleshooting](docs/troubleshooting-guide.md)** - Common issues and solutions

## 🔮 Roadmap

- [x] Windows support
- [x] GitHub Actions CI/CD
- [x] Comprehensive documentation
- [x] macOS local build support
- [x] Linux local build support
- [x] visage (GUI) support (https://github.com/VitalAudio/visage)
- [x] FFGL bridge templates (VJ plugins for Resolume, VDMX, etc.)
- [x] Max/MSP external templates
- [ ] CLAP format support
- [ ] Preset management system
- [ ] Plugin marketplace integration
- [ ] Real-time collaboration features

## 💖 Sponsor the Project

I am an independent developer pouring hundreds of hours (and significant API costs) into this project.

Developing a framework that works across different AI agents means constantly testing against paid tiers of Claude, Gemini, and others. I often run out of "Plan" usage just testing a single workflow improvement.

If APC saves you time, helps you learn JUCE, or helps you ship a plugin, please consider supporting the development. It helps cover API costs and accelerates new features!

    ☕ Buy Me a Coffee / Sponsor on GitHub

    Crypto/Other options TBD

## 🤝 Contributing & Community

Contributions are welcome! Join our [GitHub Discussions](https://github.com/Noizefield/audio-plugin-coder/discussions) to connect with the community.

- **Add Skills:** Create new domain knowledge modules
- **Test Platforms:** Verify compatibility with different AI agents
- **Improve Docs:** Help us improve documentation
- **Share Plugins:** Showcase what you've built

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.



## 🙏 Acknowledgments

- **JUCE Team** - For the industry-standard framework.
- **The AI Community** - Specifically the meta-prompting pioneers.
- **Matt Tytel** - For the outstandingly good Visage library (https://github.com/VitalAudio/visage)
- **[12Matt3r](https://github.com/12Matt3r)** - FFGL and Max/MSP bridge templates contribution.
- **[vjcharles](https://github.com/vjcharles)** - macOS support and security hardening (PR #6).


## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENCE.md) file for details.

### ⚠️ Important: JUCE Licensing Notice

APC uses **JUCE 9** as its audio plugin framework. JUCE is dual-licensed:

| License | Use Case | Requirements |
|---------|----------|--------------|
| **AGPLv3** | Open-source projects | Your plugin must be open-sourced under AGPLv3 |
| **JUCE Commercial** | Closed-source/commercial | Requires purchasing a JUCE license |

**Key Points:**
- APC itself is MIT-licensed (permissive)
- Plugins built with APC inherit JUCE's licensing requirements
- If you sell your plugin or keep it closed-source, you need a [JUCE commercial license](https://juce.com/pricing/)
- If you open-source your plugin under AGPLv3, you can use JUCE for free

**Official JUCE Resources:**
- [JUCE End User Licence Agreement](https://juce.com/legal/juce-8-licence/)
- [JUCE Pricing](https://juce.com/pricing/)
- [JUCE Privacy Policy](https://juce.com/legal/juce-privacy-policy/)

**You are responsible for ensuring your use of JUCE complies with their licensing terms.**

---

**Built with ❤️ (and a lot of tokens) for the audio development community.**

*Turn your plugin ideas into reality with the power of AI*
