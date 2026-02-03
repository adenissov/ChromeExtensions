# 311 Middleware Log Search

Chrome extension for City of Toronto 311 staff to search middleware logs directly from Salesforce.

## Features

| Feature | Description |
|---------|-------------|
| **Search this SR** | Right-click an SR number → search middleware logs in Kibana |
| **Search All SRs** | Right-click in SR column → batch process all SRs on the page |
| **Auto Error Detection** | Automatically finds HTTP errors (≥300) in Kibana |
| **Auto Trace Expansion** | Automatically expands Jaeger trace to show error details |
| **Visual Feedback** | Spinner animation while searching, results displayed in-place |

## Workflow

```
SALESFORCE          KIBANA              JAEGER
    │                  │                   │
    │ Right-click SR   │                   │
    │ ──────────────►  │                   │
    │                  │ Auto-find error   │
    │                  │ ───────────────►  │
    │                  │                   │ Auto-expand trace
    │ ◄──────────────────────────────────  │ Extract response.body
    │ Display error                        │
```

## Installation

1. Open `chrome://extensions/` (or `edge://extensions/`)
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `Middleware Log Search` folder

## Usage

### Single SR Search
1. Right-click on an SR number link (8-9 digits) in Salesforce
2. Select **"Search this SR in Middleware Log"**
3. Results appear in the SR cell:
   - Error message from middleware
   - "Waiting for a BackEnd ID..." (no HTTP errors found)
   - "No records in Middleware log" (SR not in logs)

### Batch Search (All SRs)
1. Right-click anywhere in the Request Number column
2. Select **"Search All SRs in Middleware Log"**
3. All SRs process sequentially (bottom to top)
4. Results appear in each cell as processing completes

---

## Project Structure

```
Middleware Log Search/
├── manifest.json           # Extension configuration
├── background.js           # Service worker: menus, routing, queue
├── content.js              # Salesforce: SR detection, display updates
├── error-trace-click.js    # Kibana: auto-click error traces
├── jaeger-expand.js        # Jaeger: auto-expand, extract response.body
├── images/                 # Extension icons
└── README.md               # This file
```

## File Responsibilities

| File | Runs On | Purpose |
|------|---------|---------|
| `background.js` | Service worker | Context menus, tab management, message routing |
| `content.js` | Salesforce (`*.salesforce.com`, `*.force.com`) | SR validation, display updates, table reflow |
| `error-trace-click.js` | Kibana (`portal.cc.toronto.ca:5601`) | Scan for HTTP errors, click trace links |
| `jaeger-expand.js` | All URLs (filters internally) | Expand accordions, extract `response.body` |

---

## Configuration

### Timeouts

| Location | Value | Purpose |
|----------|-------|---------|
| `jaeger-expand.js` | 10 sec | Max wait for Jaeger data extraction |
| `background.js` | 12 sec | Fallback timeout per SR (queue mode) |
| `error-trace-click.js` | 10 sec | Max wait for Kibana table to load |
| `jaeger-expand.js` | 5 min | MutationObserver auto-disconnect |

### URLs

| System | URL Pattern |
|--------|-------------|
| Kibana | `http://portal.cc.toronto.ca:5601/app/dashboards#/view/...` |
| Jaeger | Detected by URL containing `jaeger`, `trace`, `tracing`, or port `16686` |
| Salesforce | `*.salesforce.com`, `*.force.com`, `*.lightning.force.com` |

### Thresholds

| Setting | Value |
|---------|-------|
| HTTP Error Threshold | Status Code ≥ 300 |
| SR Number Pattern | 8-9 digit integer |

---

## Message Protocol

### Content Script → Background

| Action | Sent By | Data |
|--------|---------|------|
| `updateMenuState` | content.js | `{isValid, srNumber, elementId, isValidColumn, allItems}` |
| `openInBackground` | error-trace-click.js | `{url}` |
| `noErrorsFound` | error-trace-click.js | (no data) |
| `noRecordsFound` | error-trace-click.js | (no data) |
| `responseBodyExtracted` | jaeger-expand.js | `{responseBody}` |

### Background → Content Script

| Action | Data |
|--------|------|
| `updateSRDisplay` | `{elementId, srNumber, responseBody}` |

---

## Known Issues & Solutions

### 1. Salesforce Table Reflow

**Problem:** After adding error text, table rows expand but container height stays fixed, clipping bottom rows.

**Solution:** CSS overrides + adding class to 5 levels of parent containers:
```javascript
// In content.js - triggerSalesforceTableReflow()
let parent = tableElement.parentElement;
for (let i = 0; i < 5 && parent; i++) {
  parent.classList.add('mwlog-expanded-table-container');
  parent = parent.parentElement;
}
```

**What didn't work:**
- Width manipulation (changing by 1px)
- Window resize event alone

### 2. Jaeger Page Detection

**Problem:** `jaeger-expand.js` runs on ALL URLs but should only act on Jaeger pages.

**Solution:** Multiple checks in `isJaegerPage()`:
- URL contains `jaeger`, `/trace/`, `tracing`, `16686`, or `zipkin`
- DOM contains Jaeger-specific elements (`.TraceTimelineViewer`, `.TracePage`, etc.)
- Extraction was attempted (found Jaeger-like elements)

**Gotcha:** Only run in top frame (`window !== window.top`) to avoid duplicates from iframes.

### 3. Empty vs No Errors in Kibana

**Problem:** Need to distinguish between:
- Table has records but no HTTP errors → "Waiting for a BackEnd ID..."
- Table is completely empty → "No records in Middleware log"

**Solution:** Check `rows.length === 0` BEFORE scanning for errors.

### 4. Extension Context Invalidation

**Problem:** After extension reload, content scripts lose connection to background.

**Solution:** Wrap `chrome.runtime.sendMessage` in try-catch with user-friendly message to refresh the page.

---

## Development Notes

### Adding New Features

1. **New message types**: Add handler in `background.js` message listener
2. **New display states**: Update `content.js` message handler and CSS
3. **New Kibana columns**: Update `CONFIG` in `error-trace-click.js`
4. **New Jaeger elements**: Update selectors in `jaeger-expand.js`

### Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Context menu not updating | Menu items are created once on install; use `chrome.contextMenus.update()` |
| Content script not running | Check `matches` patterns in `manifest.json` |
| Jaeger script runs on wrong pages | Ensure `isJaegerPage()` check is in place |
| Duplicate messages | Check for `window !== window.top` (iframe filter) |
| Unreachable code | Early returns can make later checks unreachable (see error-trace-click.js fix) |

### Debugging

Filter console by prefix:
- `[Middleware Log]` - content.js, jaeger-expand.js, background.js
- `[ErrorTraceClick]` - error-trace-click.js

### Testing Checklist

- [ ] Single SR search works
- [ ] Search All processes all SRs
- [ ] Empty Kibana table shows "No records"
- [ ] No errors shows "Waiting for BackEnd ID"
- [ ] Errors show extracted message
- [ ] Spinner animation appears during search
- [ ] Table reflows correctly after update
- [ ] Extension works after page refresh
- [ ] Context menu disabled for non-SR elements

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2026 | Initial release |
| 1.1 | Feb 2026 | Added Search All, visual feedback, table reflow fix |
