# 311 Middleware Log Search - Development Plan

## Overview

This document describes the architecture and implementation plan for the "311 Middleware Log Search" Chrome extension. The extension has **three independent features** that work together in a pipeline:

1. **Kibana Log Search** - Context menu to search middleware logs from Salesforce
2. **Auto Error Trace Click** - Automatically click the first error trace in Kibana
3. **Jaeger Auto-Expand** - Automatically expand trace details on Jaeger pages

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Chrome Extension                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐                                                        │
│  │  background.js  │                                                        │
│  │ (Service Worker)│                                                        │
│  ├─────────────────┤                                                        │
│  │ • Create context│                                                        │
│  │   menu (disabled)│                                                       │
│  │ • Update menu   │                                                        │
│  │   enabled state │                                                        │
│  │ • On menu click:│                                                        │
│  │   open Kibana   │                                                        │
│  └────────▲────────┘                                                        │
│           │ message                                                          │
│  ┌────────┴────────┐  ┌─────────────────────┐  ┌─────────────────────────┐  │
│  │   content.js    │  │error-trace-click.js │  │   jaeger-expand.js      │  │
│  │  (Salesforce)   │  │    (Kibana/OSD)     │  │    (All URLs)           │  │
│  ├─────────────────┤  ├─────────────────────┤  ├─────────────────────────┤  │
│  │ • contextmenu   │  │ • MutationObserver  │  │ • MutationObserver      │  │
│  │   event handler │  │ • Find Status Code  │  │ • Auto-expand span bars │  │
│  │ • SR validation │  │   column (≥300)     │  │ • Auto-expand Logs      │  │
│  │ • Send menu     │  │ • Click Trace link  │  │ • Auto-expand timestamps│  │
│  │   state updates │  │   (bottom-to-top)   │  │                         │  │
│  └─────────────────┘  └─────────────────────┘  └─────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### End-to-End Workflow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ SALESFORCE  │────►│   KIBANA    │────►│   JAEGER    │
│             │     │ (Middleware)│     │             │
│ 1. Right-   │     │ 3. Auto-    │     │ 5. Auto-    │
│    click SR │     │    detect   │     │    expand   │
│ 2. Select   │     │    errors   │     │    all      │
│    menu     │     │ 4. Click    │     │    sections │
│             │     │    trace    │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
```

---

## Part 1: Kibana Log Search

### Data Flow

```
User right-clicks SR link
         │
         ▼
┌─────────────────────────┐
│ contextmenu event fires │
│ (content.js)            │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Validation:             │
│ 1. Is it a link?        │
│ 2. Is text 8-9 digits?  │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Send message to         │
│ background.js:          │
│ { action, isValid,      │
│   srNumber }            │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ background.js updates   │
│ menu enabled state      │
│ Stores srNumber         │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ User clicks menu item   │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ background.js builds    │
│ Kibana URL with SR      │
│ Opens in new tab        │
└─────────────────────────┘
```

### Message Protocol

**Content → Background: `updateMenuState`**
```javascript
{
  action: 'updateMenuState',
  isValid: boolean,      // true if all validations pass
  srNumber: string|null  // SR number if valid, null otherwise
}
```

### Kibana URL Template

```javascript
const KIBANA_URL_TEMPLATE = "http://portal.cc.toronto.ca:5601/app/dashboards#/view/c36f5e40-40fe-11ed-a166-53790178ef13?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-30d,to:now))&_a=(query:(language:kuery,query:'NNNNNNNN'),filters:!(),viewMode:view)";
```

---

## Part 2: Auto Error Trace Click

### Data Flow

```
Kibana page loads (from Part 1 or manually)
         │
         ▼
┌─────────────────────────┐
│ Port check: 5601?       │
│ (error-trace-click.js)  │
└─────────────────────────┘
         │ yes
         ▼
┌─────────────────────────┐
│ MutationObserver waits  │
│ for table.osdDocTable   │
│ (max 10 seconds)        │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Find column indices:    │
│ - Status Code           │
│ - Trace                 │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Scan rows BOTTOM→TOP    │
│ (most recent first)     │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ First row with          │
│ Status Code ≥ 300?      │
└─────────────────────────┘
         │ yes
         ▼
┌─────────────────────────┐
│ Click Trace link <a>    │
│ → Opens Jaeger page     │
└─────────────────────────┘
```

### Configuration Constants

```javascript
const CONFIG = {
  tableSelector: 'table.osdDocTable',
  headerRowSelector: 'thead tr.osdDocTableHeader',
  dataRowSelector: 'tbody tr.osdDocTable__row',
  statusCodeHeaderAttr: 'docTableHeader-Status Code',
  traceHeaderAttr: 'docTableHeader-Trace',
  cellValueSelector: 'span[ng-non-bindable]',
  traceLinkSelector: 'a[href]',
  observerTimeout: 10000,  // 10 seconds
  errorStatusThreshold: 300
};
```

### Target Table Structure

```html
<table class="osdDocTable table ng-scope">
  <thead>
    <tr class="osdDocTableHeader">
      <th><!-- expand toggle --></th>
      <th><span data-test-subj="docTableHeader-startTimeMillis">Time</span></th>
      <th><span data-test-subj="docTableHeader-Status Code">Status Code</span></th>
      <th><span data-test-subj="docTableHeader-Trace">Trace</span></th>
      <!-- ... more columns ... -->
    </tr>
  </thead>
  <tbody>
    <tr class="osdDocTable__row">
      <td><!-- toggle --></td>
      <td><!-- Time --></td>
      <td><span ng-non-bindable="">400</span></td>
      <td><a href="http://...trace/...">traceId</a></td>
    </tr>
  </tbody>
</table>
```

---

## Part 3: Jaeger Auto-Expand

### Target HTML Structure

Jaeger UI uses nested expandable sections:

```
SpanBar (green bar)
  └── Detail Panel
       ├── Tags (accordion)
       ├── Process (accordion)  
       └── Logs (accordion)
            └── Timestamp section (e.g., "1.01s")
                 └── KeyValueTable
                      ├── event
                      └── response.body  ← Target content
```

### Auto-Expand Flow

```
Page loads
    │
    ▼
┌─────────────────────────┐
│ Setup MutationObserver  │
│ (jaeger-expand.js)      │
│ 5-minute timeout        │
└─────────────────────────┘
    │
    ▼ (500ms delay)
┌─────────────────────────┐
│ Find collapsed span-row │
│ Click span-name to      │
│ expand span bar         │
└─────────────────────────┘
    │
    ▼ (DOM mutation detected)
┌─────────────────────────┐
│ Find AccordianLogs      │
│ Click header if not     │
│ already open            │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Find inner timestamp    │
│ accordions, expand each │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ response.body visible!  │
└─────────────────────────┘
```

### Key CSS Classes

| Class | Purpose |
|-------|---------|
| `.span-row` | Span bar container row |
| `.span-row.is-expanded` | Expanded span bar |
| `.span-name` | Clickable span name link |
| `.AccordianLogs` | Logs accordion container |
| `.AccordianLogs--header` | Logs accordion toggle |
| `.AccordianLogs--header.is-open` | Expanded Logs accordion |
| `.AccordianKeyValues--header` | Inner timestamp accordion |

---

## File Structure

```
Middleware Log Search/
├── manifest.json          # Extension configuration
├── background.js          # Service worker: menu, Kibana URL
├── content.js             # Salesforce: SR validation
├── error-trace-click.js   # Kibana: auto-click error trace
├── jaeger-expand.js       # Jaeger: auto-expand logic
├── README.md              # User documentation
├── PLAN.md                # This file
└── images/                # Extension icons
```

---

## Manifest Configuration

### Content Script URL Patterns

| Script | Matches | Purpose |
|--------|---------|---------|
| `content.js` | `https://*.salesforce.com/*`, `https://*.force.com/*`, `https://*.lightning.force.com/*` | SR number validation |
| `error-trace-click.js` | `*://portal.cc.toronto.ca/*` | Auto-click error trace (port 5601 checked internally) |
| `jaeger-expand.js` | `<all_urls>` | Auto-expand (filters by CSS classes internally) |

### Permissions

| Permission | Purpose |
|------------|---------|
| `contextMenus` | Create right-click menu item |
| `activeTab` | Access current tab when menu clicked |
| `tabs` | Open new tabs for Kibana |
| `<all_urls>` (host) | Inject content scripts on any page |

---

## Design Decisions

### DD-1: Separate Content Scripts per Feature
**Decision**: Use separate files for Salesforce (`content.js`), Kibana (`error-trace-click.js`), and Jaeger (`jaeger-expand.js`).

**Rationale**:
- Different URL patterns and functionality
- Easier to maintain and debug
- Can be enabled/disabled independently
- Clear separation of concerns

### DD-2: Menu Disabled by Default
**Decision**: Create context menu with `enabled: false` initially.

**Rationale**:
- Clear visual feedback when element is not valid
- Prevents errors from clicking invalid items

### DD-3: MutationObserver for Dynamic Content
**Decision**: Use MutationObserver in both `error-trace-click.js` and `jaeger-expand.js`.

**Rationale**:
- Both Kibana and Jaeger use dynamic/virtualized rendering
- Content loads asynchronously after initial page load
- Observer reacts immediately to DOM changes
- More reliable than fixed retry delays

### DD-4: Run Jaeger Script on All URLs
**Decision**: Use `<all_urls>` pattern for `jaeger-expand.js`.

**Rationale**:
- Avoids exposing internal server names in source code
- Does nothing harmful on non-Jaeger pages
- Filters internally using Jaeger-specific CSS classes

### DD-5: Port Check for Kibana Script
**Decision**: Match broad URL `*://portal.cc.toronto.ca/*` but check port 5601 in JavaScript.

**Rationale**:
- Chrome match patterns don't support port numbers
- JavaScript check `window.location.port !== '5601'` exits early on wrong port

### DD-6: Bottom-to-Top Error Scan
**Decision**: Scan Status Code column from bottom to top.

**Rationale**:
- Table is sorted by time descending (newest first visually at top)
- Scanning bottom-to-top finds the most recent error chronologically
- Clicking first error found prioritizes recent issues

### DD-7: Safe Message Sending
**Decision**: Wrap `chrome.runtime.sendMessage` in try-catch with error handling.

**Rationale**:
- Extension context can be invalidated after reload
- Prevents uncaught errors in content scripts
- Provides helpful message to refresh page

### DD-8: Automatic Trigger on Page Load
**Decision**: `error-trace-click.js` runs automatically when Kibana page loads.

**Rationale**:
- Seamless workflow from Salesforce → Kibana → Jaeger
- No extra user action required after selecting context menu
- MutationObserver handles dynamic table loading

---

## Testing Checklist

### Part 1: Kibana Log Search
- [ ] Right-click on 8-digit SR link → Menu **enabled**
- [ ] Right-click on 9-digit SR link → Menu **enabled**
- [ ] Right-click on 7-digit number link → Menu **disabled**
- [ ] Right-click on text (not link) → Menu **disabled**
- [ ] Click enabled menu → Kibana opens in new tab
- [ ] Kibana URL contains correct SR number
- [ ] Works in Salesforce production and sandbox
- [ ] Works in iframes

### Part 2: Auto Error Trace Click
- [ ] Kibana page loads → Script waits for table
- [ ] Table with errors → First error trace clicked (bottom-to-top)
- [ ] Table with no errors → Nothing happens silently
- [ ] Table without Status Code column → Nothing happens
- [ ] Observer timeout (10s) → Stops watching
- [ ] Non-port-5601 pages → Script exits immediately
- [ ] Console shows `[ErrorTraceClick]` messages

### Part 3: Jaeger Auto-Expand
- [ ] Page load → Span bar expands automatically
- [ ] Span expanded → Logs accordion expands
- [ ] Logs expanded → Timestamp sections expand
- [ ] response.body visible without manual clicks
- [ ] Non-Jaeger pages → No errors, no action
- [ ] Console shows `[Middleware Log]` debug messages

### End-to-End
- [ ] Complete flow: Salesforce → Kibana → Jaeger works seamlessly
- [ ] Refresh Salesforce page after extension reload
- [ ] Extension icon visible in toolbar

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2026 | Initial release with Kibana search and Jaeger auto-expand |
| 1.1 | Jan 2026 | Added auto error trace click for Kibana dashboard |
