# Contributing to Audio Plugin Coder

## Project status

APC is under active improvement — expect iteration — but the core workflow
(setup → dream → plan → design → impl → ship) is ready for real plugin
development on Windows, macOS, and Linux. See [README.md](README.md) and
[`docs/`](docs/) for the current state.

## How to Contribute

We welcome contributions from the community! Whether you're fixing bugs, adding features, improving documentation, or sharing ideas, your help is appreciated.

### Ways to Contribute

1. **Report Issues** - Found a bug? [Open an issue](https://github.com/Noizefield/audio-plugin-coder/issues) with details.
2. **Suggest Features** - Have an idea? [Start a discussion](https://github.com/Noizefield/audio-plugin-coder/discussions).
3. **Submit Pull Requests** - Fix bugs or add features.
4. **Improve Documentation** - Help make APC easier to use.
5. **Test and Provide Feedback** - Try APC and share your experience.

### Development Setup

1. Clone the repository with submodules:
   ```bash
   git clone --recursive https://github.com/Noizefield/audio-plugin-coder.git
   cd audio-plugin-coder
   ```

2. Run the one-command setup (or open the repo in your AI agent and run `/apc-setup`):
   ```powershell
   npx github:Noizefield/audio-plugin-coder
   ```

3. Follow the [README](README.md) for usage instructions.

## Guidelines

### Code Style

- Follow the existing code style in the project.
- Use meaningful variable and function names.
- Add comments for complex logic.
- Keep commits focused and descriptive.

### Pull Requests

- Create a feature branch from `main`.
- Ensure your code passes any existing tests.
- Update documentation if needed.
- Provide a clear description of changes.

### Docs-as-truth (prevent drift)

APC treats docs as source of truth. When you change behavior, update the
matching docs in the same PR:

- Version/platform/format claims → `README.md`, `docs/README.md`, `docs/FAQ.md`
- Commands → `docs/command-reference.md` (primary `/apc-*` names; short forms
  are deprecated aliases), `docs/plugin-development-lifecycle.md`
- Build/paths → `docs/build-system.md`, `docs/PROJECT_STRUCTURE.md`
  (resolve via `apc.config.json` paths, never hardcode `./plugins`)
- Troubleshooting paths → `.agents/troubleshooting/` (canonical; not `.agent/`)

### Issues and Discussions

- Use issues for bugs and feature requests.
- Use discussions for questions and general topics.
- Be respectful and constructive.

## Technology Stack

APC uses the following technologies:

- **JUCE 9** (pin 9.0.1, see `apc.config.json`) - Cross-platform audio plugin framework
- **Visage** - Native C++ UI framework option (experimental; may be unstable on some hosts)
- **WebView2 / WKWebView / WebKitGTK** - HTML5 UI framework (Windows / macOS / Linux)
- **CMake (≥3.22)** - Build system
- **PowerShell / Bash** - Automation scripts (platform-specific; never mix shells)
- **YAML** - Configuration and knowledge base
- **Markdown** - Documentation and workflows

### Visage Integration

Visage is a modern, high-performance UI framework for C++ applications,
available in APC as the native-UI alternative to WebView
(`templates/visage/`, `APC_ENABLE_VISAGE` CMake option, validation via
`scripts/validate-visage-setup.ps1`). Integration is experimental and under
active testing — contributions stabilizing it are welcome.

## License

By contributing, you agree that your contributions will be licensed under the same MIT License that covers the project.

## Contact

- **Issues:** [GitHub Issues](https://github.com/Noizefield/audio-plugin-coder/issues)
- **Discussions:** [GitHub Discussions](https://github.com/Noizefield/audio-plugin-coder/discussions)

Thank you for contributing to Audio Plugin Coder! 🎵