# 311 SR to Integration Request Finder - Technical Architecture

## Overview

This document describes the technical architecture and design decisions for the Chrome extension. For user documentation, see [README.md](README.md).

---

## Component Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Chrome Extension                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌──────────────────┐                                                        │
│  │  background.js   │                                                        │
│  │ (Service Worker) │                                                        │
│  ├──────────────────┤                                                        │
│  │ • Create context │                                                        │
│  │   menu on install│                                                        │
│  │ • Handle menu    │                                                        │
│  │   click events   │                                                        │
│  │ • Handle icon    │                                                        │
│  │   click events   │                                                        │
│  └────────┬─────────┘                                                        │
│           │ messages                                                          │
│           ▼                                                                   │
│  ┌──────────────────────────────┐    ┌────────────────────────────────────┐ │
│  │       content.js             │    │    content-json-formatter.js       │ │
│  │    (IR Finder Script)        │    │      (JSON Formatter Script)       │ │
│  ├──────────────────────────────┤    ├────────────────────────────────────┤ │
│  │ • Listen for right-click     │    │ • Auto-trigger on page load        │ │
│  │ • Extract SR number          │    │ • Format JSON with indentation     │ │
│  │ • Validate SR format         │    │ • Validate fields against rules    │ │
│  │ • Update menu state          │    │ • Highlight invalid values         │ │
│  │ • Execute Salesforce search  │    │ • Display error summary            │ │
│  │ • Auto-click single result   │    │ • Listen for manual trigger        │ │
│  └──────────────────────────────┘    └────────────────────────────────────┘ │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration, permissions, URL patterns |
| `background.js` | Service worker: context menu, icon click handling |
| `content.js` | Content script: SR detection, search execution, auto-click |
| `content-json-formatter.js` | Content script: JSON formatting, validation |
| `README.md` | User documentation |
| `PLAN.md` | This file - technical architecture |
| `images/` | Extension icons |

---

## Permissions

| Permission | Purpose |
|------------|---------|
| `contextMenus` | Add "Search Integration Request" to right-click menu |
| `activeTab` | Access current tab to send messages |
| `scripting` | Inject content scripts into Salesforce pages |
| `tabs` | Query and communicate with tabs |

---

## Data Flow: SR to IR Finder

```
User right-clicks SR number
         │
         ▼
┌─────────────────────────┐
│ contextmenu event fired │
│ (content.js)            │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Extract SR number from  │
│ link text (8-9 digits)  │
│ Send updateMenuState    │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ User clicks "Search     │
│ Integration Request"    │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ background.js sends     │
│ searchIntegrationRequest│
│ message to content.js   │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Open search dialog      │
│ Enter "Request|{SR}"    │
│ Trigger Enter key       │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Poll for INT-REQ links  │
│ (every 300ms, max 5sec) │
└─────────────────────────┘
         │
         ├──── 0 results ────► Do nothing
         │
         ├──── 1 result ─────► Auto-click (opens INT-REQ)
         │
         └──── 2+ results ───► User must choose
```

---

## Data Flow: JSON Formatter

```
Page load / Tab switch / Icon click
         │
         ▼
┌─────────────────────────┐
│ Find "HTTP Request      │
│ Content" sections       │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Expand collapsed section│
│ Parse JSON content      │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Run validation rules    │
│ Store results in Map    │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Render formatted JSON   │
│ with color highlighting │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Display error summary   │
│ (if any invalid fields) │
└─────────────────────────┘
```

---

## Key Technical Decisions

### 1. Salesforce iframe Architecture

**Challenge**: Salesforce Lightning uses multi-iframe structure. SR data is in iframe, search box is in top frame.

**Solution**: 
- Content scripts run with `"all_frames": true`
- Detect frame type: `const IS_TOP_FRAME = (window === window.top)`
- Cross-frame communication via `window.postMessage()`

### 2. Search Box is a Button

**Challenge**: Salesforce global search is a **button** that opens a dialog, not a text input.

**Solution**:
1. Find and click the search button
2. Wait for dialog to appear
3. Find input inside the opened dialog
4. Set value and trigger search

### 3. Setting Input Values in Lightning Components

**Challenge**: `input.value = "text"` doesn't work in Lightning (React-like framework).

**Solution**: Use native property setter to bypass React:

```javascript
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;
nativeInputValueSetter.call(searchBox, searchText);
searchBox.dispatchEvent(new Event('input', { bubbles: true }));
```

### 4. Auto-Click with Stability Check

**Challenge**: Search results load asynchronously; avoid clicking prematurely.

**Solution**: Polling with stability requirement:
- Poll every 300ms for up to 5 seconds
- Count INT-REQ links matching `INT-REQ-NNNNNNNN` pattern
- Require same count on 2 consecutive checks
- Auto-click only if exactly 1 stable result

### 5. Keyboard Events for Lightning

**Challenge**: Lightning needs specific key properties to recognize Enter key.

**Solution**: Include legacy and modern key properties:

```javascript
new KeyboardEvent('keydown', {
  key: 'Enter',
  code: 'Enter',
  keyCode: 13,
  which: 13,
  bubbles: true,
  composed: true  // Important for Shadow DOM
});
```

### 6. JSON Validation Architecture

**Decision**: Declarative rule-based validation system.

**Rationale**:
- Easy to add new rules without code changes
- Consistent validation behavior
- Separation of rules from rendering logic

**Rule Types**:
- `regex` - Pattern matching on field values
- `conditional` - Cross-field validation with preconditions
- `custom` - Complex custom logic

---

## Configuration Constants

### IR Finder (content.js)

```javascript
const SR_COLUMN_HEADER = 'Request Number';
const SEARCH_PREFIX = 'Request|';
const AUTO_CLICK_ENABLED = true;
const AUTO_CLICK_MAX_WAIT_MS = 5000;
const AUTO_CLICK_POLL_INTERVAL_MS = 300;
const AUTO_CLICK_STABLE_COUNT = 2;
const INT_REQ_PATTERN = /^INT-REQ-\d{8,9}$/;
const SEARCH_COOLDOWN = 2000;
const RIGHT_CLICK_FRESHNESS = 5000;
```

### JSON Formatter (content-json-formatter.js)

```javascript
const PROCESSING_DELAY_MS = 300;
const INITIAL_DELAY_MS = 500;
const indentIncrement = 4;
const jsonKeyColor = "grey";
const jsonValueDefaultColor = "black";
const jsonValueValidColor = "green";
const jsonValueInvalidColor = "red";
```

---

## URL Pattern Matching

```json
"matches": [
  "https://*.salesforce.com/*",
  "https://*.force.com/*",
  "https://*.lightning.force.com/*"
]
```

Covers production, sandbox, scratch orgs, and Lightning domains.

---

## Timing and Delays

| Operation | Delay | Reason |
|-----------|-------|--------|
| After clicking search button | 100ms polling | Wait for dialog |
| After dialog closes | 300ms | Animation completion |
| After setting input value | 200ms | Framework state update |
| After Enter key | 300ms | Search initiation |
| Result polling interval | 300ms | Balance speed vs performance |
| Initial page load | 500ms | Salesforce render completion |
| Tab switch debounce | 300ms | Prevent duplicate processing |

---

## Testing Checklist

### IR Finder
- [ ] Right-click on 8-digit SR → Menu enabled
- [ ] Right-click on 9-digit SR → Menu enabled
- [ ] Right-click on non-link → Menu disabled
- [ ] Right-click on wrong digit count → Menu disabled
- [ ] Search executes correctly
- [ ] Single result auto-clicks
- [ ] Multiple results shows list
- [ ] Works in iframes
- [ ] Works after page navigation

### JSON Formatter
- [ ] Auto-formats on page load
- [ ] Auto-formats on tab switch
- [ ] Manual trigger via icon click
- [ ] Valid fields shown in green
- [ ] Invalid fields shown in red bold
- [ ] Error summary displayed
- [ ] Skips already-processed sections
- [ ] Works on INT-REQ pages

---

## Debugging

Console messages are prefixed for easy filtering:
- `[IR Finder]` - SR to Integration Request Finder
- `[JSONFormatter]` - JSON Formatter & Validator

Key debug points:
- Menu state updates
- SR number detection
- Cross-frame communication
- Search dialog interaction
- Auto-click decisions
- Validation results
