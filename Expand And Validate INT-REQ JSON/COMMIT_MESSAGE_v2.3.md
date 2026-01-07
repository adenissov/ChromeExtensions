# Commit: Trigger Formatting on Extension Icon Click (No Popup)

## Version: 2.3

## Summary
Change the manual fallback trigger from requiring a popup button click to directly triggering when the extension icon is clicked. The popup is bypassed entirely - one click on the extension icon immediately formats the JSON.

## What Changed

### Before (v2.2)
- Click extension icon → Opens popup with green button
- Click green button → Triggers formatting
- **Two clicks required** for manual trigger

### After (v2.3)
- Click extension icon → Immediately triggers formatting
- **One click required** for manual trigger
- Popup is bypassed (files kept for potential future use)

## Files Modified
- **manifest.json** - Removed `default_popup` from action section, version bump to 2.3
- **background.js** - Added `chrome.action.onClicked` listener to send message to content script

## Files Kept (Not Used)
- `popup.html` - Kept for potential future use
- `popup.js` - Kept for potential future use  
- `button.css` - Kept for potential future use

## Technical Details

### How It Works
1. When `default_popup` is removed from manifest, clicking the extension icon fires `chrome.action.onClicked` event
2. Background service worker catches this event
3. Background sends message `{ action: 'processNow' }` to content script
4. Content script's existing message listener triggers `processVisibleSections()`

### Code Changes

**manifest.json** - Remove popup:
```json
// BEFORE
"action": {
  "default_popup": "popup.html",
  "default_icon": { ... }
}

// AFTER  
"action": {
  "default_icon": { ... }
}
```

**background.js** - Add click handler:
```javascript
// Added
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: 'processNow' });
});
```

## Why This Change
- **Faster manual trigger** - One click instead of two
- **Simpler UX** - No popup to dismiss
- **Consistent with auto-trigger** - Same underlying mechanism (message to content script)

## Behavior Summary

| Trigger | v2.2 | v2.3 |
|---------|------|------|
| Page load | Auto ✅ | Auto ✅ |
| Tab switch | Auto ✅ | Auto ✅ |
| Manual (icon click) | 2 clicks (popup → button) | 1 click (direct) |

## Known Limitations
- No visual feedback when icon is clicked (no popup opens)
- If content script not loaded, click does nothing silently

## Rollback
To restore popup behavior:
1. Add `"default_popup": "popup.html"` back to manifest.json action section
2. Remove `chrome.action.onClicked` listener from background.js
3. Revert version to 2.2
