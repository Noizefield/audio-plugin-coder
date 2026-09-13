# Audio Plugin Coder (APC)
![Audio Plugin Coder Logo](https://github.com/Noizefield/audio-plugin-coder/blob/main/assets/APC_Logo.gif)

> AI-powered open-source framework for vibe-coding audio plugins from concept to shipped product

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/github/package-json/v/Noizefield/audio-plugin-coder)](https://github.com/Noizefield/audio-plugin-coder/blob/main/package.json)
[![JUCE](https://img.shields.io/badge/JUCE-9.0-blue.svg)](https://juce.com/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D4.svg)](https://github.com/Noizefield/audio-plugin-coder)
[![HOL Guard Scanner](https://img.shields.io/badge/HOL%20Guard-passing-00a67e)](https://github.com/hashgraph-online/hol-guard)
[![Sponsor](https://img.shields.io/badge/Sponsor-Project-pink.svg?style=social&logo=heart)](https://github.com/sponsors/Noizefield)

## What's new in v1.5.0

- **APC Hub** - a live local dashboard served by a zero-dependency Node server. `/apc-hub` opens one command center for projects, skills, commands, design library, scripts, templates, tools, settings (editable form with backup), a searchable documentation reader, a GitHub update check, and a consistency radar.
- **`bin/apc.js`** - single cross-platform CLI (`apc version|paths|doctor|build|validate|backup|rollback|status|freeze`) with a 23-test suite (`npm test`).
- **`/apc-patch` + `/apc-evolve`** - iterate on shipped plugins: bugfix and feature generations with version-aware state, plus `apc freeze`.
- **Docs-as-truth** - 12 docs rewritten for JUCE 9 interop, relocatable paths, and `/apc-*` names.
- **Framework versioning** - single source of truth in `package.json`; `apc version sync` keeps `hub/version.js` and the CMake pin aligned.
- **Release target is `release/`** - installers and zips honor `paths.release_dir` end-to-end.

Start: clone -> `/apc-setup` (Claude Code / Kilo / Cursor) or `$audio-plugin-coder:audio-plugin-coder setup` (Codex) -> `/apc-dream MyPlugin`.

## APC Hub

The APC Hub gives you a complete, live overview of the framework and your plugins - no build required, read-only by default:

```bash
node hub/server.js --port 4872   # or: /apc-hub in your agent
```

![APC Hub dashboard](assets/apc_hub_screenshot.jpg)

## Video Tutorial Series

A video playlist explains APC in detail - 7 episodes and more to come. The same playlist is embedded as a working player inside the Hub (`/apc-hub`, section 11 VIDEOS); GitHub removes `<iframe>` embeds from READMEs, so the card below opens the video directly on YouTube:

[![APC YouTube tutorial series - click to watch](https://img.youtube.com/vi/tD6T8MEGWm8/hqdefault.jpg)](https://www.youtube.com/watch?v=tD6T8MEGWm8&list=PLEOCbFL_Mq4o)

Open the full playlist: https://www.youtube.com/watch?v=tD6T8MEGWm8&list=PLEOCbFL_Mq4o

## About

**Audio Plugin Coder (APC)** is an AI-first framework that guides LLM agents through the whole plugin lifecycle - ideation, architecture, UI, DSP implementation, testing, and packaging - without the agent re-learning JUCE or your conventions every session. It is agent-agnostic (Codex, Claude Code, Kilo, Cursor, Antigravity) and has been hardened over 18 months of real plugin development.

The core workflow - `setup -> dream -> plan -> design -> impl -> ship` - is ready for production on Windows, macOS, and Linux.

## Key Features

- **LLM-driven development** - works with any coding agent
- **Guided setup** - `/apc-setup` configures toolchain, paths, and model routing via `apc.config.json`
- **Structured workflows** - Dream -> Plan -> Design -> Implement -> Ship, plus test/debug/status/resume/patch/evolve/hub
- **Unique slash commands** - `/apc-*` primary names; short aliases kept as deprecated
- **Dual UI frameworks** - Visage (pure C++) or WebView (HTML/CSS/JS + JUCE WebView)
- **State management** - per-plugin `status.json` with progress, validation, rollback
- **Self-improving** - auto-captured troubleshooting knowledge
- **JUCE 9 + CMake** - relocatable plugins/build/release directories
- **APC Hub** - live local dashboard and future workbench (`/apc-hub`)

## Quick Start

### One-command setup

```bash
npx github:Noizefield/audio-plugin-coder
```

Clones, checks your tools, and prints next steps for your platform. Requires [Node.js 18+](https://nodejs.org) and [Git](https://git-scm.com).

### Manual setup

```powershell
# Windows
git clone --recurse-submodules https://github.com/Noizefield/audio-plugin-coder.git
cd audio-plugin-coder
.\scripts\system-check.ps1 -Human
```

```bash
# macOS / Linux
git clone --recurse-submodules https://github.com/Noizefield/audio-plugin-coder.git
cd audio-plugin-coder
bash scripts/system-check.sh --human
```

Then open the repo in your agent and run `/apc-setup`, then `/apc-dream <PluginName>`.

### Prerequisites

| Platform | Requirements |
|---|---|
| **Windows** | LLM agent, Git, Node.js 18+, Python 3.8+, Visual Studio 2022 C++, CMake 3.22+, WebView2 Runtime, JUCE 9 (submodule), pluginval (submodule) |
| **macOS** | LLM agent, macOS 10.13+, Xcode + CLT, CMake 3.22+, Git, Node.js 18+, Python 3.8+, jq, JUCE 9, pluginval (WKWebView, no WebView2) |
| **Linux** | LLM agent, GCC 9+ / Clang 10+, C++20, CMake 3.22+, Make/Ninja, Node.js 18+, Python 3.8+, WebKitGTK, libegl-dev, ALSA (+JACK), JUCE 9, pluginval |

### Bridge Templates (FFGL & Max/MSP)

For FFGL visual plugins or Max for Live externals, run the Windows one-click setup:

```powershell
.\scripts\setup_bridges.bat
```

## How It Works

### The Five-Phase Workflow

```
SETUP  -> First-run toolchain, paths, model preferences
DREAM  -> Creative brief, parameter spec
PLAN   -> Architecture, UI framework, complexity
DESIGN -> GUI mockups and visual design
IMPL   -> DSP engine and UI integration
SHIP   -> Installers, DAW testing, distribution
```

### Agent Commands

Prefer the `/apc-*` names (unique across frameworks). Short aliases (`/dream`, ...) still work as deprecated. Codex invokes actions through the `audio-plugin-coder` skill (bare `/plan`/`/status` are Codex built-ins).

| Primary | Codex | Description |
|---|---|---|
| `/apc-setup` | `... setup` | First-run toolchain, paths, models |
| `/apc-dream [Name]` | `... dream [Name]` | Start new plugin (ideation) |
| `/apc-plan [Name]` | `... plan [Name]` | Architecture + UI framework |
| `/apc-design [Name]` | `... design [Name]` | GUI mockups and visual design |
| `/apc-impl [Name]` | `... impl [Name]` | Implement DSP and UI |
| `/apc-test [Name]` | `... test [Name]` | Run tests / validation |
| `/apc-debug [Name]` | `... debug [Name]` | Diagnose and fix issues |
| `/apc-ship [Name]` | `... ship [Name]` | Package and distribute |
| `/apc-status [Name]` | `... status [Name]` | Progress and state |
| `/apc-resume [Name]` | `... resume [Name]` | Continue from last incomplete phase |
| `/apc-new [Name]` | `... new [Name]` | Full workflow with confirmations |
| `/apc-patch [Name]` | `... patch [Name]` | Bugfix generation on a shipped plugin |
| `/apc-evolve [Name]` | `... evolve [Name]` | Feature generation on a shipped plugin |
| `/apc-hub` | `... hub` | Open the live local dashboard |

See [Command Reference](docs/command-reference.md), [Codex Compatibility](docs/codex-compatibility.md), and [Model Routing](docs/model-routing.md).

### Example Session

```
You: /apc-setup
AI: ✅ Setup complete. Next: /apc-dream <PluginName>

You: /apc-dream TapeDelay / "Warm analog tape delay with wow/flutter"
AI: ✅ Dream phase complete! Files created: .ideas/creative-brief.md, .ideas/parameter-spec.md, status.json

You: /apc-design TapeDelay / "Teal dashboard, skeumorphic knobs"
AI: ✅ Design complete! Next: /apc-impl TapeDelay
```

## Architecture

APC tracks every plugin in a `status.json` (phase, validation, rollback). That lets you pause, switch agents, or rebuild state at any time.

```
audio-plugin-coder/
├── AGENTS.md                    # Agent guidance (AGENTS.md standard)
├── .agents/                     # Canonical source: workflows/, skills/, rules/, guides/, troubleshooting/
├── .codex-plugin/               # Codex plugin manifest
├── skills/                      # Packaged Codex skill (points at .agents/)
├── hub/                         # APC Hub - server.js, ui/, _design/
├── templates/                   # Plugin templates (visage, webview, ffgl, max-external)
├── docs/                        # Documentation (16 files)
├── scripts/                     # Build / state / validation automation (ps1 + sh)
├── bin/                         # setup.js, apc.js CLI
├── common/                      # Shared helpers (e.g. VisageJuceHost.h)
├── plugins/                     # Your plugins (config-relocatable)
├── build/                       # Compilation artifacts
├── release/                     # Ship packages (installers, zips)
└── test/                        # apc.js test suite (npm test)
```

Workflows orchestrate skills: `/apc-design` reads your UI framework from `status.json`, then loads the matching design skill. Troubleshooting auto-captures issues so the system improves over time.

## UI Framework Options

- **Visage (pure C++) - experimental** - Native frames, high performance, full C++ control.
- **WebView (HTML/CSS/JS)** - Modern web tech, hot reload, rich visualization.

The AI recommends a framework during planning based on your plugin's complexity.

## Supported Plugin Formats

| Format | Windows | macOS | Linux |
|---|---|---|---|
| VST3 | ✅ | ✅ | ✅ |
| Standalone | ✅ | ✅ | ✅ |
| AU | ❌ | ✅ | ❌ |
| LV2 | ❌ | ❌ | ✅ |

*CLAP support is planned.*

## Technology Stack

JUCE 9, CMake, PowerShell/Bash, WebView2 / WKWebView, YAML knowledge base, Node.js (CLI + Hub).

## Documentation

Docs live in [`docs/`](docs/): [Getting Started](docs/README.md), [Plugin Development Lifecycle](docs/plugin-development-lifecycle.md), [Command Reference](docs/command-reference.md), [Hub](docs/hub.md), [FAQ](docs/FAQ.md), [Troubleshooting](docs/troubleshooting-guide.md). The Hub serves them as a searchable reader.

## Roadmap

- [x] Windows / macOS / Linux local builds
- [x] GitHub Actions CI/CD, docs-as-truth, `apc` CLI, APC Hub
- [x] Visage + WebView UIs, FFGL + Max/MSP bridge templates
- [ ] CLAP format support
- [ ] Preset management, plugin marketplace, real-time collaboration

## Contributing & Community

Join [GitHub Discussions](https://github.com/Noizefield/audio-plugin-coder/discussions); see [CONTRIBUTING.md](CONTRIBUTING.md).

## Sponsor

Independent development with significant API costs. If APC saves you time, consider [sponsoring](https://github.com/sponsors/Noizefield) - it covers API costs and accelerates new features.

## Acknowledgments

- **JUCE Team** - the industry-standard framework
- **The AI community** - specifically the meta-prompting pioneers
- **Matt Tytel** - the Visage library (https://github.com/VitalAudio/visage)
- **[12Matt3r](https://github.com/12Matt3r)** - FFGL and Max/MSP bridge templates
- **[vjcharles](https://github.com/vjcharles)** - macOS support and security hardening (PR #6)

## License

MIT - see [LICENSE.md](LICENSE.md). Note: APC itself is MIT, but plugins built with it inherit JUCE's dual license (AGPLv3 free, or a [JUCE commercial license](https://juce.com/pricing/) for closed-source). [JUCE terms](https://juce.com/legal/juce-licence/).

---

*Built with a lot of tokens for the audio development community. Turn your plugin ideas into reality.*