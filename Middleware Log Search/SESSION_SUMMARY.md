# Session Summary - Middleware Log Search Extension

**Date:** 2026-02-02
**Status:** Partially complete - needs testing

---

## What This Extension Does

A Chrome extension for Salesforce users that:
1. Right-click an SR number (8-9 digits) in Salesforce
2. Click "Search in Middleware Log" → Opens Kibana in background
3. Auto-clicks to Jaeger if HTTP error (status >= 300) found
4. Extracts `response.body` from Jaeger (handles plain text or JSON with `errorInfo[0].errorMessage`)
5. Updates the SR link in Salesforce with: `{SR} - {error message}`
6. Salesforce tab stays on top throughout

---

## Files Structure

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration |
| `content.js` | Salesforce: right-click detection, SR validation, display updates |
| `background.js` | Message routing, context menus, tab management, queue processing |
| `error-trace-click.js` | Kibana: scans for HTTP errors, clicks Jaeger trace link |
| `jaeger-expand.js` | Jaeger: expands accordions, extracts response.body |

---

## Current Implementation Status

### Working Features
- [x] Right-click SR number → "Search in Middleware Log" menu
- [x] Opens Kibana in background tab
- [x] Auto-clicks Jaeger trace if error found
- [x] Expands Jaeger accordions automatically
- [x] Extracts response.body (plain text or JSON errorMessage)
- [x] Updates SR link with error message
- [x] Multi-line error messages display correctly (CSS injection)
- [x] Salesforce tab stays on top
- [x] Shows "Searching in the Middleware log..." while processing
- [x] Shows "Waiting for a BackEnd ID..." if no error found

### Newly Implemented (Needs Testing)
- [ ] "Search All in Middleware Log" context menu item
- [ ] Queue processing (bottom-to-top)
- [ ] Auto-close Kibana/Jaeger tabs after each SR (queue mode only)
- [ ] 30-second timeout per SR
- [ ] Separator between menu items

### Known Issue
- `isInRequestNumberColumn()` function may not work with Salesforce's actual DOM structure
- This affects "Search All" menu enabling (requires column detection)
- Single SR search works without column check (reverted to original behavior)

---

## Key Code Sections

### content.js - SR Validation
```javascript
// Single SR: enabled for any valid 8-9 digit link
const srNumber = extractSRNumber(event.target);
const isValidSingleSR = srNumber !== null;

// Search All: requires column detection
const isInColumn = isInRequestNumberColumn(event.target);
```

### background.js - Queue Processing
```javascript
// State variables
let searchQueue = [];
let currentSearchIndex = -1;
let isProcessingQueue = false;
let currentKibanaTabId = null;
let currentJaegerTabId = null;

// Key functions
processNextInQueue()  // Processes next SR, opens Kibana, sets 30s timeout
cleanupCurrentTabs()  // Closes Kibana/Jaeger tabs (queue mode only)
```

### Message Flow
```
Salesforce → updateMenuState → background.js
                                    ↓
                              Open Kibana tab
                                    ↓
Kibana → openInBackground (Jaeger) → background.js
         OR noErrorsFound
                                    ↓
Jaeger → responseBodyExtracted → background.js
                                    ↓
background.js → updateSRDisplay → Salesforce
```

---

## Design Documents

1. `IMPLEMENTATION_PLAN.md` - Original response body extraction design
2. `DESIGN_SEARCH_ALL.md` - "Search All" feature design with:
   - Architecture changes
   - Message flow diagrams
   - Tab lifecycle
   - Error handling
   - Edge cases

---

## To Debug "Search All" Menu

The `isInRequestNumberColumn()` function logs to console. Check for:
```
[Middleware Log] Element not in a table cell
[Middleware Log] Could not find row or table
[Middleware Log] Could not find header row
[Middleware Log] Column header does not match: {actual header text}
```

The function checks:
1. Element is in a `<td>` cell
2. Finds column index in the row
3. Finds header row (`thead tr` or first `tr`)
4. Checks if header contains "Request Number" (text or attributes)

Salesforce may use a different table structure that needs accommodation.

---

## Next Steps

1. **Test single SR search** - Should work as before
2. **Debug column detection** - Check console logs when right-clicking in Salesforce
3. **Fix `isInRequestNumberColumn()`** - Adapt to Salesforce's actual DOM structure
4. **Test "Search All"** - Once column detection works
5. **Verify tab cleanup** - Kibana/Jaeger tabs should close in queue mode

---

## Configuration

**Kibana URL Template** (in background.js):
```
http://portal.cc.toronto.ca:5601/app/dashboards#/view/c36f5e40-40fe-11ed-a166-53790178ef13?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-30d,to:now))&_a=(query:(language:kuery,query:'NNNNNNNN'),filters:!(),viewMode:view)
```

**SR Pattern**: 8-9 digit numbers (`/^\d{8,9}$/`)

**Timeouts**:
- Queue item timeout: 30 seconds
- MutationObserver timeout: 5 minutes
