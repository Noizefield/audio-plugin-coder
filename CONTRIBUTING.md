# Contributing to Audio Plugin Coder

## ⚠️ Beta Version Disclaimer

**Audio Plugin Coder (APC) is currently in beta development.** This means the project is not yet fully released or stable. Features may be incomplete, APIs may change, and there may be bugs. Use at your own risk in development environments only.

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

### Issues and Discussions

- Use issues for bugs and feature requests.
- Use discussions for questions and general topics.
- Be respectful and constructive.

## Technology Stack

APC uses the following technologies:

- **JUCE 8** - Cross-platform audio plugin framework
- **Visage** - Planned native C++ UI framework (not yet implemented)
- **WebView2** - HTML5 Canvas-based UI framework
- **CMake** - Build system
- **PowerShell** - Automation scripts
- **YAML** - Configuration and knowledge base
- **Markdown** - Documentation and workflows

### Visage Integration (Planned)

Visage is a modern, high-performance UI framework for C++ applications. We plan to integrate Visage as an alternative to WebView for native UI rendering. Currently, Visage is included as a Git submodule but is not yet implemented in the workflow system. Contributions towards Visage integration are welcome once the core system is more stable.

## License

By contributing, you agree that your contributions will be licensed under the same MIT License that covers the project.

## Contact

- **Issues:** [GitHub Issues](https://github.com/Noizefield/audio-plugin-coder/issues)
- **Discussions:** [GitHub Discussions](https://github.com/Noizefield/audio-plugin-coder/discussions)

Thank you for contributing to Audio Plugin Coder! 🎵