---
name: skill_debug
description: Autonomous Debugging Instructions for Visual Studio Code: for [plugin].
---

## Purpose

This document defines a **self-directed debugging workflow** for a Large Language Model (LLM) operating inside or alongside **Visual Studio Code: (VS Code:)**. The goal is for the LLM to:

1. Inspect a codebase without human intervention
2. Identify likely failure points
3. Insert breakpoints programmatically
4. Generate a valid VS Code: `launch.json` debugging configuration
5. Enter VS Code: debug mode
6. Capture runtime errors, logs, and stack traces
7. Filter noise while preserving full raw error telemetry
8. Transmit all collected diagnostic data back to the LLM for analysis

This workflow assumes the LLM has:

- Read access to the workspace
- Write access to configuration files
- The ability to invoke VS Code: commands (directly or via an agent/tooling layer)

---

## High-Level Debugging Strategy

The LLM must operate as a **deterministic debugger**, not a conversational assistant.

Core principles:

- Prefer evidence over speculation
- Favor runtime inspection over static guesses
- Never suppress errors at source
- Always preserve original error output

---

## Step 1: Workspace Reconnaissance

1. Enumerate the workspace root
2. Identify:
   - Primary language(s)
   - Entry points (e.g. `main.py`, `index.js`, `app.ts`, `Program.cs`)
   - Existing test suites
   - Existing `.vscode` configuration
3. Detect build systems and runtimes:
   - Node.js, Python, Java, .NET, Go, etc.

Output a **workspace map** internally before proceeding.

---

## Step 2: Static Code Analysis

For each execution path:

1. Parse the AST (or equivalent)
2. Identify:
   - Unhandled exceptions
   - Unsafe casts
   - Null/undefined dereferences
   - Infinite loops
   - Race conditions (async / threading)
   - External I/O boundaries (filesystem, network, DB)

Mark all **high-risk lines**.

---

## Step 3: Breakpoint Placement Heuristics

Automatically insert breakpoints at:

- Program entry point
- All caught and uncaught exception blocks
- Function boundaries with:
  - Complex conditionals
  - State mutation
  - External side effects
- Before and after async boundaries
- Any line referenced in stack traces from prior runs

### Breakpoint Rules

- Prefer conditional breakpoints when possible
- Avoid breakpoints inside tight loops unless gated
- Label each breakpoint with intent (comment or metadata)

---

## Step 4: Generate VS Code: Debug Configuration

Create or update:

```
.vscode/launch.json
```

### Requirements

- Use the correct debugger type for the detected runtime
- Ensure `stopOnEntry` is enabled
- Enable verbose logging
- Capture stdout and stderr
- Do NOT suppress framework-level warnings

### Example (Node.js)

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "LLM Autonomous Debug",
      "program": "${workspaceFolder}/index.js",
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen",
      "stopOnEntry": true,
      "outputCapture": "std",
      "env": {
        "NODE_ENV": "development"
      }
    }
  ]
}
```

Adapt as required for other languages.

---

## Step 5: Enter Debug Mode

1. Invoke VS Code: command:
   - `Debug: Start Debugging`
2. Confirm debugger attachment
3. Verify all breakpoints are registered

If debugger fails to attach, halt and report configuration errors.

---

## Step 6: Runtime Observation

While execution is paused or running:

Capture:

- Call stacks
- Variable states
- Heap/closure values (where available)
- Thread or async task states

On error or crash, collect:

- Full stack trace
- Error type
- Error message
- Source location
- Runtime version
- OS and architecture

---

## Step 7: Error Telemetry Handling

### DO NOT discard information

The LLM must:

1. Capture **raw error output verbatim**
2. Separately derive:
   - A cleaned summary
   - A probable root cause
   - A confidence score

### Noise Handling

- Framework warnings
- Deprecation notices
- Transitive dependency logs

These must be **tagged as low-signal**, not removed.

---

## Step 8: Transmission Back to the LLM

Transmit a structured payload containing:

- Workspace map
- Breakpoint list
- `launch.json`
- Execution timeline
- Raw stderr/stdout
- Stack traces
- Memory snapshots (if available)

### Suggested Format

```json
{
  "environment": {},
  "breakpoints": [],
  "errors": [],
  "rawLogs": "",
  "analysisHints": []
}
```

---

## Step 9: Iterative Debugging Loop

If the root cause is not definitive:

1. Adjust breakpoints
2. Restart debug session
3. Narrow scope
4. Repeat until failure is explained by evidence

Never apply fixes without isolating the cause.

---

## Termination Criteria

Stop only when:

- The error is fully reproducible
- The root cause is identified
- The exact line(s) responsible are known

At that point, transition from **debugging mode** to **remediation mode**.

---

## Final Note

This document defines behavior, not intent.

The LLM must act as a debugger first, a theorist second, and a code generator last.
