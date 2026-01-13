# Middleware Log Search - Development Plan

## Overview

This document describes the architecture and implementation plan for the "Middleware Log Search" Chrome extension. Use this as a guide for code generation.

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐         ┌─────────────────────────┐    │
│  │  background.js  │         │      content.js          │    │
│  │ (Service Worker)│         │    (Page Script)         │    │
│  ├─────────────────┤         ├─────────────────────────┤    │
│  │                 │         │                          │    │
│  │ • Create context│  msg    │ • Listen for right-click │    │
│  │   menu (disabled)│ ◄──── │ • Validate: link, digits,│    │
│  │                 │         │   column header          │    │
│  │ • Update menu   │         │ • Send validation result │    │
│  │   enabled state │         │   + SR number            │    │
│  │                 │         │                          │    │
│  │ • On menu click:│         └─────────────────────────┘    │
│  │   open Kibana   │                                         │
│  │   URL with SR   │                                         │
│  └─────────────────┘                                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User right-clicks element
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
│ 3. Is column header     │
│    "Request Number"?    │
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
│ Context menu appears    │
│ (enabled or disabled)   │
└─────────────────────────┘
         │
         ▼ (if user clicks enabled menu)
┌─────────────────────────┐
│ background.js builds    │
│ Kibana URL with SR      │
│ Opens in new tab        │
└─────────────────────────┘
```

---

## File Structure

```
Middleware Log Search/
├── manifest.json      # Extension configuration
├── background.js      # Service worker: menu creation, click handling
├── content.js         # Content script: validation, SR extraction
├── REQUIREMENTS.md    # Requirements specification
├── PLAN.md            # This file
├── README.md          # User documentation (create after code)
└── images/            # Extension icons (copy from SR Finder)
    ├── sr_to_ir_finder_icon16.png
    ├── sr_to_ir_finder_icon32.png
    ├── sr_to_ir_finder_icon48.png
    └── sr_to_ir_finder_icon128.png
```

---

## Implementation Details

### 1. manifest.json

```json
{
  "name": "Middleware Log Search",
  "description": "Right-click on Service Request number to search middleware logs in Kibana",
  "version": "1.0",
  "manifest_version": 3,
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": [
        "https://*.salesforce.com/*",
        "https://*.force.com/*",
        "https://*.lightning.force.com/*"
      ],
      "js": ["content.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],
  "permissions": ["contextMenus", "activeTab", "tabs"],
  "action": {
    "default_title": "Middleware Log Search",
    "default_icon": {
      "16": "/images/sr_to_ir_finder_icon16.png",
      "32": "/images/sr_to_ir_finder_icon32.png",
      "48": "/images/sr_to_ir_finder_icon48.png",
      "128": "/images/sr_to_ir_finder_icon128.png"
    }
  },
  "icons": {
    "16": "/images/sr_to_ir_finder_icon16.png",
    "32": "/images/sr_to_ir_finder_icon32.png",
    "48": "/images/sr_to_ir_finder_icon48.png",
    "128": "/images/sr_to_ir_finder_icon128.png"
  }
}
```

### 2. background.js

**Constants:**
```javascript
const KIBANA_URL_TEMPLATE = "http://portal.cc.toronto.ca:5601/app/dashboards#/view/c36f5e40-40fe-11ed-a166-53790178ef13?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-30d,to:now))&_a=(query:(language:kuery,query:'NNNNNNNN'),filters:!(),viewMode:view)";
```

**State:**
```javascript
let lastValidSRNumber = null;
```

**Functions/Listeners:**
1. `chrome.runtime.onInstalled` - Create context menu with `enabled: false`
2. `chrome.runtime.onMessage` - Handle `updateMenuState` message, store SR, update menu
3. `chrome.contextMenus.onClicked` - Build URL, open in new tab

### 3. content.js

**Constants:**
```javascript
const SR_COLUMN_HEADER = 'Request Number';
const SR_NUMBER_PATTERN = /^\d{8,9}$/;
```

**State:**
```javascript
let lastRightClickedElement = null;
let lastSRNumber = null;
```

**Functions:**
1. `isInRequestNumberColumn(element)` - Navigate DOM to find column header, validate text
2. `extractSRNumber(element)` - Check link, validate digits, call column check
3. `contextmenu` event listener - Call extractSRNumber, send message to background

---

## Column Header Detection Algorithm

```javascript
function isInRequestNumberColumn(element) {
  // Step 1: Find table cell
  const cell = element.closest('td');
  if (!cell) return false;

  // Step 2: Find row and table
  const row = cell.closest('tr');
  const table = cell.closest('table');
  if (!row || !table) return false;

  // Step 3: Get column index
  const cells = Array.from(row.querySelectorAll('td, th'));
  const cellIndex = cells.indexOf(cell);

  // Step 4: Find header row
  const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
  const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
  const headerCell = headerCells[cellIndex];

  // Step 5: Check header text
  const headerText = headerCell.textContent.trim();
  if (headerText.includes('Request Number')) return true;

  // Step 6: Check Salesforce attributes
  if (headerCell.getAttribute('title')?.includes('Request Number')) return true;
  if (headerCell.getAttribute('aria-label')?.includes('Request Number')) return true;

  return false;
}
```

---

## Message Protocol

### Content → Background: `updateMenuState`
```javascript
{
  action: 'updateMenuState',
  isValid: boolean,      // true if all validations pass
  srNumber: string|null  // SR number if valid, null otherwise
}
```

---

## Testing Checklist

### Validation Tests
- [ ] Right-click on 8-digit SR link in "Request Number" column → Menu **enabled**
- [ ] Right-click on 9-digit SR link in "Request Number" column → Menu **enabled**
- [ ] Right-click on link NOT in "Request Number" column → Menu **disabled**
- [ ] Right-click on 7-digit number link → Menu **disabled**
- [ ] Right-click on 10-digit number link → Menu **disabled**
- [ ] Right-click on text (not link) → Menu **disabled**
- [ ] Right-click on non-numeric link → Menu **disabled**

### Functionality Tests
- [ ] Click enabled menu → Kibana opens in new tab
- [ ] Kibana URL contains correct SR number
- [ ] Original Salesforce tab remains open
- [ ] Works in Salesforce production
- [ ] Works in Salesforce sandbox
- [ ] Works when table is in iframe

---

## Code Reuse from SR to Integration Request Finder

| Component | Reuse Strategy |
|-----------|----------------|
| manifest.json structure | Copy and modify names/descriptions |
| Menu creation pattern | Copy, change menu ID and title |
| Menu enable/disable pattern | Copy directly |
| `contextmenu` listener structure | Copy, add column validation |
| `isInRequestNumberColumn()` | Copy from existing (currently unused there) |
| iframe handling | Simplified - not needed for URL opening |

---

## Differences from SR to Integration Request Finder

| Aspect | SR Finder | Middleware Log Search |
|--------|-----------|----------------------|
| Menu action | Search in Salesforce UI | Open external URL |
| Column validation | Optional (not enforced) | **Required** |
| Target URL | Salesforce search | Kibana dashboard |
| Complexity | High (DOM manipulation) | Low (just open URL) |
| iframe communication | Required (postMessage) | Not needed |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2026 | Initial release |
