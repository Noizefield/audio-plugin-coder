# Model Routing

APC stores **global** per-phase model preferences in `apc.config.json` (created by `/apc-setup`).

## Why this exists

Planning and implementation benefit from stronger models. Shipping checklists and status routing often do not. Recording preferences keeps that intent portable across Claude Code, Cursor, Codex, and Kilo.

## What APC can and cannot do

| Host | Automation level |
|---|---|
| Cursor (Task / subagents) | Can pass a `model` when launching a subagent if the user/session allows |
| Claude Code | User may switch model manually; APC announces preference at phase start |
| Codex | User selects model in the host; APC documents preference only |
| Kilo / others | Announce preference; user switches if supported |

**APC never blocks a phase solely because the active model differs.** It warns and continues.

## Config location

```json
{
  "models": {
    "profile": "balanced",
    "phases": {
      "plan":  { "provider": "auto", "model": "your-strongest-id" },
      "design":{ "provider": "auto", "model": "your-strong-id" },
      "impl":  { "provider": "auto", "model": "your-strong-id" },
      "ship":  { "provider": "auto", "model": "your-economy-id" }
    }
  }
}
```

Replace placeholder tokens from `apc.config.example.json` with model IDs you actually have access to during `/apc-setup`.

## Presets

| Profile | plan | design / impl | ship / status / setup |
|---|---|---|---|
| quality | strongest | strong | economy |
| balanced | strongest | strong | economy |
| budget | mid | mid | economy |

## Agent rule

At the start of `/apc-plan`, `/apc-design`, `/apc-impl`, `/apc-ship`, etc.:

1. Read `models.phases.<phase>`
2. Tell the user the preferred model
3. Ask them to switch if the host cannot do it automatically
4. Continue the phase
