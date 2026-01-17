# Extension Merge Plan: Combining Two Salesforce Extensions

## Overview

This document outlines the plan to merge two Chrome extensions into a single unified extension:

1. **311 SR to Integration Request Finder** (current folder)
2. **311 Integration Request Validator** (Expand And Validate INT-REQ JSON)

---

## Current Extension Analysis

### Extension 1: SR to Integration Request Finder

| Property | Value |
|----------|-------|
| **Name** | 311 SR to Integration Request Finder |
| **Version** | 1.0 |
| **Manifest** | V3 |
| **Purpose** | Right-click on SR number → Search for Integration Request |

**Files:**
- `manifest.json` - Extension configuration
- `background.js` - Service worker (context menu handling)
- `content.js` - Content script (SR detection, search execution)
- `images/` - Icons (sr_to_ir_finder_icon*.png)

**Permissions:**
- `contextMenus`
- `activeTab`
- `scripting`
- `tabs`

**Target Sites:**
```
https://*.salesforce.com/*
https://*.force.com/*
https://*.lightning.force.com/*
```

---

### Extension 2: Integration Request Validator

| Property | Value |
|----------|-------|
| **Name** | 311 Integration Request Validator |
| **Version** | 2.3 |
| **Manifest** | V3 |
| **Purpose** | Auto-format JSON and validate fields in INT-REQ pages |

**Files:**
- `manifest.json` - Extension configuration
- `background.js` - Service worker (icon click handling)
- `content.js` - Content script (JSON formatting & validation)
- `popup.html` / `popup.js` - Manual trigger popup (appears unused/legacy)
- `options.html` / `options.js` - Color options page (legacy feature)
- `button.css` - Styling for popup/options
- `images/` - Icons (integration_request_validator_icon*.png)

**Permissions:**
- `storage`
- `activeTab`
- `scripting`
- `tabs`

**Target Sites:**
```
https://staff-cms.lightning.force.com/lightning/r/*
```

---

## Compatibility Assessment

### ✅ Compatible Aspects

| Aspect | Status | Notes |
|--------|--------|-------|
| Manifest Version | ✅ | Both use Manifest V3 |
| Target Sites | ✅ | Extension 2's URL is subset of Extension 1's patterns |
| Background Scripts | ✅ | Different handlers, can be merged |
| Permissions | ✅ | Can be combined (union of both) |
| Content Scripts | ✅ | Independent functionality, no conflicts |

### ⚠️ Items Requiring Attention

| Item | Issue | Resolution |
|------|-------|------------|
| Extension Name | Two different names | Choose unified name |
| Icons | Two different icon sets | Keep both or choose one |
| Context Menu vs Icon Click | Different trigger mechanisms | Both can coexist |
| Options Page | Extension 2 has legacy options | Can be removed or kept |
| Storage Permission | Only Extension 2 needs it | Include if keeping options |

---

## Proposed Merged Extension

### Unified Identity

| Property | Value |
|----------|----------------|
| **Name** | 311 SR to Integration Request Finder |
| **Description** | Right-click SR numbers to find Integration Requests, auto-format JSON and validate fields |
| **Version** | 1.1.0 |

### File Structure

```
SR to Integration Request Finder/
├── manifest.json              # Combined manifest
├── background.js              # Merged service worker
├── content.js                 # SR to IR finder functionality (existing)
├── content-json-formatter.js  # JSON formatter functionality (new)
└── images/
    ├── sr_to_ir_finder_icon16.png   # Existing icons
    ├── sr_to_ir_finder_icon32.png
    ├── sr_to_ir_finder_icon48.png
    └── sr_to_ir_finder_icon128.png
```

---

## Detailed Change Plan

### 1. Manifest.json Merge

**Combined permissions:**
```json
"permissions": ["contextMenus", "activeTab", "scripting", "tabs", "storage"]
```

**Combined content scripts:**
```json
"content_scripts": [
  {
    "matches": [
      "https://*.salesforce.com/*",
      "https://*.force.com/*",
      "https://*.lightning.force.com/*"
    ],
    "js": ["content-ir-finder.js"],
    "run_at": "document_idle",
    "all_frames": true
  },
  {
    "matches": [
      "https://staff-cms.lightning.force.com/lightning/r/*"
    ],
    "js": ["content-json-formatter.js"],
    "run_at": "document_idle",
    "all_frames": true
  }
]
```

**Icon click handler:**
- Add `action.onClicked` handler to trigger JSON formatter manually

### 2. Background.js Merge

Combine both service workers:
- Context menu creation for IR Finder
- Menu state update listener for IR Finder  
- Menu click handler for IR Finder
- **Add:** Icon click handler for JSON Formatter (inject and trigger `processNow`)

### 3. Content Scripts

**Option A: Keep Separate (Recommended)**
- Rename `content.js` → `content-ir-finder.js`
- Copy Extension 2's `content.js` → `content-json-formatter.js`
- Minimal changes, easier to maintain

**Option B: Merge into Single File**
- Combine both scripts with namespace isolation
- More complex, higher risk of conflicts

### 4. Icon Decision

Choose one of:
- **Option A:** Use IR Finder icons (magnifying glass theme)
- **Option B:** Use JSON Validator icons
- **Option C:** Create new combined icon

### 5. Remove Legacy Features ✅

The following files from JSON Formatter extension will **NOT** be included:

| File | Reason |
|------|--------|
| `popup.html` | Icon click now triggers directly, popup bypassed |
| `popup.js` | Unused |
| `options.html` | Non-functional color picker (tutorial leftover) |
| `options.js` | Non-functional color picker (tutorial leftover) |
| `button.css` | Only used by popup/options |

The `storage` permission will also be removed as it was only used by the color picker.

The background.js color initialization code (`chrome.storage.sync.set({ color })`) will be removed.

---

## Implementation Steps

| Step | Task | Complexity |
|------|------|------------|
| 1 | Create backup of both extensions | Low |
| 2 | Create new merged `manifest.json` | Medium |
| 3 | Merge `background.js` files | Medium |
| 4 | Rename/copy content scripts | Low |
| 5 | Copy images folder contents | Low |
| 6 | Test context menu functionality | Low |
| 7 | Test JSON formatter functionality | Low |
| 8 | Test icon click trigger | Low |
| 9 | Clean up unused files | Low |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Content script conflicts | Low | Medium | Keep scripts separate |
| Background script conflicts | Low | Low | Careful namespace management |
| Permission issues | Very Low | Low | Test on target pages |
| Performance impact | Very Low | Low | Scripts only load on matching URLs |

---

## Decisions Made

| Question | Decision |
|----------|----------|
| **Extension Name** | Keep existing: "311 SR to Integration Request Finder" |
| **Icons** | Keep existing: `sr_to_ir_finder_iconNN.png` |
| **Options Page** | ❌ **Remove** - Legacy leftover from tutorial, non-functional |
| **Target URL for JSON Formatter** | Broaden to all Salesforce domains (same as IR Finder) |

### Files to Exclude from Merge (Legacy/Unused):

- ~~`popup.html`~~ - Unused (icon click bypasses popup)
- ~~`popup.js`~~ - Unused
- ~~`options.html`~~ - Non-functional color picker
- ~~`options.js`~~ - Non-functional color picker
- ~~`button.css`~~ - Only used by above files
- ~~`storage` permission~~ - Only needed for color picker

---

## ✅ MERGE COMPLETED - January 17, 2026

### Changes Made:

| File | Action | Description |
|------|--------|-------------|
| `manifest.json` | Modified | Added second content script, updated version to 1.1, updated description |
| `background.js` | Modified | Added icon click handler for JSON Formatter |
| `content-json-formatter.js` | Created | JSON formatting & validation functionality |
| `content.js` | Unchanged | IR Finder functionality (kept as-is) |

### Final File Structure:
```
SR to Integration Request Finder/
├── manifest.json              # v1.1 - Combined manifest
├── background.js              # Context menu + Icon click handlers
├── content.js                 # SR to IR finder (unchanged)
├── content-json-formatter.js  # JSON formatter & validator (new)
├── MERGE_PLAN.md              # This document
├── PLAN.md
├── README.md
└── images/
    └── sr_to_ir_finder_icon*.png
```

### How to Test:
1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → Select the `SR to Integration Request Finder` folder
4. Navigate to Salesforce
5. **Test IR Finder:** Right-click on an SR number → "Search Integration Request"
6. **Test JSON Formatter:** Click the extension icon on an INT-REQ page

---

## Conclusion

**Feasibility: ✅ HIGH**

Merging these extensions is straightforward because:
- Both use Manifest V3
- No conflicting functionality
- Target sites are compatible (one is subset of other)
- Permissions can be combined without issues
- Content scripts operate independently

The recommended approach is to keep content scripts separate and merge only the manifest and background scripts, minimizing risk while achieving the goal of a single installable extension.
