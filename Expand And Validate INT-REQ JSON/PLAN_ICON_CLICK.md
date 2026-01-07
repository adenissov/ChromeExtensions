# Implementation Plan - Extension Icon Click Trigger v2.3

## Overview
Modify the extension so that clicking the extension icon directly triggers JSON formatting, bypassing the popup entirely. This provides a faster one-click manual fallback.

---

## Current Architecture (v2.2)

```
User clicks extension icon
    ↓
popup.html opens
    ↓
User clicks green button
    ↓
popup.js sends message: { action: 'processNow' }
    ↓
content.js receives message
    ↓
processVisibleSections() runs
```

## New Architecture (v2.3)

```
User clicks extension icon
    ↓
chrome.action.onClicked fires (no popup)
    ↓
background.js sends message: { action: 'processNow' }
    ↓
content.js receives message
    ↓
processVisibleSections() runs
```

---

## Phase 1: Modify manifest.json

**Goal**: Disable popup so icon click fires an event instead.

### Change Required

**File**: `manifest.json`

**Before**:
```json
"action": {
  "default_popup": "popup.html",
  "default_icon": {
    "16": "/images/get_started16.png",
    "32": "/images/get_started32.png",
    "48": "/images/get_started48.png",
    "128": "/images/get_started128.png"
  }
}
```

**After**:
```json
"action": {
  "default_icon": {
    "16": "/images/get_started16.png",
    "32": "/images/get_started32.png",
    "48": "/images/get_started48.png",
    "128": "/images/get_started128.png"
  }
}
```

### Also Update Version

```json
"name": "Expand JSON in Integration Request v2.3 (Icon Click)",
"version": "2.3",
```

---

## Phase 2: Modify background.js

**Goal**: Add click handler that sends message to content script.

### Current background.js Content

Need to check current content and add the click listener.

### Code to Add

```javascript
// Trigger formatting when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  // Send message to content script to trigger processing
  chrome.tabs.sendMessage(tab.id, { action: 'processNow' });
});
```

### Placement

Add at the end of the existing `background.js` file (after any existing code).

---

## Phase 3: Verify content.js Message Listener

**Goal**: Confirm content.js already handles the message.

### Existing Code in content.js (Already Present)

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'processNow') {
    console.log('[JSONFormatter] Manual trigger received from popup');
    processVisibleSections();
  }
});
```

**Status**: ✅ Already implemented - no changes needed

### Optional Enhancement

Update the log message since trigger now comes from background, not popup:

```javascript
console.log('[JSONFormatter] Manual trigger received');
```

---

## Phase 4: Keep Popup Files (No Deletion)

**Goal**: Preserve popup files for potential future use.

### Files to Keep

| File | Reason |
|------|--------|
| `popup.html` | May want to restore popup later |
| `popup.js` | Contains working message-sending code |
| `button.css` | Styling for popup button |

### Note

These files are no longer loaded/used but remain in the repository. They can be deleted later in a cleanup commit if icon-click behavior proves reliable.

---

## Implementation Checklist

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Remove `default_popup` line | manifest.json | ⬜ |
| 2 | Update version to 2.3 | manifest.json | ⬜ |
| 3 | Update name to include "(Icon Click)" | manifest.json | ⬜ |
| 4 | Add `chrome.action.onClicked` listener | background.js | ⬜ |
| 5 | (Optional) Update log message | content.js | ⬜ |

---

## Testing

### Test Cases

| # | Scenario | Expected Result |
|---|----------|-----------------|
| 1 | Click extension icon on Salesforce page | JSON formats immediately (no popup) |
| 2 | Click icon on already-processed page | No change (already processed check) |
| 3 | Click icon on non-Salesforce page | Nothing happens (content script not loaded) |
| 4 | Page load on Salesforce | Auto-formats (unchanged from v2.2) |
| 5 | Tab switch on Salesforce | Auto-formats (unchanged from v2.2) |

### Console Verification

After clicking icon, check DevTools console for:
```
[JSONFormatter] Manual trigger received
[JSONFormatter] processVisibleSections() called
[JSONFormatter] Processing X HTTP Request Content section(s)
```

---

## Rollback Plan

If issues arise, restore popup behavior:

### Step 1: Restore manifest.json
```json
"action": {
  "default_popup": "popup.html",  // Add this line back
  "default_icon": { ... }
}
```

### Step 2: Remove from background.js
Remove the `chrome.action.onClicked.addListener` code block.

### Step 3: Revert version
```json
"name": "Expand JSON in Integration Request v2.2 (Auto-Trigger)",
"version": "2.2",
```

---

## File Change Summary

| File | Change Type | Lines Changed |
|------|-------------|---------------|
| manifest.json | Modify | ~3 lines (remove popup, update version/name) |
| background.js | Modify | ~4 lines added |
| content.js | Optional | ~1 line (update log message) |
| popup.html | No change | Kept for future |
| popup.js | No change | Kept for future |
| button.css | No change | Kept for future |

---

## Implementation Order

1. ✅ Create COMMIT_MESSAGE_v2.3.md
2. ✅ Create PLAN_ICON_CLICK.md (this document)
3. ⬜ Modify manifest.json (remove popup, update version)
4. ⬜ Modify background.js (add click listener)
5. ⬜ (Optional) Update content.js log message
6. ⬜ Test all scenarios
7. ⬜ Commit changes

---

## Questions Answered

1. **Keep popup files?** → Yes, kept for potential future use
2. **Version bump?** → Yes, to v2.3
3. **Update content.js?** → Optional (just log message text)
