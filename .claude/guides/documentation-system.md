# APC Documentation System

**Purpose**: Automatic documentation handling for all plugins built with Audio Plugin Coder

---

## Overview

The APC documentation system ensures every shipped plugin includes professional user documentation without manual configuration.

## How It Works

### 1. Documentation Folder Structure

```
plugins/[PluginName]/Documentation/
├── USER_MANUAL.md       (automatically included)
├── QUICKSTART.md        (optional)
├── TROUBLESHOOTING.md   (optional)
└── [any files you add]  (automatically included)
```

**Key Principle**: **Everything in this folder is automatically included in the installer.**

---

## Automatic Process

### During `/ship` Command

**Step 3.0: Prepare Documentation** (runs FIRST, before installer creation)

1. **Check if Documentation folder exists**
   - If YES: List all files that will be included
   - If NO: Create folder and generate basic USER_MANUAL.md

2. **Auto-generation** (only if folder doesn't exist)
   - Creates basic USER_MANUAL.md with plugin metadata
   - User can edit/replace this file
   - Encourages documentation best practices

3. **Validation**
   - Warns if Documentation folder is empty
   - Lists all files that will be included
   - Ensures nothing is forgotten

### During Installer Creation

**Installer automatically**:
1. Copies ALL files from `Documentation/` to plugin bundle
2. Creates Start Menu shortcuts to documentation
3. Keeps VST3 root folder clean (docs go inside plugin folder)

**Installation Locations**:
- **VST3**: `C:\Program Files\Common Files\VST3\[Plugin].vst3\Documentation\`
- **Standalone**: `C:\Program Files\[Plugin]\Documentation\`
- **Start Menu**: Shortcuts to "User Manual" and "Documentation Folder"

---

## For Plugin Developers

### Basic Workflow (Automatic)

1. **Build your plugin** (normal development)
2. **Run `/ship [PluginName]`**
   - Documentation folder created automatically (if needed)
   - Basic manual generated (if needed)
3. **Installer includes everything** in Documentation folder

### Professional Workflow (Recommended)

1. **Create Documentation folder** during development:
   ```powershell
   New-Item -ItemType Directory -Path "plugins\MyPlugin\Documentation" -Force
   ```

2. **Add your documentation files**:
   - `USER_MANUAL.md` - Comprehensive manual
   - `QUICKSTART.md` - Quick start guide (optional)
   - `TROUBLESHOOTING.md` - Common issues (optional)
   - Images, PDFs, any format works

3. **Run `/ship [PluginName]`**
   - All files automatically included
   - No configuration needed

### Updating Documentation

**Just edit files in the Documentation folder, then rebuild installer:**

```powershell
# Edit your docs
notepad plugins\MyPlugin\Documentation\USER_MANUAL.md

# Rebuild installer (picks up changes automatically)
.\scripts\installer\create-windows-installer.ps1 -PluginName MyPlugin -Version 1.0.1
```

---

## File Format Recommendations

### Markdown (.md files)

**Pros**:
- Easy to edit (any text editor)
- Version control friendly (Git)
- Can be converted to PDF later
- Looks great in GitHub
- Can be viewed directly by users

**Recommended**: Use Markdown for most documentation

### PDF (.pdf files)

**Pros**:
- Professional appearance
- Cannot be accidentally edited by users
- Consistent rendering everywhere

**How to Create**:
1. Write in Markdown first
2. Convert to PDF using:
   - [Pandoc](https://pandoc.org/) (command-line)
   - [Typora](https://typora.io/) (GUI editor)
   - VS Code with "Markdown PDF" extension
   - Online converters

### Both Formats (Recommended)

Include BOTH .md and .pdf versions:
```
Documentation/
├── USER_MANUAL.md   (easy to edit)
└── USER_MANUAL.pdf  (professional)
```

Users can choose which to open!

---

## Example: CloudWash Documentation

CloudWash demonstrates the complete system:

```
plugins/CloudWash/Documentation/
└── USER_MANUAL.md (300+ lines, comprehensive)
```

**Contents**:
- Installation instructions
- Interface overview
- All 4 processing modes explained
- All 13 parameters documented
- 20 factory presets described
- Tips & tricks section
- Technical specifications
- Troubleshooting guide
- Credits

**Result**: Professional documentation with zero manual configuration!

---

## Start Menu Integration

Installer creates these shortcuts:

```
Start Menu > [PluginName]/
├── [PluginName]               (launches standalone app)
├── User Manual                (opens USER_MANUAL.md)
├── Documentation Folder       (opens Documentation folder)
└── Uninstall [PluginName]
```

**User Experience**:
- Click "User Manual" in Start Menu
- Opens USER_MANUAL.md in default Markdown viewer
- Or opens USER_MANUAL.pdf in default PDF viewer

---

## Technical Details

### Installer Template Changes

**OLD (BAD)**:
```pascal
Source: "..\..\CHANGELOG.md"; \
    DestDir: "{app}\.."; \  <-- CLUTTERS VST3 ROOT!
```

**NEW (GOOD)**:
```pascal
Source: "..\..\plugins\{#PluginName}\Documentation\*"; \
    DestDir: "{app}\Documentation"; \  <-- INSIDE PLUGIN FOLDER!
    Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist ignoreversion
```

**Result**: VST3 folder stays clean, all docs inside plugin bundle.

---

## Best Practices

### DO:
- ✅ Create Documentation folder early in development
- ✅ Write in Markdown (easy to edit, version control)
- ✅ Include images/screenshots if helpful
- ✅ Update documentation when adding features
- ✅ Test documentation by reading it yourself

### DON'T:
- ❌ Skip documentation (auto-generated is bare minimum)
- ❌ Put docs in Source/ or Design/ folders (wrong location)
- ❌ Manually configure installer (it's automatic)
- ❌ Forget to rebuild installer after updating docs

---

## Future Enhancements

### Potential Additions:
1. **Auto-generate parameter tables** from code
2. **Auto-capture screenshots** of UI
3. **Video tutorial support** (embed YouTube links)
4. **Multi-language support** (EN, DE, FR, etc.)
5. **PDF auto-conversion** (Markdown → PDF during build)

---

## For AI Agents

### When Processing `/ship` Command:

1. **ALWAYS check for Documentation folder**
2. **Create if missing** with basic USER_MANUAL.md
3. **List files** that will be included
4. **Warn if empty** (encourage user to add docs)
5. **Never skip** this step

### When Creating New Plugin:

During `/design` or `/plan` phase:
- Create placeholder Documentation folder
- Add template USER_MANUAL.md with parameter placeholders
- User fills in details during development

### Documentation Quality Checklist:

- [ ] Documentation folder exists
- [ ] USER_MANUAL.md exists and is not empty
- [ ] Installation instructions included
- [ ] Parameters documented
- [ ] Examples/presets explained
- [ ] Troubleshooting section included

---

**Summary**: The APC documentation system makes professional plugin documentation effortless. Add files to `Documentation/` folder, run `/ship`, and everything is automatically included with proper organization.
