# Product Standards (`apc-standards/1.0`)

**Status:** LOCKED 2026-10-24 · **Registry:** `schemas/apc-standards.json`

These are the Plugin Product Standards. They are **machine-readable** — every
agent must read the registry instead of guessing values.

> The long-form rationale lives in the product owner's `plans/` folder (not
> version-controlled). This file + `schemas/` are the canonical, tracked
> contract that the framework code consumes.

---

## 1. Fixed in stone (all products, no opt-out)

1. **Never fail silently** on preset/data I/O — success or a visible error.
2. **Settings live once per machine** (never in the DAW project).
3. **Parameter help text written once**, reused by tooltip + info bar + manual.
4. **No telemetry.** Network only for explicit user actions and the optional
   update check (`update.auto_check`, default off).
5. **Version always visible** in the plugin GUI (footer first, never in a menu).

These are listed in the registry under `fixed_rules` and are not options.

## 2. Everything else is a per-plugin option (decision X-06)

| Scope | Decided where | Stored in | CLI |
|---|---|---|---|
| `global` | `/apc-setup` Advanced Setup + the APC Hub settings page | `apc.config.json` → `standards` | `apc standards set <id> <value> --global` |
| `plugin` | `/apc-plan`, once per plugin | `<plugin>/status.json` → `standards` | `apc standards set <id> <value> --plugin <Name>` |

**Resolution order:** plugin answer → global default → registry default.

Never re-ask a question that already has an answer in `status.json`.

## 3. Commands

```bash
apc standards list [--scope global|plugin] [--group G] [--json]
apc standards plan --plugin <Name>          # questions still unanswered
apc standards validate --plugin <Name>      # check config + plugin blocks
apc standards set <id> <value> --global|--plugin <Name>
```

`apc standards plan` is the prompt list for `/apc-plan`; `apc standards
validate` fails (exit 1) on unknown ids, wrong types, scope violations and
missing required answers.

## 4. Schemas

| File | Standard | Used for |
|---|---|---|
| `schemas/apc-standards.json` | `apc-standards/1.0` | the option registry (this file's data) |
| `schemas/apc-settings.schema.json` | `apc-settings/1.0` | `<AppDataRoot>/<Manufacturer>/<PluginName>/settings.json` |
| `schemas/apc-preset.schema.json` | `apc-preset/1.0` | preset assets **and** the host state chunk |

Preset rules that the schema encodes (P-04): values in **real-world units**
(`95.5` Hz, never normalized 0..1), choice parameters store their **label**
(never an index), parameter keys are **immutable IDs** (X-01), structured state
(mod matrix, lanes) is typed, and every file carries `schema` + `app_version`.

## 5. Module status

The standards describe five implementation modules. Only the **configuration
surface** (this file, the registry, the CLI, `/apc-setup`, `/apc-plan`) is
implemented today.

| Module | Status | Notes |
|---|---|---|
| `apc-presets` | done (WebView) | `apc presets ...`, `common/apc/*.h`, `common/apc/juce/ApcPresetStore.h`, preset browser in the kit |
| `apc-interactions` | WebView kit done | `templates/webview/apc-ui/` (`CONTRACT.md`); Visage kit not built; `apc kit test` |
| `apc-settings` | done (WebView) | `ApcSettingsStore.h` (lock+merge, engine defaults) + settings overlay in the kit |
| `apc-license` | methods A/B done | `ApcLicense.h` state machine + gate matrix, `apc license keygen|issue|verify|inspect|serve`, reference issuer; Ed25519 verify adapter still injected; L-06/L-07 decided 2026-11-08 (minimal default; `signed-file` + `online-activation`; iLok/SDKs pointers) |
| `apc-updater` | backend done | `ApcUpdateFlow.h`, `apc release ...`; `IHttp` / `ISignatureVerifier` are injected, not provided |

When a module lands, add its row here and keep the registry as the single
source of option ids.

## 5b. Decisions added 2026-11-07 (review follow-ups)

| ID | Rule | Registry option |
|---|---|---|
| X-08 | Engine/Quality state (oversampling, voices, anything that changes the sound) is saved **in the DAW project chunk**; the machine-wide `settings.json` engine section only supplies defaults for NEW instances. | `engine.state_scope` (default `chunk`) |
| X-09 | F1, `?` and Ctrl/Cmd+S are often captured by the host — help mode and quick-save always have a **visible button**; shortcuts are accelerators only. | — (rule) |
| X-10 | Crash handling is **local-only** (log + "Copy diagnostics"); never upload, not even opt-in. | — (rule) |
| X-11 | Update manifest is signed with its **own** Ed25519 key (never the license key); flow ends in `ReadyToInstall` ("close the DAW, run the installer"); no Sparkle. | `update.endpoint` |
| P-14 | Factory packs: installer writes to the installing user's folder (default). Known caveat: other accounts on the machine need *Restore Factory Layout*; `shared-seed` avoids it. | `preset.factory_install` |
| P-15 | Ratings/favorites/usage live in `user-data.json` keyed by asset ID (the index is disposable, this file is not). | — |
| P-16 | Samples referenced from a chunk carry a content hash + relative ref; mismatch → visible `[Missing]`. | — |
| P-10 | Vocabulary is append-only; files store **slugs**; the freeze binds from the first shipped product. Source: `schemas/pmx1-vocabulary.json`. | `preset.taxonomy` |

## 6. Rules for agents

1. Read `schemas/apc-standards.json` before writing a preset format, a settings
   file, or a licensing gate.
2. Never invent an option id. If a needed option does not exist, extend the
   registry (and bump `version`) instead of hardcoding a value in a plugin.
3. Record answers with the CLI or the state-management script — never by
   hand-editing `status.json`.
4. Do not re-ask a question that `apc standards plan` does not list.
5. Open decisions (`status: "open"` in the registry) must not be treated as
   settled; `apc standards validate` warns about them.
