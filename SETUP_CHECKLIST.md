# Setup Checklist - Analyze & Remove Preferences Workflow

Complete this checklist to run the full `analyze-preferences` → `remove-preferences` workflow.

## ✅ Prerequisites (5 minutes)

- [ ] Node.js v14+ installed
- [ ] npm installed
- [ ] VS Code installed (for reviewing deletion list)
- [ ] Access to SFCC Account Manager
- [ ] Access to Business Manager
- [ ] Internet connection (for OCAPI calls)

## ✅ Step 1: Get API Credentials (10 minutes)

**Location:** https://account.salesforce.com/

1. [ ] Log in to Salesforce Account Manager
2. [ ] Navigate to **API Clients** section
3. [ ] Create new API client OR use existing one:
   - [ ] Copy **API Client ID** (your `clientId`)
   - [ ] Copy **Client Secret** (your `clientSecret`)
4. [ ] Keep these credentials secure (don't commit to git)

**Note:** If you don't have access, contact your Salesforce administrator.

---

## ✅ Step 2: Configure OCAPI Endpoints in Business Manager (15 minutes)

**Location:** Business Manager → Administration → Open Commerce API Settings → Data API

1. [ ] Log in to Business Manager (https://your-instance.salesforceecommerce.com/on/demandware.admin)
2. [ ] Navigate to **Data API** section
3. [ ] Find or create your API client configuration
4. [ ] Add the required resources from `ocapi_config.json`:

**Minimum Resources Needed:**
- [ ] `/sites` (GET)
- [ ] `/sites/*` (GET)
- [ ] `/system_object_definitions/*` (GET)
- [ ] `/system_object_definitions/*/attribute_definitions` (GET)
- [ ] `/system_object_definitions/*/attribute_definitions/*` (GET, DELETE, PUT, PATCH)
- [ ] `/system_object_definitions/*/attribute_groups` (GET)
- [ ] `/system_object_definitions/*/attribute_groups/*` (GET)
- [ ] `/sites/*/site_preferences/preference_groups/*/*` (GET, PATCH)

5. [ ] Set `read_attributes` to `(**)`
6. [ ] Set `write_attributes` to `(**)`
7. [ ] Save configuration
8. [ ] Wait 1-2 minutes for changes to propagate
9. [ ] (Optional) Restart your sandbox

**Troubleshooting:**
- If you don't see OCAPI Settings: contact Salesforce to enable OCAPI
- If you can't add resources: check that you have Business Manager admin rights

---

## ✅ Step 3: Clone/Install Cleanup Script (5 minutes)

1. [ ] Clone or download this repository:
   ```bash
   git clone <repo-url>
   cd Cleanup-Script
   ```

2. [ ] Install dependencies:
   ```bash
   npm install
   ```

3. [ ] Verify installation:
   ```bash
   node src/main.js
   ```
   (Should show available commands)

---

## ✅ Step 4: Add Realm Configuration (5 minutes)

1. [ ] Run the add-realm command:
   ```bash
   node src/main.js add-realm
   ```

2. [ ] When prompted, enter:
   - **Realm:** `bcwr-080` (or your sandbox name)
   - **Hostname:** `bcwr-080.dx.commercecloud.salesforce.com` (your SFCC instance)
   - **Client ID:** `[paste from Step 1]`
   - **Client Secret:** `[paste from Step 1]`

3. [ ] Verify config was saved:
   ```bash
   cat config.json
   ```
   (Should show your realm in the realms array)

**Note:** `config.json` contains credentials - don't commit to git!

---

## ✅ Step 5: Test API Connection (2 minutes)

1. [ ] List your configured sites:
   ```bash
   node src/main.js list-sites
   ```

2. [ ] Expected output:
   - No errors
   - CSV file created in `results/[instance]/`
   - Shows: "✓ All sites listed successfully"

**If you get errors:**
- "401 Unauthorized" → Check Client ID/Secret and OCAPI permissions
- "Connection timeout" → SFCC might be down, try again in 5 minutes
- "Realm not found" → Run `add-realm` again

---

## ✅ Ready to Analyze Preferences! 🚀

Once all steps above are complete, run the main workflow:

### Step A: Analyze Preferences (15-30 minutes)
```bash
node src/main.js analyze-preferences
```

**What happens:**
1. Fetches all sites and preferences from your realm
2. Scans your cartridge code for preference references
3. Generates `{instance}_preferences_for_deletion.txt`
4. (Optional) Creates backup files for each realm

**Output files created:**
- `results/{instance}/ALL_REALMS/{instance}_preferences_for_deletion.txt` ← KEY FILE

### Step B: Review Deletion List (5 minutes)

1. [ ] Open the deletion list file:
   ```
   results/{instance}/ALL_REALMS/{instance}_preferences_for_deletion.txt
   ```

2. [ ] Review in VS Code:
   - Check for preferences you want to keep
   - Delete any lines you want to preserve
   - Save the file

### Step C: Remove Preferences (5-10 minutes)
```bash
node src/main.js remove-preferences
```

**What happens:**
1. Loads your edited deletion list
2. Creates backup files (in case you need to restore)
3. Shows confirmation before deletion
4. Removes preferences from your realm
5. Shows deletion summary

**Important:** You can cancel before Step 5 confirmation - backups are kept!

---

## 📋 Expected Files & Structure

After running the full workflow:

```
Cleanup-Script/
├── config.json                      (your realm config - DO NOT COMMIT)
├── results/
│   └── development/
│       ├── ALL_REALMS/
│       │   ├── development_preferences_for_deletion.txt
│       │   ├── development_cartridge_preferences.txt
│       │   ├── development_preference_usage.txt
│       │   └── development_unused_preferences.txt
│       ├── bcwr-080/
│       │   ├── bcwr-080_preferences_matrix.csv
│       │   ├── bcwr-080_preferences_usage.csv
│       │   └── bcwr-080_unused_preferences.txt
│       └── ...
└── backup/
    └── development/
        └── bcwr-080_SitePreferences_backup_2026-02-18.json
```

---

## 🆘 Troubleshooting

### "Realm not found"
```bash
node src/main.js add-realm
```

### "401 Unauthorized"
1. Check `config.json` for typos
2. Verify credentials in Account Manager
3. Check OCAPI permissions in Business Manager

### "Cartridge scan failed"
1. Make sure you're in the Cleanup-Script directory
2. Select a sibling repo when prompted
3. Check that repo has a `cartridges/` folder

### "Preferences for deletion file not found"
Run `analyze-preferences` first (it creates this file)

### Full troubleshooting guide
See [README.md](README.md#troubleshooting)

---

## 📞 Support

- **Common issues:** See README.md Troubleshooting section
- **Performance tips:** See README.md Performance section
- **Architecture details:** See README.md Architecture section

---

**Last Updated:** February 18, 2026
**Script Version:** 2.0 (with smart backup checking)
