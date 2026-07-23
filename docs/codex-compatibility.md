# Codex Compatibility

Audio Plugin Coder supports Codex through a repository instruction file and a Codex skill adapter. The adapter routes Codex into APC's existing workflows and domain skills rather than duplicating them.

## Compatibility Status

| Capability | Codex support |
|---|---|
| Repository guidance | `AGENTS.md` |
| Repo-local skill discovery | `.agents/skills/audio-plugin-coder/SKILL.md` |
| Installable plugin manifest | `.codex-plugin/plugin.json` |
| Packaged skill | `skills/audio-plugin-coder/SKILL.md` |
| File editing and shell execution | Supported through Codex tools and approvals |
| APC phase/state gating | Enforced by `AGENTS.md` and the APC skill |
| APC legacy slash commands | Use the Codex mappings below |

## Start in Codex

Open the repository root in Codex CLI or the Codex IDE extension, then start a new session so repository skills are discovered.

```text
$audio-plugin-coder:audio-plugin-coder dream MyReverb
```

Codex can also select the skill from a natural-language request:

```text
Create a new APC audio plugin called MyReverb.
```

## Command Mapping

APC's slash commands were designed for Claude Code and Kilo. In Codex, use the single skill with an action:

| APC documentation | Codex |
|---|---|
| `/dream MyReverb` | `$audio-plugin-coder:audio-plugin-coder dream MyReverb` |
| `/plan MyReverb` | `$audio-plugin-coder:audio-plugin-coder plan MyReverb` |
| `/design MyReverb` | `$audio-plugin-coder:audio-plugin-coder design MyReverb` |
| `/impl MyReverb` | `$audio-plugin-coder:audio-plugin-coder impl MyReverb` |
| `/test MyReverb` | `$audio-plugin-coder:audio-plugin-coder test MyReverb` |
| `/debug MyReverb` | `$audio-plugin-coder:audio-plugin-coder debug MyReverb` |
| `/status MyReverb` | `$audio-plugin-coder:audio-plugin-coder status MyReverb` |
| `/resume MyReverb` | `$audio-plugin-coder:audio-plugin-coder resume MyReverb` |
| `/ship MyReverb` | `$audio-plugin-coder:audio-plugin-coder ship MyReverb` |
| `/new MyReverb` | `$audio-plugin-coder:audio-plugin-coder new MyReverb` |

Do not type `/plan` or `/status` to start APC phases in Codex. They are built-in Codex commands for plan mode and session status.

## Repo Skill vs Plugin

- **Working in this checkout:** no installation is required. Codex discovers the repo-local skill under `.agents/skills/`.
- **Packaging for a marketplace:** the repository root is a valid Codex plugin package through `.codex-plugin/plugin.json`.
- **Codex IDE extension:** use the repo-local skill. Installable plugins are available in Codex CLI and supported desktop surfaces, while repo skills work in the IDE extension.

After changing skill metadata, start a new Codex session if the update does not appear immediately.

## Design Notes

- `AGENTS.md` carries durable repository rules because Codex does not read `.agent/rules/` automatically.
- The adapter loads the existing `.claude/` workflow wrappers first, then falls back to the equivalent `.agent/` files.
- A single `audio-plugin-coder` skill avoids duplicating APC's large domain knowledge base.
- The adapter translates platform-specific examples and preserves APC's one-phase-at-a-time stopping rule.

## Official Codex References

- [Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Build skills](https://learn.chatgpt.com/docs/build-skills)
- [Build plugins](https://learn.chatgpt.com/docs/build-plugins)
