# Crash diagnostics - local only (policy + design)

> **Policy (stone rule 4, L-08): crash reporting NEVER uploads.** No telemetry, no Sentry/Crashpad/Breakpad upload server,
> no "send report" button, no background request. Diagnostics stay on the user's machine; the *user* decides whether to
> paste them into a support message. This guide is design + rules; no new runtime code ships with it.

## What exists today (grep result)

| Where | Behaviour | Gaps |
|---|---|---|
| `common/VisageJuceHost.h` `npsCrashHandler()` | writes `APC_CRASH_REPORT.txt` (time, SEH code/address/thread on Windows, JUCE stack backtrace) and, on Windows, `APC_CRASH_MINIDUMP.dmp` via dbghelp, both into the user's **Documents** folder | local only (good); overwritten each time; no plugin/framework version, build id, OS, host or recent-events context; Documents is a poor home |
| Same file, `VisagePluginEditor` ctor | handler is installed **only for the Standalone wrapper** or when `APC_CRASH_HANDLER=1` (finding F30: a hosted plugin must never replace the DAW's process-wide crash handler) | hosted crashes leave no APC report - by design |
| `.gitignore` | ignores `APC_CRASH_REPORT.txt`, `logs/` | - |
| `docs/FAQ.md`, `.agents/skills/skill_testing`, `scripts/preview-design.ps1` | point developers at `Documents/APC_CRASH_REPORT.txt` | path will change if the design below is adopted - update those pointers then |

Keep F30: **do not install process-global crash handlers in a hosted plugin.** The local crash file remains a
Standalone/dev-run facility.

## Design

### 1. Local diagnostics log (events, not crashes)

- Location: `<AppDataRoot>/<Manufacturer>/<PluginName>/logs/diagnostics.log` (same root as `settings.json`).
- Plain UTF-8 text, append-only, **rotating** (e.g. 256 KiB x 3 files), one event per line:
  `2026-11-07T12:00:03Z [warn] update: Failed Network "Could not reach the update server: timeout"`.
- Writing is best effort and non-throwing; a log failure must not break the plugin (and must not allocate/lock on the audio thread:
  log from message/worker threads only; the audio thread sets an atomic flag the message thread turns into an event).
- Feed it from the places that already produce visible errors: `UpdateStatus` failures (`updater.md`), `LicenseStatus`
  reason/warning (`licensing-seam.md`), `SettingsStore::takeWarnings()`, preset/pack I/O errors (stone rule 1). The UI shows the
  error to the user **and** logs it.

### 2. What may go in

Allowed: timestamp (UTC), plugin name + version + build id, framework/JUCE version, plugin format (VST3/AU/CLAP/Standalone),
OS name + version + architecture, host product name/version if the host reports it, sample rate, block size, channel layout,
`engine.*` quality settings, license **state name** (DEMO/TRIAL/LICENSED/UNVERIFIED) and reason code, update state/error code,
error codes and messages produced by the modules above, the last N event lines, crash summary (exception code, address, stack
backtrace) when a local crash file exists.

Never: audio or preset content, project/file **names or full paths** (log `<AppDataRoot>/...` relative or hash; strip the OS user name),
license serial, customer name/email/order id, raw machine identifiers (only the salted hashes if at all), IP addresses, anything
typed by the user, environment variables, other processes' information.

### 3. "Copy diagnostics" (the only way data leaves)

A button in Settings -> About (and next to any shown error): builds one text block and puts it on the **clipboard**:

```
Diagnostics (copy generated locally; nothing was sent anywhere)
Product: DemoSynth v1.3.0 (build 2026-11-07)   Format: VST3   Framework: apc 1.8.0 / JUCE 9.0.1
OS: Windows 11 10.0.26200 x64   Host: <name version>   SR: 48000   Block: 512
License: DEMO (NoLicense)   Update: UpToDate
--- last 50 log lines ---
...
--- crash summary (if any) ---
```

- Also offer **[Open logs folder]** so the user can attach `diagnostics.log` / a minidump manually if support asks.
- No upload button, no `mailto:` with attachments, no automatic opening of a browser/e-mail client with the data prefilled.
  Clipboard + folder reveal only (explicit user action, fully offline).
- Cap the block (e.g. 16 KiB) and apply the redaction rules above in one function so every field passes through it.

### 4. Crash files

- Standalone/dev crash handler (existing): keep writing `APC_CRASH_REPORT.txt` + `.dmp`, but move them under `logs/`,
  prepend the same version/OS header, keep the last few (`crash-<unix>.txt`) instead of overwriting, and let "Copy diagnostics"
  include the newest crash summary.
- Hosted plugin: no handler (F30). If the host crashes inside the plugin the DAW's own reporter applies; our log's last lines
  (written before the crash, flushed per line) are the only evidence - flush each event.
- The minidump contains process memory: never read, upload or attach it automatically; tell the user it may contain project data
  before they choose to share it.

### 5. Checklist for an agent adding diagnostics to a plugin

- [ ] No network code added; no dependency that uploads (Crashpad/Sentry/Breakpad servers disabled or absent)
- [ ] No process-global handler in hosted builds (F30)
- [ ] Log in AppData `logs/`, rotating, written off the audio thread
- [ ] Redaction function covers paths, names, serials; unit-tested with hostile inputs
- [ ] "Copy diagnostics" + "Open logs folder" only; wording states that nothing is sent
- [ ] Docs/pointers to `Documents/APC_CRASH_REPORT.txt` updated if the location changes
