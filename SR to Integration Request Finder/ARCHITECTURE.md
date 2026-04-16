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
│  │ • Parse SR number            │    │ • Format JSON with indentation     │ │
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

## content.js - Detailed Architecture

### Module Structure

```
content.js
├── CONFIGURATION (constants)
│   ├── SEARCH_PREFIX           - Search query prefix ("Request|")
│   ├── AUTO_CLICK_ENABLED      - Feature toggle
│   ├── AUTO_CLICK_MAX_WAIT_MS  - Polling timeout (5000ms)
│   ├── AUTO_CLICK_POLL_INTERVAL_MS - Polling interval (300ms)
│   ├── AUTO_CLICK_STABLE_COUNT - Required stable checks (2)
│   ├── INT_REQ_PATTERN         - Regex for INT-REQ-NNNNNNNN
│   ├── SR_NUMBER_PATTERN       - Regex for 8-9 digit numbers
│   └── IS_TOP_FRAME            - Frame detection flag
│
├── STATE
│   ├── lastSRNumber            - Most recent valid SR from right-click
│   └── lastRightClickTime      - Timestamp of last right-click
│
├── SR NUMBER PARSING
│   ├── parseSRNumber(text)     - Core validation function
│   └── extractSRNumber(element)- DOM element extraction (unused, kept for utility)
│
├── RIGHT-CLICK DETECTION
│   └── contextmenu listener    - Captures clicks, validates SR, updates menu
│
├── SEARCH FUNCTIONALITY
│   ├── searchIntegrationRequest(srNumber) - Main search orchestrator
│   ├── openSearchAndEnterText(searchText) - Opens search dialog
│   ├── waitForSearchInput(searchText, attempts) - Polls for input
│   ├── enterSearchText(searchBox, searchText) - Sets value, triggers search
│   ├── findGlobalSearchBox()   - Locates search input element
│   └── findAndClickSearchButton() - Locates search button
│
├── AUTO-CLICK FUNCTIONALITY
│   ├── findIntegrationRequestLinks() - Finds INT-REQ result links
│   ├── autoClickSingleResult(link) - Clicks the link
│   └── waitForSearchResultsAndAutoClick() - Polling orchestrator
│
├── MESSAGE LISTENER
│   └── chrome.runtime.onMessage - Handles background script messages
│
└── INITIALIZATION
    ├── window.message listener - Cross-frame SR communication
    └── window.irFinderTriggerSearch - Fallback trigger function
```

### Core Function: parseSRNumber(text)

This is the **single source of truth** for SR number validation. All SR validation flows through this function.

```javascript
function parseSRNumber(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Extract value before first space (consistent with Middleware Log Search)
  const spaceIndex = trimmed.indexOf(' ');
  const valueToValidate = spaceIndex !== -1 ? trimmed.substring(0, spaceIndex) : trimmed;

  return SR_NUMBER_PATTERN.test(valueToValidate) ? valueToValidate : null;
}
```

**Validation Logic:**
1. Return `null` if input is empty/null
2. Trim whitespace from input
3. Find first space character (if any)
4. Extract substring before space (or entire string if no space)
5. Test against `SR_NUMBER_PATTERN` (`/^\d{8,9}$/`)
6. Return validated SR number or `null`

**Usage Locations:**
- `contextmenu` event handler (line 90)
- `extractSRNumber()` function (lines 66, 70)
- Message listener for `linkText` validation (line 522)

---

## Data Flow: SR to IR Finder

```
User right-clicks SR number link
         │
         ▼
┌─────────────────────────────┐
│ contextmenu event fired     │
│ (content.js)                │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ parseSRNumber() extracts    │
│ and validates SR number     │
│ (handles "08475332 Text")   │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Send updateMenuState to     │
│ background.js               │
│ { isValid, isLink, srNumber }│
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ background.js enables/      │
│ disables context menu       │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ User clicks "Search         │
│ Integration Request"        │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ background.js sends         │
│ searchIntegrationRequest    │
│ message to content.js       │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Check if SR is "fresh"      │
│ (within 5 seconds)          │
└─────────────────────────────┘
         │
         ├──── In iframe ────► postMessage to top frame
         │
         └──── In top frame ──► Execute search directly
                    │
                    ▼
         ┌─────────────────────────────┐
         │ Open search dialog          │
         │ Enter "Request|{SR}"        │
         │ Trigger Enter key           │
         └─────────────────────────────┘
                    │
                    ▼
         ┌─────────────────────────────┐
         │ Poll for INT-REQ links      │
         │ (every 300ms, max 5sec)     │
         └─────────────────────────────┘
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

### 1. Centralized SR Validation with parseSRNumber()

**Challenge**: SR validation logic was duplicated in 4 locations, making maintenance difficult.

**Solution**: Single `parseSRNumber(text)` function that handles all validation:
- Accepts raw text input
- Handles trailing descriptive text (e.g., "08475332 Customer Issue")
- Returns validated 8-9 digit number or null
- Consistent with sibling "Middleware Log Search" extension

**Benefits**:
- Single point of change for validation logic
- Easy to test (pure function)
- Consistent behavior across all code paths

### 2. Space-Split Extraction Pattern

**Challenge**: Salesforce sometimes displays SR numbers with descriptive text (e.g., "08475332 Customer Issue").

**Solution**: Extract value before first space:
```javascript
const spaceIndex = text.indexOf(' ');
const valueToValidate = spaceIndex !== -1 ? text.substring(0, spaceIndex) : text;
```

**Why not regex?**
- Matches existing pattern in Middleware Log Search extension
- Explicit extraction logic is easier to understand and debug
- Clearly separates extraction from validation

### 3. Salesforce iframe Architecture

**Challenge**: Salesforce Lightning uses multi-iframe structure. SR data is in iframe, search box is in top frame.

**Solution**:
- Content scripts run with `"all_frames": true`
- Detect frame type: `const IS_TOP_FRAME = (window === window.top)`
- Cross-frame communication via `window.postMessage()`

### 4. Search Box is a Button

**Challenge**: Salesforce global search is a **button** that opens a dialog, not a text input.

**Solution**:
1. Find and click the search button
2. Wait for dialog to appear (polling with 100ms intervals)
3. Find input inside the opened dialog
4. Set value and trigger search

### 5. Setting Input Values in Lightning Components

**Challenge**: `input.value = "text"` doesn't work in Lightning (React-like framework).

**Solution**: Use native property setter to bypass React:

```javascript
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;
nativeInputValueSetter.call(searchBox, searchText);
searchBox.dispatchEvent(new Event('input', { bubbles: true }));
```

### 6. Auto-Click with Stability Check

**Challenge**: Search results load asynchronously; avoid clicking prematurely.

**Solution**: Polling with stability requirement:
- Poll every 300ms for up to 5 seconds
- Count INT-REQ links matching `INT-REQ-NNNNNNNN` pattern
- Require same count on 2 consecutive checks
- Auto-click only if exactly 1 stable result

### 7. Keyboard Events for Lightning

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

### 8. JSON Validation Architecture

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
// Search configuration
const SEARCH_PREFIX = 'Request|';              // Prefix for search query
const SEARCH_COOLDOWN = 2000;                  // ms between duplicate searches

// SR validation
const SR_NUMBER_PATTERN = /^\d{8,9}$/;         // 8-9 digit numbers

// Auto-click configuration
const AUTO_CLICK_ENABLED = true;               // Feature toggle
const AUTO_CLICK_MAX_WAIT_MS = 5000;           // Max polling time
const AUTO_CLICK_POLL_INTERVAL_MS = 300;       // Polling interval
const AUTO_CLICK_STABLE_COUNT = 2;             // Required stable checks
const INT_REQ_PATTERN = /^INT-REQ-\d{8,9}$/;   // Pattern for result links

// Freshness
const RIGHT_CLICK_FRESHNESS = 5000;            // ms SR number stays valid

// Frame detection
const IS_TOP_FRAME = (window === window.top);
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

## State Variables

### content.js

| Variable | Type | Purpose |
|----------|------|---------|
| `lastSRNumber` | `string\|null` | Most recent validated SR from right-click |
| `lastRightClickTime` | `number` | Timestamp of last right-click (for freshness check) |
| `lastSearchTime` | `number` | Timestamp of last search (for cooldown) |
| `lastSearchSR` | `string\|null` | Last searched SR number (for duplicate prevention) |

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
| SR freshness window | 5000ms | Time SR stays valid after right-click |
| Search cooldown | 2000ms | Prevent duplicate searches |

---

## Message Types

### content.js → background.js

| Action | Payload | Purpose |
|--------|---------|---------|
| `updateMenuState` | `{ isValid, isLink, srNumber }` | Enable/disable context menu |

### background.js → content.js

| Action | Payload | Purpose |
|--------|---------|---------|
| `searchIntegrationRequest` | `{ linkUrl, linkText, frameId }` | Trigger search |
| `processNow` | (none) | Trigger JSON formatting |

### iframe → top frame (postMessage)

| Type | Payload | Purpose |
|------|---------|---------|
| `IR_FINDER_SEARCH` | `{ srNumber }` | Forward SR to top frame for search |

---

## Testing Checklist

### IR Finder - SR Validation
- [ ] `08475332` → Menu enabled, extracts `08475332`
- [ ] `08475332 Customer Issue` → Menu enabled, extracts `08475332`
- [ ] `084753321` (9 digits) → Menu enabled, extracts `084753321`
- [ ] `08475332ABC` (no space) → Menu disabled
- [ ] `ABC08475332` → Menu disabled
- [ ] `0847533` (7 digits) → Menu disabled
- [ ] `0847533212` (10 digits) → Menu disabled
- [ ] Non-link element → Menu disabled

### IR Finder - Search Flow
- [ ] Search executes correctly
- [ ] Single result auto-clicks
- [ ] Multiple results shows list
- [ ] Works in iframes
- [ ] Works after page navigation
- [ ] Cooldown prevents duplicate searches

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

### Key Debug Messages

| Message | Meaning |
|---------|---------|
| `[IR Finder] parseSRNumber: {...}` | Shows validation details (input, extracted value, result) |
| `[IR Finder] Valid SR number detected: X` | SR passed validation |
| `[IR Finder] Link text is not a valid SR number: X` | SR failed validation |
| `[IR Finder] Menu state updated: enabled/disabled` | Context menu state changed |
| `[IR Finder] Using fresh SR from this frame: X` | SR within freshness window |
| `[IR Finder] SR number exists but is stale` | SR exceeded freshness window |
| `[IR Finder] In iframe, sending SR to top frame` | Cross-frame communication |
| `[IR Finder] Found N INT-REQ link(s)` | Auto-click polling result |
| `[IR Finder] Auto-clicking single result` | About to auto-click |

### Common Issues

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| Menu always disabled | parseSRNumber returning null | Check console for validation details |
| "Extension context invalidated" | Extension reloaded without page refresh | Refresh the Salesforce page |
| Search not triggering | Frame communication issue | Check IS_TOP_FRAME and postMessage logs |
| Auto-click not working | Multiple results or timeout | Check INT-REQ link count in console |

---

## Future Maintenance

### Adding New SR Format Support

Modify `parseSRNumber()` to handle new formats:

```javascript
function parseSRNumber(text) {
  // ... existing logic ...

  // Add new format handling here
  // Example: support for "SR-12345678" format
  if (valueToValidate.startsWith('SR-')) {
    valueToValidate = valueToValidate.substring(3);
  }

  return SR_NUMBER_PATTERN.test(valueToValidate) ? valueToValidate : null;
}
```

### Adding New Search Prefix

Modify `SEARCH_PREFIX` constant:

```javascript
const SEARCH_PREFIX = 'Request|';  // Change this value
```

### Adjusting Auto-Click Behavior

Modify auto-click constants:

```javascript
const AUTO_CLICK_ENABLED = true;        // Set to false to disable
const AUTO_CLICK_MAX_WAIT_MS = 5000;    // Increase for slow connections
const AUTO_CLICK_STABLE_COUNT = 2;      // Increase for more stability
```
