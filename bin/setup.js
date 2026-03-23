#!/usr/bin/env node

/**
 * Audio Plugin Coder — One-command installer
 *
 * Usage:
 *   npx audio-plugin-coder@latest
 *   npx github:Noizefield/audio-plugin-coder
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');

// ─── Colours (no deps) ───────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  white:  '\x1b[37m',
};
const ok   = (s) => `${c.green}✓${c.reset} ${s}`;
const warn = (s) => `${c.yellow}⚠${c.reset}  ${s}`;
const err  = (s) => `${c.red}✗${c.reset}  ${s}`;
const info = (s) => `${c.cyan}→${c.reset} ${s}`;
const bold = (s) => `${c.bold}${s}${c.reset}`;
const dim  = (s) => `${c.dim}${s}${c.reset}`;

// ─── Banner ───────────────────────────────────────────────────────────────────
function banner() {
  console.log('');
  console.log(`${c.cyan}${c.bold}╔══════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.cyan}${c.bold}║         AUDIO PLUGIN CODER  —  APC v0.3.0           ║${c.reset}`);
  console.log(`${c.cyan}${c.bold}║   AI-powered VST3/AU plugin dev with JUCE 8          ║${c.reset}`);
  console.log(`${c.cyan}${c.bold}╚══════════════════════════════════════════════════════╝${c.reset}`);
  console.log('');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
  } catch {
    return null;
  }
}

function commandExists(cmd) {
  const which = process.platform === 'win32' ? 'where' : 'which';
  return run(`${which} ${cmd}`) !== null;
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Platform detection ───────────────────────────────────────────────────────
function detectPlatform() {
  const p = process.platform;
  if (p === 'win32')  return 'windows';
  if (p === 'darwin') return 'macos';
  return 'linux';
}

// ─── Tool checks ─────────────────────────────────────────────────────────────
function checkTools(platform) {
  console.log(bold('\n── Checking required tools ─────────────────────────────\n'));

  const checks = [
    { name: 'Git',      cmd: 'git',    test: () => run('git --version') },
    { name: 'CMake',    cmd: 'cmake',  test: () => run('cmake --version') },
    { name: 'VS Code',  cmd: 'code',   test: () => run('code --version') },
    { name: 'Node.js',  cmd: 'node',   test: () => run('node --version') },
  ];

  // Platform-specific build tool
  if (platform === 'windows') {
    checks.push({
      name: 'Visual Studio / MSBuild',
      cmd: 'msbuild',
      test: () => run('msbuild -version'),
    });
  } else if (platform === 'macos') {
    checks.push({
      name: 'Xcode Command Line Tools',
      cmd: 'xcode-select',
      test: () => run('xcode-select -p'),
    });
  } else {
    checks.push({
      name: 'GCC / G++',
      cmd: 'g++',
      test: () => run('g++ --version'),
    });
  }

  const missing = [];

  for (const check of checks) {
    const result = check.test();
    if (result) {
      const version = result.split('\n')[0];
      console.log(ok(`${check.name}  ${dim(version)}`));
    } else {
      console.log(warn(`${check.name}  ${dim('not found')}`));
      missing.push(check.name);
    }
  }

  if (missing.length > 0) {
    console.log('');
    console.log(warn('Missing tools — install these before starting:\n'));
    for (const m of missing) {
      console.log(`  ${c.yellow}•${c.reset} ${m}`);
    }
  }

  return missing;
}

// ─── Clone ────────────────────────────────────────────────────────────────────
async function cloneRepo(targetDir) {
  const repoUrl = 'https://github.com/Noizefield/audio-plugin-coder.git';

  console.log(bold('\n── Setting up Audio Plugin Coder ───────────────────────\n'));

  if (fs.existsSync(path.join(targetDir, '.git'))) {
    console.log(ok(`Repository already exists at ${bold(targetDir)}`));
    console.log(info('Pulling latest changes...'));
    const result = spawnSync('git', ['pull', '--ff-only'], { cwd: targetDir, stdio: 'inherit' });
    if (result.status !== 0) {
      console.log(warn('Could not pull — your local repo may have diverged. Skipping update.'));
    }
    return true;
  }

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    console.log(err(`Directory ${bold(targetDir)} exists and is not empty.`));
    console.log(info('Choose a different install path or clear the directory first.'));
    return false;
  }

  console.log(info(`Cloning into ${bold(targetDir)} ...`));
  console.log(dim(`  Source: ${repoUrl}\n`));

  const result = spawnSync(
    'git',
    ['clone', '--depth', '1', '--recurse-submodules', repoUrl, targetDir],
    { stdio: 'inherit' }
  );

  if (result.status !== 0) {
    console.log(err('Clone failed. Check your internet connection and try again.'));
    return false;
  }

  console.log('');
  console.log(ok(`Cloned successfully to ${bold(targetDir)}`));
  return true;
}

// ─── Next steps ───────────────────────────────────────────────────────────────
function printNextSteps(platform, targetDir) {
  console.log(bold('\n── Next steps ──────────────────────────────────────────\n'));

  console.log(`  ${c.cyan}1.${c.reset} Open the project in VS Code:`);
  console.log(`     ${dim(`code "${targetDir}"`)}`);
  console.log('');

  console.log(`  ${c.cyan}2.${c.reset} Install the Claude Code extension if you haven't already:`);
  console.log(`     ${dim('https://marketplace.visualstudio.com/items?itemName=Anthropic.claude-code')}`);
  console.log('');

  console.log(`  ${c.cyan}3.${c.reset} Start your first plugin:`);
  console.log(`     ${dim('/dream MyPluginName')}  ${dim('← type this inside Claude Code')}`);
  console.log('');

  if (platform === 'windows') {
    console.log(`  ${c.cyan}4.${c.reset} Build a plugin (Windows, from VS Code terminal):`);
    console.log(`     ${dim('.\\scripts\\build-and-install.ps1 -PluginName MyPluginName')}`);
  } else if (platform === 'macos') {
    console.log(`  ${c.cyan}4.${c.reset} Build a plugin (macOS, from VS Code terminal):`);
    console.log(`     ${dim('bash scripts/build-and-install.sh MyPluginName')}`);
    console.log('');
    console.log(`     Run system check to verify your environment:`);
    console.log(`     ${dim('bash scripts/system-check.sh')}`);
  } else {
    console.log(`  ${c.cyan}4.${c.reset} Build a plugin (Linux):`);
    console.log(`     ${dim('bash scripts/build-and-install.sh MyPluginName')}`);
  }

  console.log('');
  console.log(`  ${c.cyan}5.${c.reset} Read the docs:`);
  console.log(`     ${dim('https://github.com/Noizefield/audio-plugin-coder#readme')}`);
  console.log('');

  console.log(`${c.green}${c.bold}Ready to build!${c.reset} The five-phase workflow: ${dim('Dream → Plan → Design → Implement → Ship')}`);
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  banner();

  // Check git is available before anything else
  if (!commandExists('git')) {
    console.log(err('Git is not installed. Please install Git first:'));
    console.log(info('https://git-scm.com/downloads'));
    process.exit(1);
  }

  const platform = detectPlatform();
  console.log(info(`Detected platform: ${bold(platform)}`));

  // Ask where to install
  const defaultDir = path.join(process.cwd(), 'audio-plugin-coder');
  const answer = await prompt(
    `\n${c.cyan}Install directory${c.reset} ${dim(`[${defaultDir}]`)}: `
  );
  const targetDir = answer.length > 0 ? path.resolve(answer) : defaultDir;

  // Clone / update
  const cloned = await cloneRepo(targetDir);
  if (!cloned) {
    process.exit(1);
  }

  // Tool checks
  const missing = checkTools(platform);

  // Next steps
  printNextSteps(platform, targetDir);

  if (missing.length > 0) {
    console.log(warn(`Install the missing tools above, then run ${dim('npx audio-plugin-coder@latest')} again to verify.\n`));
  }
}

main().catch((e) => {
  console.error(err('Unexpected error:'), e.message);
  process.exit(1);
});
