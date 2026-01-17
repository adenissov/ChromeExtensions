# Discussion Notes: Auto-Click Trace on HTTP Error Feature

## ✅ IMPLEMENTED

## Feature Summary

After opening the Middleware dashboard page, the extension:
1. User clicks the **extension icon** in Chrome toolbar
2. Detects the `table.osdDocTable` element (uses MutationObserver if table not yet loaded)
3. Walks the **Status Code** column from **bottom to top**
4. When an HTTP error code (`>= 300`) is found, clicks the **Trace** link in the same row
5. Stops after clicking the first error trace (most recent error)
6. If no errors found, does nothing silently

## Files Changed

| File | Change |
|------|--------|
| `error-trace-click.js` | **NEW** - Content script with scan logic |
| `manifest.json` | Added content script entry for `*://portal.cc.toronto.ca:5601/*` |
| `background.js` | Added `chrome.action.onClicked` handler to trigger scan |

## Configuration

| Setting | Value |
|---------|-------|
| URL Pattern | `*://portal.cc.toronto.ca:5601/*` |
| Error Threshold | `>= 300` |
| Observer Timeout | 10 seconds |
| Non-Middleware pages | Ignored silently |

## Testing

1. Load extension in Chrome (`chrome://extensions` → Load unpacked)
2. Navigate to Middleware dashboard: `http://portal.cc.toronto.ca:5601/app/dashboards#/...`
3. Wait for table to load with data
4. Click the extension icon in Chrome toolbar
5. Should auto-click the Trace link for the first error (bottom-to-top scan)

## Console Log Prefix

`[ErrorTraceClick]` - for debugging in DevTools console

---
*Implemented: January 17, 2026*
