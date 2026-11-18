# Open Design MCP (optional)

`OpenDesign` ([nexu-io/open-design](https://github.com/nexu-io/open-design), Apache-2.0) is a
local-first design-agent workspace. It ships a **stdio MCP server** (`od mcp`) that proxies
project, file, and skill tool calls to a running local OpenDesign daemon, so an APC agent
session can pull a design, read its tokens, or commission a new artifact without anyone
exporting a zip.

APC treats this as an **optional add-on**, not a phase dependency:

- Nothing in `/apc-dream` ... `/apc-ship` requires it.
- No OpenDesign content is vendored into `.agents/skills/`. The MCP surface reaches the
  catalogue instead, so APC's own skill namespace stays intact.
- All generated wiring is **machine-local and gitignored**. The repo stays portable.

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Open Design desktop app | <https://open-design.ai/download> - the daemon + skills live in the app bundle |
| Node.js 20+ | The MCP server is a Node process (`mcp` mode is pure JS; no native modules) |
| Running daemon | App open. The app picks the port at launch (`7456` when free, otherwise random - `6063` observed); `scripts/lib/od-mcp-bridge.mjs` finds it automatically. |

## Install

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-open-design-mcp.ps1
```

The script (idempotent, no network access) discovers the app under
`%LOCALAPPDATA%\Programs`, `%ProgramFiles%`, or `%ProgramFiles(x86)%` and writes:

| Target | Purpose |
|--------|---------|
| `.mcp.json` | Claude Code and other hosts that read project-level `mcpServers` |
| `.cursor\mcp.json` | Cursor |
| `.vscode\mcp.json` | VS Code native MCP (`servers` key) |
| `.codex\config.toml` | Appends `[mcp_servers."open-design"]` (Codex CLI) |
| `%APPDATA%\npm\od.cmd` + `od.ps1` | `od` shim -> bundled `daemon-cli.mjs` |

Options:

| Flag | Effect |
|------|--------|
| `-InstallRoot <dir>` | Point at a non-standard install folder |
| `-PathDir <dir>` | Put the `od` shim somewhere else (must be on `PATH`) |
| `-DaemonUrl <url>` | Pin the daemon URL and skip auto-discovery (default: discover) |
| `-SkipVerify` | Skip the JSON-RPC handshake probe |
| `-Uninstall` | Remove the shim and the generated config entries |

Every written entry resolves to the same stdio command - the bridge, which then execs the
real MCP server:

```json
{
  "type": "stdio",
  "command": "<node.exe>",
  "args": ["<repo>/scripts/lib/od-mcp-bridge.mjs"]
}
```

Node plus an absolute script path is used instead of a bare `od` on purpose: GUI-launched
hosts often inherit a minimal `PATH`, and Windows `.cmd` shims are not always spawnable
without a shell.

### Port discovery

`od mcp` requires `--daemon-url` and has no auto-discovery of its own, while the desktop app
binds a **different port on most launches**. Hardcoding one therefore breaks on restart, so
`scripts/lib/od-mcp-bridge.mjs` resolves it per session:

1. `--daemon-url` argument, then `OD_DAEMON_URL`, then `OD_PORT`
2. otherwise it probes `/api/health` on localhost listening ports (7456 first) and uses the
   first one that answers `{"ok":true,...}`
3. it then spawns `daemon-cli.mjs mcp --daemon-url <resolved>` with inherited stdio

Discovery takes well under a second and is cached for the life of the MCP session, so a
restart of the app is picked up the next time the host spawns the server.



## Verify

The installer ends with a handshake probe. Expected output:

```text
[ok ] MCP handshake OK (server 'open-design', daemon http://127.0.0.1:6063); core tools found: 4/4
[ok ] Daemon discovered at http://127.0.0.1:6063 - MCP tools are live.
```

Repeat it any time; set `APC_OD_DEBUG=1` to print the resolved command line:

```powershell
$env:APC_OD_DEBUG = '1'
powershell -ExecutionPolicy Bypass -File .\scripts\install-open-design-mcp.ps1
```

After restarting your agent host, the server appears as `open-design` with these tool families:

| Family | Tools |
|--------|-------|
| Context | `get_active_context`, `list_projects`, `get_project`, `list_files`, `get_file`, `search_files`, `get_artifact` |
| Editing | `create_artifact`, `write_file`, `delete_file`, `delete_project` |
| Generation | `collect_brief`, `confirm_brief`, `list_skills`, `list_plugins`, `list_agents`, `start_run`, `get_run`, `cancel_run` |

Reading design context is the low-risk path: `get_artifact()` with no arguments returns the
file the user has open in OpenDesign plus every referenced sibling (tokens CSS, modules,
assets) - useful when a WebView plugin UI has to match an existing OpenDesign mockup.
Commissioning a run (`start_run`) bills the OpenDesign side and needs an existing project.

## Starting the daemon

Normal path - launch the Open Design app; the daemon binds a loopback port it picks at launch
(`7456` when free, otherwise an ephemeral one such as `6063`). Never assume the port - the
bridge resolves it.

Headless path (no window, useful for agent sessions):

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& "$env:LOCALAPPDATA\Programs\Open Design\Open Design.exe" `
  "$env:LOCALAPPDATA\Programs\Open Design\resources\app\prebundled\daemon\daemon-cli.mjs" `
  --no-open --port 7456
```

> **Do not start the daemon with system `node`.** The shipped `better-sqlite3` is compiled
> against Electron's ABI (`NODE_MODULE_VERSION 145`); Node 24 expects `137`, so
> `node daemon-cli.mjs` fails with `ERR_DLOPEN_FAILED`. The `mcp` subcommand is unaffected -
> it only speaks HTTP to the daemon, which is why the MCP entry uses plain `node`.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `cannot reach the OpenDesign daemon at http://127.0.0.1:<port>` | Daemon is down, or a pinned `-DaemonUrl` port went stale. Start the app and retry; without `-DaemonUrl` the bridge re-discovers the port. |
| `list_projects` -> `{"projects": []}` | Healthy connection; the daemon simply has no projects yet. |
| `list_skills` -> `{"skills": []}` | Daemon answered but its data dir is unconfigured - finish first-run setup in the app. |
| Host shows no `open-design` server | Restart the host after installing, and confirm the config path matches the host you use. Codex needs the `[mcp_servers."open-design"]` block in **its** config file. |
| `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` | The daemon was launched with system `node`. Use the app or `ELECTRON_RUN_AS_NODE`. |
| `EADDRINUSE` when starting the daemon by hand | An app instance already owns that port - it is the daemon, so just use it. |
| Installer cannot find the app | Pass `-InstallRoot 'C:\path\to\Open Design'`. |

## Removing it

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-open-design-mcp.ps1 -Uninstall
```

This deletes the `od` shim, strips `open-design` from the JSON configs (deleting the file when
nothing else is configured), and removes the Codex block. Nothing inside the Open Design
install is touched.

## Licensing note

The OpenDesign repo is Apache-2.0; bundled skills and templates keep their own licenses. APC
does not redistribute any of them - this integration only launches the MCP server of the copy
you already installed. If you later want individual skills *inside* this repo's
`.agents/skills/`, copy them folder by folder and carry their license files.
