# APC Release Artifacts

Packaged installers, zips, and signed builds from `/apc-ship` land here by default.

Override this location in `apc.config.json`:

```json
{
  "paths": {
    "release_dir": "release"
  }
}
```

Suggested layout after shipping a plugin:

```text
release/
└── <PluginName>/
    ├── <PluginName>-windows-vst3.zip
    ├── <PluginName>-Installer.exe
    └── …
```

This folder is separate from CMake `build/` so a clean rebuild does not wipe packaging outputs.
