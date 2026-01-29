# SFCC Agentic Development Setup V2 

This is a step-by-step guide for AI agents to automatically set up SFCC development instructions in any SFCC repository. This guide contains all templates and content needed - no external template files required.

## Prerequisites
- Repository with `/cartridges` directory containing SFCC cartridge folders
- `.github/instructions/` directory exists or can be created
- Agent has file read/write access to the repository root

## Execution Steps Overview
1. [Project Analysis & Variable Derivation](#step-1-project-analysis--variable-derivation)
2. [Create Setup Instructions in Root](#step-2-create-setup-instructions-in-root)
3. [Create Global Copilot Instructions File](#step-3-create-global-copilot-instructions-file)
4. [Generate AGENTS.md File](#step-4-generate-agentsmd-file)
5. [Index Cartridges & Create Individual Instructions](#step-5-index-cartridges--create-individual-instructions)
6. [Validation & Completion Report](#step-6-validation--completion-report)

---

## Step 1: Project Analysis & Variable Derivation

### 1.1 Derive Project Variables
Execute these derivations automatically from repository structure:

```bash
# Get project code from root folder name
PROJECT_CODE = UPPERCASE(strip_non_alphanumeric(folder_name))
DOMAIN_SUMMARY = "Omnichannel commerce"  # Default constant
```

### 1.2 Scan Cartridge Directory
```bash
# Scan /cartridges for subdirectories (depth = 1)
cartridge_list = scan_directory("/cartridges", depth=1)
```

### 1.3 Classify Each Cartridge
Apply these classification rules:

| Name Pattern | Type | Risk Level | Notes |
|-------------|------|------------|-------|
| `int_*` | INT | M-H | External integrations |
| `plugin_*` | PLUGIN | M | Optional features |
| `bm_*` | BM | M | Business Manager |
| `bc_*` | LIB/CORE | L-M | Decide based on utility vs business logic |
| `*_fix`, `*patch*` | PATCH | H | Temporary fixes |
| `app_storefront_base` | BASE | C | Never modify |
| `app_custom_*` | CORE | H | Core customizations |
| `module_*` | LIB/PD | L-M | Modules or Page Designer |
| `app_emailtemplates`, `app_translations` | CONTENT | L | Content only |
| Contains payment/auth terms | INT/CORE | C | Security critical |

### 1.4 Derive Additional Variables
```javascript
// From package.json or default
nodeEngine = read_package_json()?.engines?.node || "<16.0.0"

// Base cartridge detection
baseCartridge = cartridge_list.includes("app_storefront_base") ? "app_storefront_base" : "Unknown"

// Security-sensitive cartridges
securityCartridges = filter_cartridges_by_pattern(["adyen", "klarna", "slas", "recaptcha", "legacypassword", "stock_api"])

// Payment providers subset
paymentProviders = filter_cartridges_by_pattern(["adyen", "klarna", "paypal", "afterpay", "stripe"])

// Log root
logRoot = PROJECT_CODE.toUpperCase()

// Job presence check
jobPresence = check_for_jobsteps_directory()

// Brand cartridges (customize patterns as needed)
brandCartridges = filter_cartridges_by_pattern(["assem", "omoda"]) // Update patterns per project

// Site preferences assumption
useSitePreferences = true // Default assumption

// Initialize changelog
seedChangelog = true
```

**Agent Action Required:** Before proceeding to Step 2, ask user to confirm these derived values or provide corrections:
```
Derived project variables:
- Project Code: [PROJECT_CODE]
- Node Engine: [nodeEngine] 
- Base Cartridge: [baseCartridge]
- Security Cartridges: [securityCartridges]
- Payment Providers: [paymentProviders]
- Brand Cartridges: [brandCartridges]
- Total Cartridges Found: [count]

Continue with these values? (y/n)
If no, please specify corrections.
```

---

## Step 2: Create Setup Instructions in Root

### 2.1 Create AGENT_DEV_SETUP.md File
Create the setup instructions file in the repository root by copying this V2 guide content:

```bash
# Create AGENT_DEV_SETUP.md with complete V2 guide content
create_file("AGENT_DEV_SETUP.md", [ENTIRE_CONTENT_OF_THIS_V2_GUIDE])
```

**Agent Action Required:** Confirm file creation:
```
Creating AGENT_DEV_SETUP.md in repository root with complete setup guide.
This will serve as the authoritative setup instructions for this project.
Proceed? (y/n)
```

**Note:** If `AGENT_DEV_SETUP.md` already exists, ask for confirmation before overwriting:
```
Found existing AGENT_DEV_SETUP.md. 
- Backup existing as AGENT_DEV_SETUP_BACKUP_[TIMESTAMP].md
- Replace with this V2 version
Proceed? (y/n)
```

---

## Step 3: Create Global Copilot Instructions File

### 3.1 Create Directory Structure
```bash
mkdir -p .github/instructions/
```

### 3.2 Create Global Instructions File
Golden Rule (Non-Negotiable): The file global_all.instructions.md may ONLY be created (or recreated) by executing the script _generate_global_instructions.sh; if it already exists before a successful script run, it is INVALID and must be deleted before proceeding. Manual creation, editing, patching, reflowing, summarizing, truncating, compressing, or regenerating its content by any other means (including AI tool direct writes) is strictly forbidden. The script must: (1) emit a three-line frontmatter block exactly (---, applyTo: "**", ---), then a blank line, then the byte-exact contents of AGENT_DEV_SETUP.md; (2) compute SHA256 of the source file and of the generated body (excluding the first 4 lines/frontmatter) and require they MATCH; (3) verify line counts (source vs. generated body) are IDENTICAL; (4) append or verify a provenance marker (e.g. a final comment line beginning with # Provenance: containing the original hash and UTC timestamp); (5) abort with non-zero exit on ANY mismatch (hash, line count, missing provenance, prior manual file, or empty body) and NOT attempt auto-repair. No subsequent steps (including generating AGENTS.md or cartridge instruction files) may begin until a successful run prints both a success hash line and a "secondary verification passed" message. Any downstream artifact produced while this rule is violated is void and must be discarded after remediation.

Note: You must create the script below as `_generate_global_instructions.sh` and execute it to create the file.

Create `.github/instructions/global_all.instructions.md` with exact content:

**Execution Script (Bash/Shell):**
```bash
#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

SOURCE_FILE="AGENT_DEV_SETUP.md"
TARGET_FILE=".github/instructions/global_all.instructions.md"

if [ ! -f "$SOURCE_FILE" ]; then
  echo "ERROR: Source file $SOURCE_FILE not found" >&2
  exit 1
fi

echo "Creating global instructions file with exact content copy..."
{
  echo '---'
  echo 'applyTo: "**"'
  echo '---'
  echo ''
  cat "$SOURCE_FILE"
} > "$TARGET_FILE"

original_hash=$(shasum -a 256 "$SOURCE_FILE" | awk '{print $1}')
body_hash=$(tail -n +5 "$TARGET_FILE" | shasum -a 256 | awk '{print $1}')

if [ "$original_hash" != "$body_hash" ]; then
  echo "❌ ERROR: Hash mismatch detected" >&2
  echo "   Original: $original_hash" >&2
  echo "   Global:   $body_hash" >&2
  echo "   ABORT: Global instructions copy integrity compromised" >&2
  exit 1
fi

echo "✅ Global instructions file created with verified integrity"
echo "   File: $TARGET_FILE"
echo "   Hash: $original_hash"

# Secondary verification: line counts (excluding frontmatter)
orig_lines=$(wc -l < "$SOURCE_FILE" | tr -d ' ')
global_body_lines=$(tail -n +5 "$TARGET_FILE" | wc -l | tr -d ' ')
if [ "$orig_lines" != "$global_body_lines" ]; then
  echo "❌ ERROR: Line count mismatch (source=$orig_lines, body=$global_body_lines)" >&2
  exit 1
fi

echo "Secondary verification passed: line counts match (${orig_lines} lines)."
```

**Agent Action Required:** Execute this script and confirm successful creation:
```
Executing global instructions file creation script...
Expected output:
✅ Global instructions file created with verified integrity
   File: .github/instructions/global_all.instructions.md
   Hash: [SHA256_HASH]

Script completed successfully? (y/n)
If no, report the error message for troubleshooting.
```

### 3.3 Validation
```bash
# Compute hash of original file
original_hash = compute_sha256("AGENT_DEV_SETUP.md")

# Compute hash of global instructions file (excluding frontmatter)
instructions_body = read_file(".github/instructions/global_all.instructions.md").split("---\n")[2]
instructions_hash = compute_sha256(instructions_body)

if original_hash != instructions_hash:
    error("Hash mismatch - global instructions copy failed")
    abort_workflow()
```

---

## Step 4: Generate AGENTS.md File

See `AGENTS.md` for the agents and capabilities definitions for this project.

---

## Step 5: Index Cartridges & Create Individual Instructions

For each cartridge in the `/cartridges` directory, create a corresponding instruction file in `.github/instructions/` with the naming pattern: `{cartridge_name}.instructions.md`

---

## Step 6: Validation & Completion Report

Verify all generated files exist and have proper content:
- AGENT_DEV_SETUP.md
- .github/instructions/global_all.instructions.md
- AGENTS.md
- .github/instructions/{cartridge_name}.instructions.md (for each cartridge)

Confirm setup completion.
