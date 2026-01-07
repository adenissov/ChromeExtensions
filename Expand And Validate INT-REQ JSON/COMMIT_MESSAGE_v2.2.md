# Commit: Auto-Trigger JSON Formatting on Tab Switch and Page Load

## Version: 2.2

## Summary
Change the extension from manual button-triggered formatting to automatic formatting that activates when switching Salesforce sub-tabs or when the page loads with an "HTTP Request Content" section visible.

## What Changed

### Before (v2.1)
- User had to click the extension's popup button to trigger JSON formatting and validation
- Content script (`content.js`) contained an older, basic version without validation
- Main logic lived in `popup.js` and was injected via `chrome.scripting.executeScript()`

### After (v2.2)
- JSON formatting and validation triggers automatically:
  1. **On page load** - If "HTTP Request Content" section is visible
  2. **On tab switch** - When user clicks a different INT-REQ-*** sub-tab
- Content script (`content.js`) now contains the full formatting + validation logic
- Uses MutationObserver to detect when new tab content appears in DOM
- Uses click listeners on tab elements to detect tab switches
- Popup button remains as manual fallback (can be removed later)

## Files Modified
- **content.js** - Major rewrite: receives all formatting/validation logic + event listeners
- **popup.js** - Simplified: thin wrapper to trigger content script
- **manifest.json** - Version bump to 2.2, updated description

## Why This Change
- **Improved UX** - No manual action required in normal workflow
- **Faster workflow** - Formatting appears as soon as tab content is visible
- **Consistency** - Every viewed tab gets formatted automatically

## Known Limitations
- Only processes the currently active/visible tab (Salesforce lazy-loading)
- If auto-trigger fails, user can refresh page (F5) or use manual button

## Rollback
If issues arise, revert to v2.1 which uses manual button-only triggering.
