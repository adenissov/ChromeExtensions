# 311 Middleware Log Search

A Chrome/Edge extension for City of Toronto 311 staff that provides three independent productivity features:

1. **Kibana Log Search** - Right-click on Service Request numbers in Salesforce to search middleware logs
2. **Auto Error Trace Click** - Automatically opens the Jaeger trace for the first HTTP error found in the Middleware dashboard
3. **Jaeger Auto-Expand** - Automatically expands trace details in Jaeger to reveal response body content

## Features Overview

This extension contains **three independent parts** that work together in sequence:

| Feature | Trigger | Target System | Purpose |
|---------|---------|---------------|---------|
| Kibana Log Search | Right-click menu on SR numbers | Salesforce → Kibana | Search middleware logs for an SR |
| Auto Error Trace Click | Automatic on Kibana page load | Kibana → Jaeger | Open trace for first HTTP error (≥300) |
| Jaeger Auto-Expand | Automatic on Jaeger page load | Jaeger UI | Reveal response.body in trace details |

### Complete Workflow

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   SALESFORCE    │───►│     KIBANA      │───►│     JAEGER      │
│                 │    │  (Middleware)   │    │                 │
│ Right-click SR  │    │ Auto-click      │    │ Auto-expand     │
│ → Opens Kibana  │    │ first error     │    │ response.body   │
│                 │    │ trace link      │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## Part 1: Kibana Log Search (Context Menu)

### Problem Statement

When troubleshooting Service Requests, staff need to examine middleware logs in Kibana. The manual process requires:
1. Copying the SR number from Salesforce
2. Opening Kibana in a new tab
3. Navigating to the correct dashboard
4. Pasting the SR number into the search query
5. Executing the search

**This extension reduces that to 2 clicks**: right-click on SR number → click "Search in Middleware Log".

### How It Works

1. **Right-click** on a Service Request number link (e.g., `08475332`) in Salesforce
2. Select **"Search in Middleware Log"** from the context menu
3. The extension automatically opens Kibana with the SR number pre-filled in the search query

### SR Number Validation

The menu item is dynamically **enabled** only when:
- The right-clicked element is a hyperlink (`<a>` tag)
- The link text is exactly an 8-9 digit integer number

The menu remains **disabled** (grayed out) otherwise, providing clear visual feedback.

### Supported Domains

The context menu feature activates on:
- `https://*.salesforce.com/*`
- `https://*.force.com/*`
- `https://*.lightning.force.com/*`

---

## Part 2: Auto Error Trace Click (Middleware Dashboard)

### Problem Statement

After searching for an SR in Kibana, the results table shows multiple rows with different HTTP status codes. Users need to manually scan through rows looking for errors (status code ≥ 300) and click the trace link to investigate.

**This extension automates error detection**: when the Kibana dashboard loads, it automatically finds and clicks the first error trace.

### How It Works

1. Kibana dashboard opens (from Part 1 or manually navigated)
2. The extension waits for the data table (`table.osdDocTable`) to load
3. Scans the **Status Code** column from **bottom to top** (most recent first)
4. When an HTTP error (status code ≥ 300) is found, automatically clicks the **Trace** link in the same row
5. Jaeger trace page opens in the same tab
6. If no errors are found, does nothing silently

### Configuration

| Setting | Value |
|---------|-------|
| Target URL | `*://portal.cc.toronto.ca/*` (port 5601) |
| Error Threshold | Status Code ≥ 300 |
| Scan Direction | Bottom to top (most recent first) |
| Observer Timeout | 10 seconds (max wait for table) |

### Target Table Structure

The extension targets OpenSearch Dashboards (OSD) tables with this structure:

| Column | Selector |
|--------|----------|
| Status Code | `span[data-test-subj="docTableHeader-Status Code"]` |
| Trace | `span[data-test-subj="docTableHeader-Trace"]` |
| Cell values | `span[ng-non-bindable]` |
| Trace link | `td a[href]` |

---

## Part 3: Jaeger Auto-Expand

### Problem Statement

When viewing traces in Jaeger, the details are nested in multiple collapsible sections:
1. **Span bar** (green bar) - collapsed by default
2. **Logs accordion** - collapsed inside span details
3. **Timestamp section** - collapsed inside Logs

Users frequently need to manually click through all these levels to see the `response.body` content.

**This extension automatically expands all levels** when a Jaeger trace page loads.

### How It Works

1. Navigate to a Jaeger trace page (from Part 2 or manually)
2. The extension automatically:
   - Expands the first span bar (green bar)
   - Expands the "Logs" accordion
   - Expands inner timestamp sections
3. The `response.body` content is immediately visible

### Technical Details

- Uses **MutationObserver** to detect dynamically loaded content
- Waits for virtualized content to render before expanding
- Runs on all URLs (filters internally by Jaeger-specific CSS classes)
- Does nothing silently on non-Jaeger pages
- 5-minute timeout to prevent memory leaks

---

## Installation

1. Open Chrome/Edge and navigate to `chrome://extensions/` or `edge://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `Middleware Log Search` folder
5. The extension icon appears in the toolbar

## Project Structure

```
Middleware Log Search/
├── manifest.json          # Extension configuration
├── background.js          # Service worker: context menu, Kibana URL opening
├── content.js             # Salesforce content script: SR validation
├── error-trace-click.js   # Kibana content script: auto-click error trace
├── jaeger-expand.js       # Jaeger content script: auto-expand accordions
├── README.md              # This file (user documentation)
├── PLAN.md                # Architecture and development plan
└── images/                # Extension icons
    ├── sr_in_middlware_search16.png
    ├── sr_in_middlware_search32.png
    ├── sr_in_middlware_search48.png
    └── sr_in_middlware_search128.png
```

---

## Troubleshooting

### Context Menu Issues (Salesforce)

#### Menu item is grayed out (disabled)
- Ensure you're right-clicking on a **link** (`<a>` tag), not plain text
- The link text must be exactly 8-9 digits (e.g., `08475332`)
- Check the console (F12) for `[Middleware Log]` messages

#### "Extension context invalidated" error
- This occurs after reloading/updating the extension
- **Solution**: Refresh the Salesforce page

#### Menu item does nothing when clicked
- The extension may have been reloaded while the page was open
- **Solution**: Refresh the page to reconnect to the extension

### Auto Error Trace Issues (Kibana)

#### Trace link not clicked automatically
- Check that the table has loaded with data rows
- Ensure at least one row has Status Code ≥ 300
- Check the console (F12) for `[ErrorTraceClick]` messages
- The observer times out after 10 seconds

#### Wrong trace clicked
- The extension clicks the **first error from bottom** (most recent in time order)
- Verify the Status Code column is visible in the table

### Jaeger Auto-Expand Issues

#### Accordions not expanding
- The content may still be loading
- Check the console for `[Middleware Log]` messages
- The MutationObserver watches for 5 minutes, then stops

#### Only some accordions expand
- The extension expands accordions as they appear in the DOM
- If content loads after the observer stops, manual expansion is needed

---

## Debugging

Enable verbose logging by checking the browser console (F12):

**Salesforce (content.js):** Filter by `[Middleware Log]`
- `Valid SR number found:` - SR extraction working
- `Element is not a link` - Click wasn't on a link
- `Link text is not 8-9 digits:` - Invalid number format

**Kibana (error-trace-click.js):** Filter by `[ErrorTraceClick]`
- `Content script loaded, starting automatic scan` - Script initialized
- `Table already present with N rows` - Table detected
- `Column indices found. StatusCode: X, Trace: Y` - Columns located
- `Scanning N rows bottom-to-top` - Scan started
- `Found HTTP error: 400` - Error detected
- `Clicking trace link:` - About to click
- `No HTTP errors found in table` - No errors in current results

**Jaeger (jaeger-expand.js):** Filter by `[Middleware Log]`
- `Setting up MutationObserver for Jaeger UI` - Observer started
- `Expanding span bar` - Auto-expanding green bar
- `Expanding Logs accordion` - Auto-expanding Logs section
- `Expanding inner timestamp accordion` - Auto-expanding timestamp

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2026 | Initial release with Kibana search and Jaeger auto-expand |
| 1.1 | Jan 2026 | Added auto error trace click for Kibana dashboard |

---

## Related Projects

- **311 SR to Integration Request Finder** - Right-click SR numbers to search Integration Requests in Salesforce
