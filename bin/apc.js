#!/usr/bin/env node

/**
 * apc — single cross-platform CLI for Audio Plugin Coder.
 *
 * Replaces the shell/OS matrix (`.scripts\foo.ps1 -PluginName X` on Windows
 * vs `bash scripts/foo.sh X` on macOS/Linux) with one command surface for
 * humans and AI agents. Zero dependencies, Node 18+.
 *
 * Phase 1 (strangler): `version` and `paths` are implemented natively;
 * everything else dispatches to the existing scripts/ backends, translating
 * arguments per platform. Logic migrates into the CLI file by file.
 *
 * Canonical framework version source: package.json ("version").
 * Run `apc version sync` after bumping it.
 *
 * Usage:
 *   apc version [--json]            print framework version
 *   apc version sync [--fix]        regenerate hub/version.js, check CMake pin
 *   apc paths [--json] [--plugin N]  resolved plugins/build/release dirs
 *   apc doctor [--fix]               version header + system-check for this OS
 *   apc build <Plugin> [--no-install] [--skip-tests] [--strict]
 *   apc validate <kind> [--plugin N] [--json]
 *       kind: webview | webview-order | visage | plugin | state
 *   apc backup <Plugin> <Version>
 *   apc rollback <Plugin> <Version>
 *   apc patch <Plugin> [--json]
 *   apc evolve <Plugin> [--codename "Name"] [--json]
 *   apc freeze <Plugin> [--tag TAG] [--json]
 *   apc status [--plugin N] [--json]
 *   apc help
 *
 * Exit codes: 0 ok · 1 backend failed · 2 usage/platform error.
 */

'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Repo root ─────────────────────────────────────────────────────────────
function findRepoRoot() {
  // APC_ROOT override exists for the test suite (test/ fixtures).
  if (process.env.APC_ROOT && process.env.APC_ROOT.length > 0) {
    return path.resolve(process.env.APC_ROOT);
  }
  const candidates = [
    path.resolve(__dirname, '..'),
    process.cwd(),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'package.json')) &&
          fs.existsSync(path.join(dir, 'scripts'))) {
        return dir;
      }
    } catch { /* ignore */ }
  }
  return path.resolve(__dirname, '..');
}
const ROOT = findRepoRoot();

// ─── Colours (no deps) ─────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m',
};
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColour ? `${code}${s}${c.reset}` : s);
const ok = (s) => `${paint(c.green, '✓')} ${s}`;
const warn = (s) => `${paint(c.yellow, '⚠')}  ${s}`;
const err = (s) => `${paint(c.red, '✗')}  ${s}`;
const dim = (s) => paint(c.dim, s);

// ─── Framework version (canonical: package.json) ───────────────────────────
function readPackageVersion() {
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return { version: pkg.version, source: pkgPath };
}

function cmdVersion(args) {
  const asJson = args.includes('--json');
  const { version, source } = readPackageVersion();
  if (asJson) {
    console.log(JSON.stringify({ version, source }, null, 2));
  } else {
    console.log(`apc ${version}`);
  }
}

// ─── Config + paths (canonical: apc.config.json) ───────────────────────────
// NOTE: apc.config.json may carry a UTF-8 BOM (PowerShell writers) — strip it.
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readConfig() {
  const main = path.join(ROOT, 'apc.config.json');
  const example = path.join(ROOT, 'apc.config.example.json');
  if (fs.existsSync(main)) return readJson(main);
  if (fs.existsSync(example)) return readJson(example);
  return { paths: {} };
}

function resolvePaths() {
  const cfg = readConfig();
  const p = (cfg.paths) || {};
  const resolve = (v, fallback) => {
    const rel = (typeof v === 'string' && v.length > 0) ? v : fallback;
    return path.resolve(ROOT, rel);
  };
  return {
    root: ROOT,
    pluginsDir: resolve(p.plugins_dir, 'plugins'),
    buildDir: resolve(p.build_dir, 'build'),
    releaseDir: resolve(p.release_dir, 'release'),
  };
}

function pluginPath(name) {
  return path.join(resolvePaths().pluginsDir, name);
}

function cmdPaths(args) {
  const asJson = args.includes('--json');
  const pi = args.indexOf('--plugin');
  const paths = resolvePaths();
  const out = { ...paths };
  if (pi !== -1 && args[pi + 1]) out.pluginDir = pluginPath(args[pi + 1]);
  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`root:         ${out.root}`);
    console.log(`plugins_dir:  ${out.pluginsDir}`);
    console.log(`build_dir:    ${out.buildDir}`);
    console.log(`release_dir:  ${out.releaseDir}`);
    if (out.pluginDir) console.log(`plugin_dir:   ${out.pluginDir}`);
  }
}

// ─── Backend dispatch ──────────────────────────────────────────────────────
const isWindows = process.platform === 'win32';

function commandExists(cmd) {
  try {
    const probe = isWindows ? 'where' : 'which';
    childProcess.execFileSync(probe, [cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a scripts/ backend. `ps1`/`sh` are the twin names (without extension).
 * `psArgs`/`shArgs` translate the CLI flags to each shell's convention
 * (.ps1 takes -PluginName; .sh takes positional args).
 * Set `windowsOnly: true` for scripts with no .sh twin (validators, pluginval).
 */
function runBackend({ ps1, sh, psArgs = [], shArgs = [], windowsOnly = false }) {
  let file;
  let args;
  if (isWindows) {
    file = 'powershell';
    args = ['-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', `${ps1}.ps1`), ...psArgs];
  } else if (!windowsOnly) {
    file = 'bash';
    args = [path.join(ROOT, 'scripts', `${sh}.sh`), ...shArgs];
  } else if (commandExists('pwsh')) {
    file = 'pwsh';
    args = ['-File', path.join(ROOT, 'scripts', `${ps1}.ps1`), ...psArgs];
  } else {
    console.error(err(`'${ps1}' has no Bash twin yet (Windows-only .ps1).`));
    console.error(`    Install PowerShell Core (pwsh) or run this on Windows.`);
    console.error(`    ${dim('Tracking: roadmap Idea 1 — port validators into the CLI.')}`);
    process.exit(2);
  }
  try {
    childProcess.execFileSync(file, args, { stdio: 'inherit', cwd: ROOT });
  } catch (e) {
    process.exit(typeof e.status === 'number' ? e.status : 1);
  }
}

function cmdDoctor(args) {
  const { version } = readPackageVersion();
  const platform = isWindows ? 'windows' : (process.platform === 'darwin' ? 'macos' : 'linux');
  console.log(`apc ${version} -- doctor (${platform}, node ${process.version})`);
  console.log('');
  if (args.includes('--fix')) doctorFix(platform);
  runBackend({
    ps1: 'system-check', sh: 'system-check',
    psArgs: ['-Human'], shArgs: ['--human'],
  });
}

// Safe, mechanical auto-fixes only. Toolchain installs are NEVER performed
// unsupervised -- they are reported with exact copy-paste commands instead.
function doctorFix(platform) {
  console.log('--fix: applying safe auto-fixes');
  const cfgPath = path.join(ROOT, 'apc.config.json');
  if (!fs.existsSync(cfgPath)) {
    const example = path.join(ROOT, 'apc.config.example.json');
    if (fs.existsSync(example)) {
      fs.copyFileSync(example, cfgPath);
      console.log(ok(`created apc.config.json from example (run /apc-setup to personalize)`));
    } else {
      console.log(warn('apc.config.example.json missing - cannot create config'));
    }
  } else {
    console.log(dim('apc.config.json present'));
  }
  const paths = resolvePaths();
  for (const [label, dir] of [['plugins_dir', paths.pluginsDir], ['build_dir', paths.buildDir], ['release_dir', paths.releaseDir]]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(ok(`created ${label}: ${dir}`));
    } else {
      console.log(dim(`${label} present: ${dir}`));
    }
  }
  const juceCmake = path.join(ROOT, '_tools', 'JUCE', 'CMakeLists.txt');
  if (!fs.existsSync(juceCmake)) {
    if (commandExists('git') && fs.existsSync(path.join(ROOT, '.git'))) {
      console.log('JUCE submodule missing - running: git submodule update --init --recursive');
      try {
        childProcess.execFileSync('git', ['submodule', 'update', '--init', '--recursive'], { stdio: 'inherit', cwd: ROOT });
        console.log(fs.existsSync(juceCmake) ? ok('JUCE submodule initialized') : err('submodule update ran but JUCE still missing'));
      } catch {
        console.log(err('git submodule update failed - check network access and retry'));
      }
    } else {
      console.log(warn('JUCE missing and git unavailable - clone with: git clone --recurse-submodules <repo>'));
    }
  } else {
    console.log(dim('JUCE submodule present'));
  }
  console.log('');
  console.log('Remaining toolchain gaps (not auto-installed) - copy-paste per OS:');
  if (platform === 'windows') console.log('  winget install Kitware.CMake Microsoft.VisualStudio.2022.BuildTools');
  else if (platform === 'macos') console.log('  xcode-select --install; brew install cmake node python3 jq');
  else console.log('  sudo apt-get install -y cmake g++ make nodejs python3 jq libwebkit2gtk-4.1-dev libegl-dev libasound2-dev libjack-jackd2-dev');
  console.log('');
}

function cmdBuild(args) {
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a) => !a.startsWith('--'));
  const name = positional[0];
  if (!name) {
    console.error(err('Usage: apc build <Plugin> [--no-install] [--skip-tests] [--strict]'));
    process.exit(2);
  }
  const psArgs = ['-PluginName', name];
  const shArgs = [name];
  if (flags.has('--no-install')) { psArgs.push('-NoInstall'); shArgs.push('--no-install'); }
  if (flags.has('--skip-tests')) { psArgs.push('-SkipTests'); shArgs.push('--skip-tests'); }
  if (flags.has('--strict')) {
    psArgs.push('-Strict');
    if (!isWindows) console.error(warn('--strict is not supported by the .sh backend yet; continuing without it.'));
  }
  for (const f of flags) {
    if (!['--no-install', '--skip-tests', '--strict'].includes(f)) {
      console.error(err(`Unknown flag: ${f}`));
      process.exit(2);
    }
  }
  runBackend({ ps1: 'build-and-install', sh: 'build-and-install', psArgs, shArgs });
}

const VALIDATORS = {
  'webview': { native: true, needsPlugin: true, ps1: 'validate-webview-setup' },
  'webview-order': { native: true, needsPlugin: true, ps1: 'validate-webview-member-order' },
  'visage': { native: true, needsPlugin: true, ps1: 'validate-visage-setup' },
  'plugin': { native: true, needsPlugin: false, ps1: 'validate-plugin-status' },
  // 'state' is a functional test OF the PowerShell state-management module
  // (dot-sources state-management.ps1 and calls its functions), so it cannot
  // be ported without migrating that module first. It stays shell-bound.
  'state': { native: false, needsPlugin: false, ps1: 'validate-state-management' },
};

// ─── Native validators (cross-platform; mirror the .ps1 semantics) ─────────
// NOTE: PowerShell -match/-notmatch are case-INSENSITIVE, so every pattern
// below carries the /i flag to keep parity with scripts/validate-*.ps1.
function readText(p) {
  try {
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

function newReport() {
  return { issues: [], warnings: [], checks: [] };
}
function vFail(r, check, message) { r.issues.push({ check, message }); r.checks.push({ check, status: 'fail', message }); }
function vWarn(r, check, message) { r.warnings.push({ check, message }); r.checks.push({ check, status: 'warn', message }); }
function vPass(r, check, message) { r.checks.push({ check, status: 'pass', message: message || 'ok' }); }
function vInfo(r, check, message) { r.checks.push({ check, status: 'info', message }); }

function printReport(kind, plugin, r, asJson) {
  if (asJson) {
    console.log(JSON.stringify({ kind, plugin: plugin || null, issues: r.issues, warnings: r.warnings, checks: r.checks }, null, 2));
  } else {
    if (r.issues.length > 0) {
      console.log(paint(c.red, 'CRITICAL ISSUES FOUND:'));
      for (const i of r.issues) console.log(`  [X] ${i.message}`);
    }
    if (r.warnings.length > 0) {
      if (r.issues.length > 0) console.log('');
      console.log(paint(c.yellow, 'WARNINGS:'));
      for (const w of r.warnings) console.log(`  [!] ${w.message}`);
    }
    if (r.issues.length === 0 && r.warnings.length === 0) {
      console.log(ok('All checks passed.'));
    } else {
      console.log('');
      console.log(`Issues: ${r.issues.length}, Warnings: ${r.warnings.length}`);
    }
  }
  return r.issues.length > 0 ? 1 : 0;
}

// Port of scripts/validate-webview-setup.ps1
function validateWebview(pluginDir) {
  const r = newReport();
  const editorCpp = path.join(pluginDir, 'Source', 'PluginEditor.cpp');
  const editorH = path.join(pluginDir, 'Source', 'PluginEditor.h');
  const cmakeLists = path.join(pluginDir, 'CMakeLists.txt');
  const legacyUI = path.join(pluginDir, 'Source', 'ui', 'public');
  const protocolUI = path.join(pluginDir, 'WebUI');
  const webUI = fs.existsSync(protocolUI) ? protocolUI : legacyUI;

  const cmake = readText(cmakeLists);
  if (cmake === null) {
    vFail(r, 'cmake-exists', 'CMakeLists.txt not found');
  } else {
    if (!/juce_add_binary_data/i.test(cmake)) vFail(r, 'cmake-binary-data', "CMakeLists.txt missing 'juce_add_binary_data' - web files won't be embedded");
    else vPass(r, 'cmake-binary-data');
    if (!/NEEDS_WEBVIEW2\s+TRUE/i.test(cmake)) vFail(r, 'cmake-webview2', "CMakeLists.txt missing 'NEEDS_WEBVIEW2 TRUE'");
    else vPass(r, 'cmake-webview2');
    if (!/JUCE_WEB_BROWSER=1/i.test(cmake)) vFail(r, 'cmake-web-browser', "CMakeLists.txt missing 'JUCE_WEB_BROWSER=1' compile definition");
    else vPass(r, 'cmake-web-browser');
    if (!/JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1/i.test(cmake)) vFail(r, 'cmake-static-link', "CMakeLists.txt missing 'JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1'");
    else vPass(r, 'cmake-static-link');
    if (!/juce::juce_gui_extra/i.test(cmake)) vFail(r, 'cmake-gui-extra', "CMakeLists.txt missing 'juce::juce_gui_extra' module");
    else vPass(r, 'cmake-gui-extra');
  }

  const cpp = readText(editorCpp);
  if (cpp === null) {
    vFail(r, 'editor-exists', 'PluginEditor.cpp not found');
  } else {
    if (!/WebBrowserComponent/i.test(cpp)) vFail(r, 'editor-component', "PluginEditor.cpp doesn't use WebBrowserComponent");
    else vPass(r, 'editor-component');
    if (!/withBackend.*webview2/i.test(cpp)) vFail(r, 'editor-backend', "PluginEditor.cpp missing '.withBackend(webview2)' - WebView2 backend not specified");
    else vPass(r, 'editor-backend');
    if (!/withUserDataFolder/i.test(cpp)) vFail(r, 'editor-user-data', "PluginEditor.cpp missing '.withUserDataFolder()' - Required for Windows plugins");
    else vPass(r, 'editor-user-data');
    if (!/withNativeIntegrationEnabled/i.test(cpp)) vFail(r, 'editor-native-integration', "PluginEditor.cpp missing '.withNativeIntegrationEnabled()' - JS to C++ communication disabled");
    else vPass(r, 'editor-native-integration');
    if (!/withResourceProvider/i.test(cpp)) vFail(r, 'editor-resource-provider', "PluginEditor.cpp missing '.withResourceProvider()' - Web files won't load");
    else vPass(r, 'editor-resource-provider');
    if (!/getResourceProviderRoot/i.test(cpp)) {
      if (/data:text\/html|loadHTML|goToURL.*data:/i.test(cpp)) vFail(r, 'editor-loading', 'PluginEditor.cpp uses data URI instead of resource provider - Use getResourceProviderRoot()');
      else vWarn(r, 'editor-loading', "PluginEditor.cpp doesn't use getResourceProviderRoot() - May not load embedded files");
    } else vPass(r, 'editor-loading');
    const h = readText(editorH) || '';
    if (!/WebSliderRelay|WebToggleButtonRelay|WebComboBoxRelay/i.test(cpp + ' ' + h)) vWarn(r, 'editor-relays', "No parameter relays found - Parameters won't sync with JavaScript");
    else vPass(r, 'editor-relays');
    if (!/WebSliderParameterAttachment|WebToggleButtonParameterAttachment|WebComboBoxParameterAttachment/i.test(cpp)) vWarn(r, 'editor-attachments', "No parameter attachments found - Parameters won't be connected");
    else vPass(r, 'editor-attachments');
    if (!/getResource.*String.*url/i.test(cpp)) vFail(r, 'editor-get-resource', 'getResource function not found - Resource provider will not work');
    else vPass(r, 'editor-get-resource');
    if (!/getZipFile|createAssetInputStream|BinaryData::getNamedResource/i.test(cpp)) vFail(r, 'editor-resource-loading', 'No resource loading mechanism found - Need getZipFile(), createAssetInputStream(), or BinaryData::getNamedResource()');
    else vPass(r, 'editor-resource-loading');
  }

  if (!fs.existsSync(webUI)) {
    vFail(r, 'webui-exists', `Web UI directory not found: ${webUI}`);
  } else {
    vPass(r, 'webui-exists');
    const indexHtml = path.join(webUI, 'index.html');
    const html = readText(indexHtml);
    if (html === null) {
      vFail(r, 'webui-index', `index.html not found: ${indexHtml}`);
    } else {
      if (/<link[^>]+rel=["']stylesheet["']/i.test(html)) vFail(r, 'webui-css', 'index.html uses linked stylesheets. JUCE WebView often ignores linked CSS (webview-011). Inline ALL CSS in a style block.');
      else vPass(r, 'webui-css');
      if (/<script[^>]+type=["']module["']/i.test(html)) vFail(r, 'webui-modules', 'index.html uses script type=module. ES6 modules fail in JUCE WebView (webview-008). Inline JavaScript instead.');
      else vPass(r, 'webui-modules');
      if (/<script[^>]+src=/i.test(html)) vWarn(r, 'webui-src', 'index.html has script src. Prefer inlined JS (webview-008). External JS often fails in WebView.');
      else vPass(r, 'webui-src');
    }
    if (!fs.existsSync(path.join(webUI, 'js', 'index.js'))) vFail(r, 'webui-indexjs', `js/index.js not found under ${webUI}`);
    else vPass(r, 'webui-indexjs');
    if (!fs.existsSync(path.join(webUI, 'js', 'juce', 'index.js'))) vWarn(r, 'webui-juce', 'js/juce/index.js not found - JUCE frontend library missing. Prefer npm @juce-framework/webview or copy _tools/JUCE/modules/juce_gui_extra/native/typescript/webview-interop/dist/index.js (JUCE 9).');
    else vPass(r, 'webui-juce');
  }
  return r;
}

// Port of scripts/validate-webview-member-order.ps1
function validateMemberOrder(pluginDir) {
  const r = newReport();
  const headerPath = path.join(pluginDir, 'Source', 'PluginEditor.h');
  const raw = readText(headerPath);
  if (raw === null) {
    vInfo(r, 'header-exists', 'PluginEditor.h not found - skipping validation');
    return r;
  }
  const lines = raw.split(/\r?\n/);
  let inPrivate = false;
  const relayLines = [];
  let webViewLine = -1;
  const attachmentLines = [];
  lines.forEach((line, lineNum) => {
    if (/^\s*private\s*:/i.test(line)) inPrivate = true;
    else if (/^\s*(public|protected)\s*:/i.test(line)) inPrivate = false;
    if (inPrivate) {
      const trimmed = line.trim();
      if (/^\/\//.test(trimmed) || trimmed === '' || /^\s*\w+\s+\w+\s*\(/.test(line)) return;
      if (/(unique_ptr<.*)?Relay(>)?\s+\w+\s*(\{|;)/i.test(trimmed)) relayLines.push(lineNum);
      else if (/unique_ptr<.*(WebBrowserComponent|SinglePageBrowser|webView).*>\s+webView\s*;/i.test(trimmed)) {
        if (webViewLine < 0) webViewLine = lineNum;
      }
      else if (/Attachment>\s+\w+\s*;/i.test(trimmed)) attachmentLines.push(lineNum);
    }
  });
  if (webViewLine < 0) {
    vInfo(r, 'is-webview', 'Not a WebView plugin - skipping validation');
    return r;
  }
  if (relayLines.length > 0) {
    if (relayLines[relayLines.length - 1] < webViewLine) vPass(r, 'relays-before-webview', 'All relays declared before WebView');
    else vFail(r, 'relays-before-webview', 'Some relays declared AFTER WebView! This will cause DAW crashes on plugin unload. Required order: 1. Relays 2. WebView 3. Attachments. See .agents/troubleshooting/resolutions/webview-member-order-crash.md');
  } else vInfo(r, 'relays-before-webview', 'No relays found');
  if (attachmentLines.length > 0) {
    if (webViewLine < attachmentLines[0]) vPass(r, 'webview-before-attachments', 'WebView declared before all attachments');
    else vFail(r, 'webview-before-attachments', 'Some attachments declared BEFORE WebView! This will cause DAW crashes on plugin unload. Required order: 1. Relays 2. WebView 3. Attachments.');
  } else vInfo(r, 'webview-before-attachments', 'No attachments found');
  return r;
}

// Port of scripts/validate-visage-setup.ps1
function validateVisage(pluginDir) {
  const r = newReport();
  const statusPath = path.join(pluginDir, 'status.json');
  const statusRaw = readText(statusPath);
  if (statusRaw === null) {
    vWarn(r, 'status-framework', 'status.json not found - cannot confirm ui_framework');
  } else {
    try {
      const state = JSON.parse(statusRaw);
      if (state.ui_framework !== 'visage') vWarn(r, 'status-framework', `ui_framework is '${state.ui_framework}' (expected 'visage')`);
      else vPass(r, 'status-framework');
    } catch {
      vFail(r, 'status-framework', 'status.json is not valid JSON');
    }
  }
  const rootCmake = readText(path.join(ROOT, 'CMakeLists.txt'));
  if (rootCmake === null) {
    vFail(r, 'root-cmake', 'Root CMakeLists.txt not found');
  } else {
    if (!/APC_ENABLE_VISAGE/i.test(rootCmake)) vFail(r, 'root-cmake-option', 'Root CMakeLists.txt missing APC_ENABLE_VISAGE option');
    else vPass(r, 'root-cmake-option');
    if (!/add_subdirectory\("\$\{VISAGE_DIR\}"\)/.test(rootCmake)) vWarn(r, 'root-cmake-subdir', 'Root CMakeLists.txt does not add Visage subdirectory (APC_ENABLE_VISAGE may be OFF)');
    else vPass(r, 'root-cmake-subdir');
    if (!/visage::visage/.test(rootCmake)) vWarn(r, 'root-cmake-alias', 'Root CMakeLists.txt does not create visage::visage alias target');
    else vPass(r, 'root-cmake-alias');
  }
  const cmake = readText(path.join(pluginDir, 'CMakeLists.txt'));
  if (cmake === null) {
    vFail(r, 'cmake-exists', 'CMakeLists.txt not found');
  } else {
    if (!/visage::visage/.test(cmake)) vFail(r, 'cmake-link', "CMakeLists.txt missing 'visage::visage' link");
    else vPass(r, 'cmake-link');
    if (/NEEDS_WEBVIEW2\s+TRUE|JUCE_WEB_BROWSER=1|juce::juce_gui_extra/i.test(cmake)) vWarn(r, 'cmake-no-webview', 'CMakeLists.txt contains WebView-specific flags/modules');
    else vPass(r, 'cmake-no-webview');
  }
  if (!fs.existsSync(path.join(pluginDir, 'Source', 'VisageControls.h'))) vFail(r, 'visage-controls', 'VisageControls.h not found');
  else vPass(r, 'visage-controls');
  const h = readText(path.join(pluginDir, 'Source', 'PluginEditor.h'));
  if (h === null) {
    vWarn(r, 'editor-header', 'PluginEditor.h not found');
  } else {
    if (!/VisageJuceHost/i.test(h)) vWarn(r, 'editor-host', 'PluginEditor.h does not include VisageJuceHost.h');
    else vPass(r, 'editor-host');
    if (!/VisagePluginEditor/i.test(h)) vWarn(r, 'editor-base', 'PluginEditor.h does not inherit from VisagePluginEditor');
    else vPass(r, 'editor-base');
  }
  if (readText(path.join(pluginDir, 'Source', 'PluginEditor.cpp')) === null) vWarn(r, 'editor-cpp', 'PluginEditor.cpp not found');
  else vPass(r, 'editor-cpp');
  return r;
}

// Port of scripts/validate-plugin-status.ps1 (schema + file-accuracy checks).
// Improvement over the .ps1: hidden directories (e.g. .git, .cursor inside an
// external plugins_dir) are skipped in all-plugins mode instead of failing
// for having no status.json.
const STATUS_REQUIRED_FIELDS = ['plugin_name', 'version', 'current_phase', 'ui_framework', 'complexity_score', 'created_at', 'last_modified', 'phase_history', 'validation', 'framework_selection', 'error_recovery'];

function validateOnePluginStatus(pluginDir, pluginName) {
  const r = newReport();
  const statusRaw = readText(path.join(pluginDir, 'status.json'));
  if (statusRaw === null) {
    vFail(r, 'status-exists', 'No status.json found');
    return r;
  }
  let status;
  try {
    status = JSON.parse(statusRaw);
  } catch {
    vFail(r, 'status-json', 'Invalid JSON in status.json');
    return r;
  }
  for (const field of STATUS_REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(status, field)) vFail(r, 'status-schema', `Missing required field: ${field}`);
  }
  if (r.issues.length === 0) vPass(r, 'status-schema', 'Schema compliant');
  const hasIdeas = fs.existsSync(path.join(pluginDir, '.ideas'));
  const hasDesign = fs.existsSync(path.join(pluginDir, 'Design'));
  const hasSource = fs.existsSync(path.join(pluginDir, 'Source'));
  let expectedPhase = 'ideation';
  if (hasIdeas && hasDesign && hasSource) expectedPhase = 'code_complete';
  else if (hasIdeas && hasDesign) expectedPhase = 'design_complete';
  else if (hasIdeas) expectedPhase = 'plan_complete';
  if (status.current_phase !== expectedPhase) vFail(r, 'status-phase', `Phase mismatch: status shows '${status.current_phase}', files suggest '${expectedPhase}'`);
  else vPass(r, 'status-phase');
  const flagFiles = [
    ['creative_brief_exists', '.ideas/creative-brief.md'],
    ['parameter_spec_exists', '.ideas/parameter-spec.md'],
    ['architecture_defined', '.ideas/architecture.md'],
  ];
  for (const [flag, rel] of flagFiles) {
    if (status.validation && status.validation[flag] && !fs.existsSync(path.join(pluginDir, ...rel.split('/')))) {
      vFail(r, 'status-flags', `Validation flag ${flag} is true but file missing`);
    }
  }
  if (!r.issues.some((i) => i.check === 'status-flags')) vPass(r, 'status-flags');
  if (r.issues.length === 0) vInfo(r, 'summary', `${pluginName}: status accurate and schema compliant`);
  return r;
}

function cmdValidate(args) {
  const kind = args.find((a) => !a.startsWith('--'));
  const asJson = args.includes('--json');
  const pi = args.indexOf('--plugin');
  const plugin = pi !== -1 ? args[pi + 1] : undefined;
  const spec = VALIDATORS[kind];
  if (!spec) {
    console.error(err(`Usage: apc validate <${Object.keys(VALIDATORS).join('|')}> [--plugin <Name>] [--json]`));
    process.exit(2);
  }
  // Shell-bound validator: tests the PowerShell module itself (see table above).
  if (!spec.native) {
    runBackend({ ps1: spec.ps1, sh: spec.ps1, windowsOnly: true, psArgs: [] });
    return;
  }
  if (spec.needsPlugin && !plugin) {
    console.error(err(`'${kind}' requires --plugin <Name>.`));
    process.exit(2);
  }
  if (!asJson) {
    console.log(`apc validate ${kind}${plugin ? ` (${plugin})` : ' (all plugins)'}`);
    console.log('');
  }
  let code = 0;
  if (kind === 'plugin' && !plugin) {
    const pluginsDir = resolvePaths().pluginsDir;
    let entries = [];
    try {
      entries = fs.readdirSync(pluginsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch {
      console.error(err(`Plugins directory not found: ${pluginsDir}`));
      process.exit(1);
    }
    for (const name of entries) {
      const r = validateOnePluginStatus(pluginPath(name), name);
      if (!asJson) console.log(`--- ${name}: ${r.issues.length === 0 ? 'OK' : `${r.issues.length} issue(s)`}`);
      code = printReport(kind, name, r, asJson) === 1 ? 1 : code;
    }
  } else {
    const dir = pluginPath(plugin);
    if (!fs.existsSync(dir)) {
      console.error(err(`Plugin '${plugin}' not found at ${dir}`));
      process.exit(1);
    }
    let r;
    if (kind === 'webview') r = validateWebview(dir);
    else if (kind === 'webview-order') r = validateMemberOrder(dir);
    else if (kind === 'visage') r = validateVisage(dir);
    else r = validateOnePluginStatus(dir, plugin);
    code = printReport(kind, plugin, r, asJson);
  }
  process.exit(code);
}

function cmdBackupOrRollback(which, args) {
  const [name, version] = args.filter((a) => !a.startsWith('--'));
  if (!name || !version) {
    console.error(err(`Usage: apc ${which} <Plugin> <Version>`));
    process.exit(2);
  }
  runBackend({
    ps1: which, sh: which,
    psArgs: ['-PluginName', name, '-Version', version],
    shArgs: [name, version],
  });
}

// ─── version sync (keep derived artifacts aligned) ─────────────────────────
function cmdVersionSync(args) {
  const fix = args.includes('--fix');
  const { version } = readPackageVersion();
  let failed = false;

  // 1. hub/version.js (what the Hub web UI displays)
  const hubVersionPath = path.join(ROOT, 'hub', 'version.js');
  const hubContent =
`// AUTO-GENERATED by \`apc version sync\` — do not edit by hand.
// Canonical source: package.json ("version"). The Hub web UI reads
// window.APC_VERSION from this file via a <script> tag (works over
// file:// where fetch() of JSON is blocked). If this file is missing the
// Hub must render [NOT FOUND] + this path (read-only honesty).
var APC_VERSION = ${JSON.stringify(version)};
if (typeof window !== "undefined") { window.APC_VERSION = APC_VERSION; }
`;
  const current = fs.existsSync(hubVersionPath) ? fs.readFileSync(hubVersionPath, 'utf8') : null;
  if (current !== hubContent) {
    if (fix || !fs.existsSync(hubVersionPath)) {
      fs.mkdirSync(path.dirname(hubVersionPath), { recursive: true });
      fs.writeFileSync(hubVersionPath, hubContent);
      console.log(ok(`wrote ${path.relative(ROOT, hubVersionPath)} (${version})`));
    } else {
      console.error(err(`hub/version.js is stale (run with --fix).`));
      failed = true;
    }
  } else {
    console.log(ok(`hub/version.js matches ${version}`));
  }

  // 2. CMake project VERSION (drifted before: 1.0.0 vs package.json 1.4.0)
  const cmakePath = path.join(ROOT, 'CMakeLists.txt');
  const cmake = fs.readFileSync(cmakePath, 'utf8');
  if (cmake.includes('package.json')) {
    console.log(ok('CMakeLists.txt reads version from package.json (dynamic, no sync needed)'));
  } else {
    const m = cmake.match(/project\([^)]*VERSION\s+([0-9]+\.[0-9]+\.[0-9]+)/);
    if (!m) {
      console.error(err('CMakeLists.txt has no parseable project VERSION.'));
      failed = true;
    } else if (m[1] !== version) {
      if (fix) {
        fs.writeFileSync(cmakePath, cmake.replace(m[0], m[0].replace(m[1], version)));
        console.log(ok(`patched CMakeLists.txt project VERSION ${m[1]} → ${version}`));
      } else {
        console.error(err(`CMakeLists.txt VERSION is ${m[1]}, package.json is ${version} (run with --fix).`));
        failed = true;
      }
    } else {
      console.log(ok(`CMakeLists.txt VERSION matches ${version}`));
    }
  }

  if (failed) process.exit(1);
  console.log(dim(`framework version ${version} — canonical source: package.json`));
}

// ─── Generations: post-ship iteration (patch / evolve) ─────────────────────
// Rule: a shipped generation is read-only. New work always opens a
// generation first (/apc-patch for bugs, /apc-evolve for features).
const SHIPPED_PHASES = ['ship_complete', 'complete'];

function readStatus(pluginDir) {
  const p = path.join(pluginDir, 'status.json');
  const raw = readText(p);
  if (raw === null) return { error: `status.json not found at ${p}` };
  try {
    return { status: JSON.parse(raw) };
  } catch {
    return { error: `status.json is not valid JSON at ${p}` };
  }
}

function writeStatus(pluginDir, status) {
  status.last_modified = new Date().toISOString();
  fs.writeFileSync(path.join(pluginDir, 'status.json'), JSON.stringify(status, null, 2) + '\n');
}

function loadPluginStatus(name) {
  const dir = pluginPath(name);
  if (!fs.existsSync(dir)) {
    console.error(err(`Plugin '${name}' not found at ${dir}`));
    process.exit(1);
  }
  const { status, error } = readStatus(dir);
  if (error) {
    console.error(err(error));
    process.exit(1);
  }
  return { dir, status };
}

function isShipped(status) {
  return SHIPPED_PHASES.includes(status.current_phase);
}

function openGen(status) {
  return (status.current_generation && status.current_generation.status === 'open')
    ? status.current_generation
    : null;
}

function isFrozen(status) {
  return isShipped(status) && !openGen(status);
}

// Version math preserves the input's prefix and never confuses the two kinds:
// patch: v1.0 -> v1.0.1, v1.0.0 -> v1.0.1, v1 -> v1.0.1
// evolve: v1.0 -> v1.1, v1.0.0 -> v1.1.0, v1 -> v2, v0.0.0 -> v0.1.0
function splitVersion(v) {
  const m = String(v || '').match(/^([^0-9]*)([0-9]+(?:\.[0-9]+)*)(.*)$/);
  if (!m) return { prefix: 'v', parts: [0, 0, 0], suffix: '', width: 3 };
  const parts = m[2].split('.').map(Number);
  return { prefix: m[1], parts, suffix: m[3], width: parts.length };
}

function joinVersion(s) {
  return s.prefix + s.parts.join('.') + s.suffix;
}

function bumpPatch(v) {
  const s = splitVersion(v);
  if (s.parts.length >= 3) {
    s.parts[s.parts.length - 1] += 1;
  } else {
    while (s.parts.length < 2) s.parts.push(0);
    s.parts.push(1);
  }
  return joinVersion(s);
}

function bumpMinor(v) {
  const s = splitVersion(v);
  while (s.parts.length < 3) s.parts.push(0);
  const idx = s.width === 1 ? 0 : 1;
  s.parts[idx] += 1;
  for (let i = idx + 1; i < s.parts.length; i++) s.parts[i] = 0;
  if (s.width === 1) s.parts = [s.parts[0]];
  else if (s.width === 2) s.parts = s.parts.slice(0, 2);
  return joinVersion(s);
}

// Backfill-on-first-open: synthesize the frozen v1.0-style record from
// current state so pre-generations plugins migrate with zero upfront work.
function backfillGeneration(status, name) {
  if (Array.isArray(status.generations) && status.generations.length > 0) return false;
  status.generations = [{
    version: status.version || 'v0.0.0',
    kind: 'initial',
    status: 'shipped',
    codename: null,
    shipped_at: status.last_modified || null,
    git_tag: `${status.version || 'v0.0.0'}-${name}`,
    phase_history: status.phase_history || [],
  }];
  return true;
}

function cmdOpenGeneration(kind, args) {
  const asJson = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('--'));
  const name = positional[0];
  if (!name) {
    console.error(err(`Usage: apc ${kind} <Plugin> [--codename "Name"] [--json]`));
    process.exit(2);
  }
  const ci = args.indexOf('--codename');
  const codename = ci !== -1 ? args[ci + 1] : undefined;
  if (kind === 'patch' && codename) {
    console.error(warn('patch generations do not take codenames - ignoring --codename'));
  }
  const { dir, status } = loadPluginStatus(name);
  const already = openGen(status);
  if (already) {
    console.error(err(`Generation ${already.version} (${already.kind}) is already open on '${name}'. Re-ship it before opening another.`));
    process.exit(1);
  }
  if (!isShipped(status)) {
    console.error(err(`'${name}' is not shipped (phase: ${status.current_phase}). ${kind} opens only on shipped plugins - run /apc-resume to continue it.`));
    process.exit(1);
  }
  const backfilled = backfillGeneration(status, name);
  const newVersion = kind === 'patch' ? bumpPatch(status.version) : bumpMinor(status.version);
  // Native snapshot: frozen record + rollback point, no shell needed.
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '_');
  const backupFile = `status.json.bak-${stamp}`;
  fs.copyFileSync(path.join(dir, 'status.json'), path.join(dir, backupFile));
  const now = new Date().toISOString();
  const gen = {
    version: newVersion,
    kind,
    status: 'open',
    codename: kind === 'evolve' ? (codename || null) : null,
    opened_at: now,
    backup_file: backupFile,
  };
  status.current_generation = gen;
  status.version = newVersion;
  status.current_phase = kind === 'patch' ? 'code' : 'plan';
  status.validation = status.validation || {};
  if (kind === 'patch') {
    // Design did not change: keep design flags, reset only test/ship gates.
    status.validation.tests_passed = false;
    status.validation.ship_ready = false;
  } else {
    for (const f of ['design_complete', 'code_complete', 'tests_passed', 'ship_ready']) status.validation[f] = false;
    const briefName = `.ideas/${newVersion}-brief.md`;
    if (!fs.existsSync(path.join(dir, briefName))) {
      fs.writeFileSync(path.join(dir, briefName),
        `# ${name} ${newVersion} Feature Brief\n\nCodename: ${gen.codename || '(none)'}\n\n## Goal\n\n## Changes\n\n- \n\n## Acceptance\n\n- [ ] prior validation still green (re-run /apc-test)\n`);
    }
    gen.brief = briefName;
  }
  status.phase_history = status.phase_history || [];
  status.phase_history.push({ phase: `${kind}_opened`, version: newVersion, completed_at: now });
  writeStatus(dir, status);
  if (asJson) {
    console.log(JSON.stringify({ plugin: name, generation: gen, backfilled, backup_file: backupFile }, null, 2));
  } else {
    if (backfilled) console.log(dim(`backfilled frozen ${status.generations[0].version} record (pre-generations plugin)`));
    console.log(ok(`opened ${kind} generation ${newVersion}${gen.codename ? ` "${gen.codename}"` : ''} on '${name}'`));
    console.log(`  snapshot: ${backupFile} | phase -> ${status.current_phase}`);
    if (gen.brief) console.log(`  brief: ${gen.brief}`);
    console.log(`  next: ${kind === 'patch' ? `/apc-impl ${name} (fix, tiny UI touch-ups ok) then /apc-test ${name}` : `/apc-plan ${name} (feature architecture)`}`);
  }
}

// Called by the ship flow after gates pass. Freezes the open generation:
// it becomes a permanent, read-only record and the machine returns to rest.
function cmdFreeze(args) {
  const asJson = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('--'));
  const name = positional[0];
  if (!name) {
    console.error(err('Usage: apc freeze <Plugin> [--tag TAG] [--json]'));
    process.exit(2);
  }
  const ti = args.indexOf('--tag');
  const { dir, status } = loadPluginStatus(name);
  const gen = openGen(status);
  if (!gen) {
    console.error(err(`No open generation on '${name}'. Nothing to freeze.`));
    process.exit(1);
  }
  const now = new Date().toISOString();
  const frozen = {
    ...gen,
    status: 'shipped',
    shipped_at: now,
    git_tag: (ti !== -1 && args[ti + 1]) ? args[ti + 1] : `${gen.version}-${name}`,
  };
  status.generations = status.generations || [];
  status.generations.push(frozen);
  status.current_generation = null;
  status.current_phase = 'ship_complete';
  if (status.validation) status.validation.ship_ready = true;
  status.phase_history = status.phase_history || [];
  status.phase_history.push({ phase: 'shipped', version: gen.version, completed_at: now });
  writeStatus(dir, status);
  if (asJson) {
    console.log(JSON.stringify({ plugin: name, frozen }, null, 2));
  } else {
    console.log(ok(`froze generation ${gen.version} on '${name}' (tag: ${frozen.git_tag})`));
    console.log(`  machine at rest: phase -> ship_complete (read-only until next patch/evolve)`);
  }
}

function statusView(name, dir, status) {
  const gen = openGen(status);
  return {
    plugin: name,
    version: status.version,
    current_phase: status.current_phase,
    ui_framework: status.ui_framework,
    frozen: isFrozen(status),
    open_generation: gen,
    generations: (status.generations || []).map((g) => ({
      version: g.version, kind: g.kind, status: g.status,
      codename: g.codename || null, shipped_at: g.shipped_at || null, git_tag: g.git_tag || null,
    })),
  };
}

// Machine- and human-readable generation timeline. Agents use --json;
// the /apc-status workflow renders this view.
function cmdStatusCmd(args) {
  const asJson = args.includes('--json');
  const pi = args.indexOf('--plugin');
  const names = pi !== -1 && args[pi + 1] ? [args[pi + 1]] : null;
  const list = names || (() => {
    try {
      return fs.readdirSync(resolvePaths().pluginsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch {
      console.error(err(`Plugins directory not found: ${resolvePaths().pluginsDir}`));
      process.exit(1);
    }
  })();
  const views = [];
  for (const name of list) {
    const dir = pluginPath(name);
    const { status, error } = readStatus(dir);
    if (error) {
      if (names) {
        console.error(err(error));
        process.exit(1);
      }
      continue;
    }
    views.push(statusView(name, dir, status));
  }
  if (asJson) {
    console.log(JSON.stringify(names ? views[0] : views, null, 2));
    return;
  }
  for (const v of views) {
    const state = v.open_generation
      ? `${v.open_generation.kind} ${v.open_generation.version} OPEN @ ${v.current_phase}`
      : (v.frozen ? 'SHIPPED (read-only)' : v.current_phase);
    console.log(`${v.plugin} ${v.version} -- ${state}`);
    const trail = [...v.generations.map((g) => `${g.version}${g.status === 'shipped' ? '' : `(${g.status})`}`)];
    if (v.open_generation) trail.push(`${v.open_generation.version}(open)`);
    if (trail.length > 0) console.log(`  lineage: ${trail.join(' -> ')}`);
  }
}

// ─── Help ──────────────────────────────────────────────────────────────────
function help() {
  const { version } = readPackageVersion();
  console.log(`apc ${version} — Audio Plugin Coder CLI`);
  console.log('');
  console.log('Usage: apc <command> [options]');
  console.log('');
  console.log('  version [--json]              print framework version');
  console.log('  version sync [--fix]          regenerate hub/version.js, check CMake pin');
  console.log('  paths [--json] [--plugin N]   resolved plugins/build/release dirs');
  console.log('  doctor [--fix]                version header + system-check (fix: safe auto-fixes only)');
  console.log('  build <Plugin> [--no-install] [--skip-tests] [--strict]');
  console.log('  validate <kind> [--plugin N] [--json]  webview|webview-order|visage|plugin|state');
  console.log('    webview|webview-order|visage|plugin run natively (cross-platform);');
  console.log('    state tests the PowerShell module itself and stays shell-bound.');
  console.log('  backup <Plugin> <Version>');
  console.log('  rollback <Plugin> <Version>');
  console.log('  patch <Plugin> [--json]           open a bugfix generation on a shipped plugin');
  console.log('  evolve <Plugin> [--codename N] [--json]  open a feature generation on a shipped plugin');
  console.log('  freeze <Plugin> [--tag T] [--json]  freeze the open generation (called by ship flow)');
  console.log('  status [--plugin N] [--json]      generation timeline');
  console.log('  help                          this text');
  console.log('');
  console.log(`Canonical version source: package.json. Hub reads hub/version.js.`);
}

// ─── Main ──────────────────────────────────────────────────────────────────
function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return help();
  if (cmd === '--version' || cmd === '-v') return cmdVersion(rest);
  switch (cmd) {
    case 'version':
      if (rest[0] === 'sync') return cmdVersionSync(rest.slice(1));
      return cmdVersion(rest);
    case 'paths': return cmdPaths(rest);
    case 'doctor': return cmdDoctor(rest);
    case 'build': return cmdBuild(rest);
    case 'validate': return cmdValidate(rest);
    case 'backup': return cmdBackupOrRollback('backup', rest);
    case 'rollback': return cmdBackupOrRollback('rollback', rest);
    case 'patch': return cmdOpenGeneration('patch', rest);
    case 'evolve': return cmdOpenGeneration('evolve', rest);
    case 'freeze': return cmdFreeze(rest);
    case 'status': return cmdStatusCmd(rest);
    default:
      console.error(err(`Unknown command: ${cmd}`));
      help();
      process.exit(2);
  }
}

main();
