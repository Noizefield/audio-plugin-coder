#!/usr/bin/env node
// APC - Open Design MCP bridge.
//
// The Open Design desktop app starts its daemon on a port it picks at launch
// (observed: 7456 only when free, otherwise a random high port such as 6063),
// so a hardcoded --daemon-url in an MCP config goes stale on every restart.
// This bridge resolves the install + the live daemon port, then hands stdio to
// the real MCP server (`daemon-cli.mjs mcp --daemon-url <resolved>`).
//
// Usage:
//   node scripts/lib/od-mcp-bridge.mjs [--daemon-url <url>] [--install-root <dir>] [--quiet]
//
// Daemon URL resolution order:
//   1. --daemon-url <url>
//   2. OD_DAEMON_URL environment variable
//   3. OD_PORT environment variable -> http://127.0.0.1:<port>
//   4. health-probe of localhost listening ports (7456 first, then the rest)
//
// Machine paths come from APPDATA / LOCALAPPDATA / ProgramFiles at run time, so
// this file is portable and safe to commit.

import { execSync, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CLI_REL = join('resources', 'app', 'prebundled', 'daemon', 'daemon-cli.mjs');
const HEALTH_TIMEOUT_MS = 400;
const MAX_PROBE_PORTS = 96;

function log(message) {
  if (!process.argv.includes('--quiet')) process.stderr.write(`[od-mcp-bridge] ${message}\n`);
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

function installCandidates() {
  const candidates = [];
  const explicit = argValue('--install-root') ?? process.env.APC_OD_INSTALL_ROOT ?? process.env.OD_INSTALL_ROOT;
  if (explicit) candidates.push(explicit);

  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  if (localAppData) candidates.push(join(localAppData, 'Programs', 'Open Design'));
  if (programFiles) candidates.push(join(programFiles, 'Open Design'));
  if (programFilesX86) candidates.push(join(programFilesX86, 'Open Design'));

  // Shallow scan covers renamed install folders.
  const scanRoots = [localAppData && join(localAppData, 'Programs'), programFiles];
  for (const root of scanRoots) {
    if (!root || !existsSync(root)) continue;
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && /open\s*-?\s*design/i.test(entry.name)) {
          candidates.push(join(root, entry.name));
        }
      }
    } catch {
      /* ignore unreadable roots */
    }
  }
  return candidates;
}

function resolveCli() {
  for (const candidate of installCandidates()) {
    const cli = join(candidate, CLI_REL);
    if (existsSync(cli)) return { cli, root: candidate };
  }
  return null;
}

async function isDaemon(url) {
  try {
    const response = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

function localhostListeningPorts() {
  // Best effort: any failure just means fewer probe candidates.
  const ports = new Set([7456]);
  try {
    const isWindows = process.platform === 'win32';
    const output = isWindows
      ? execSync('netstat -ano -p tcp', { encoding: 'utf8', timeout: 2500, windowsHide: true })
      : execSync('lsof -nP -iTCP -sTCP:LISTEN', { encoding: 'utf8', timeout: 2500 });

    for (const line of output.split(/\r?\n/)) {
      if (!/LISTEN/i.test(line)) continue;
      const match = isWindows
        ? line.match(/\sTCP\s+(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\[::\]):(\d{2,5})\s/)
        : line.match(/(?:127\.0\.0\.1|localhost|\*):(\d{2,5})/);
      if (match) ports.add(Number(match[1]));
    }
  } catch {
    /* ignore */
  }
  const ordered = [...ports].filter((port) => Number.isInteger(port) && port > 0 && port < 65536);
  ordered.sort((a, b) => (a === 7456 ? -1 : b === 7456 ? 1 : a - b));
  return ordered.slice(0, MAX_PROBE_PORTS);
}

async function resolveDaemonUrl() {
  const explicit = argValue('--daemon-url') ?? process.env.OD_DAEMON_URL;
  if (explicit) {
    if (await isDaemon(explicit)) return explicit;
    log(`--daemon-url ${explicit} is not answering /api/health; probing other ports`);
  }

  if (process.env.OD_PORT) {
    const url = `http://127.0.0.1:${process.env.OD_PORT}`;
    if (await isDaemon(url)) return url;
  }

  const probes = await Promise.all(
    localhostListeningPorts().map(async (port) => {
      const url = `http://127.0.0.1:${port}`;
      return { url, ok: await isDaemon(url) };
    }),
  );
  return probes.find((probe) => probe.ok)?.url ?? null;
}

async function main() {
  const resolved = resolveCli();
  if (!resolved) {
    log('Open Design install not found. Set APC_OD_INSTALL_ROOT to the app folder.');
    process.exit(1);
  }

  const url = await resolveDaemonUrl();
  log(url ? `daemon ${url} (app ${resolved.root})` : 'no live OpenDesign daemon found - is the app running?');

  const args = [resolved.cli, 'mcp'];
  if (url) args.push('--daemon-url', url);

  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      try {
        child.kill(signal);
      } catch {
        /* ignore */
      }
    });
  }
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  child.on('error', (error) => {
    log(`failed to start MCP server: ${error.message}`);
    process.exit(1);
  });
}

main();
