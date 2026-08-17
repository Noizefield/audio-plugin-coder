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
├── LICENSE.txt
├── <PluginName>-<version>-Windows-Setup.exe
├── <PluginName>_v<version>/
├── <PluginName>_v<version>.zip
└── github-artifacts/          # optional CI downloads
```

This folder is separate from CMake `build/` so a clean rebuild does not wipe packaging outputs. Do not use `dist/` — that path is retired.
