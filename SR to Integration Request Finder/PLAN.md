# 311 SR to Integration Request Finder - Development Plan

## Overview

This document describes the architecture and development decisions for the "311 SR to Integration Request Finder" Chrome extension.

## Problem Statement

City of Toronto 311 staff working in Salesforce frequently need to navigate from a Service Request (SR) to its corresponding Integration Request. The manual process is time-consuming:

1. Open App Launcher
2. Click "View All"
3. Scroll to "Integration Requests" in All Items
4. Click to open Integration Requests list
5. Select a custom view or filter
6. Configure filter: `Identifier contains Request|{SR_NUMBER}`
7. Click the Integration Request link

**Goal**: Reduce this 7-step process to 2 clicks.

## Solution Architecture

### Approach: Context Menu + Global Search

Instead of using Salesforce APIs (which require authentication), we leverage:
1. **Browser Context Menu**: Native right-click menu integration
2. **Salesforce Global Search**: Built-in search that finds Integration Requests by Identifier

### Why This Approach?

| Approach | Pros | Cons | Chosen |
|----------|------|------|--------|
| Salesforce REST API | Direct record access | Requires OAuth, complex auth | ❌ |
| Global Search URL | Simple, works everywhere | Need to know URL format | ❌ |
| **Context Menu + Search Box** | No auth needed, reliable | Requires DOM manipulation | ✅ |
| List View with Filter | Familiar UI | Tied to specific view | ❌ |

### Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Chrome Extension                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐         ┌─────────────────────────┐   │
│  │  background.js  │         │      content.js          │   │
│  │  (Service Worker)│        │   (Page Script)          │   │
│  ├─────────────────┤         ├─────────────────────────┤   │
│  │                 │         │                          │   │
│  │ • Create context│  msg    │ • Listen for right-click │   │
│  │   menu on install│ ────► │ • Extract SR number      │   │
│  │                 │         │ • Find search box        │   │
│  │ • Handle menu   │         │ • Execute search         │   │
│  │   click events  │         │                          │   │
│  │                 │         │                          │   │
│  └─────────────────┘         └─────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

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
│ link text (e.g. 08475332)│
│ Store in lastSRNumber   │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ User clicks "Search     │
│ Integration Request"    │
│ (context menu)          │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ background.js receives  │
│ contextMenus.onClicked  │
│ Sends message to content│
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ content.js receives msg │
│ Builds search string:   │
│ "Request|08475332"      │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Find global search box  │
│ Set value, trigger Enter│
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Salesforce shows search │
│ results with matching   │
│ Integration Request     │
└─────────────────────────┘
```

## Key Design Decisions

### 1. URL Pattern Matching

**Decision**: Use broad Salesforce domain patterns instead of specific URLs.

```json
"matches": [
  "https://*.salesforce.com/*",
  "https://*.force.com/*"
]
```

**Rationale**: 
- Works on production, sandbox, and scratch orgs
- No maintenance when URLs change
- More flexible for different Salesforce environments

### 2. SR Number Detection

**Decision**: Accept any 7-10 digit number as a potential SR number.

```javascript
/^\d{7,10}$/
```

**Rationale**:
- SR numbers are typically 8 digits (e.g., `08475332`)
- Allowing 7-10 provides flexibility
- Column header validation is optional (fallback behavior)

### 3. Search String Format

**Decision**: Use `Request|{SR_NUMBER}` format.

**Rationale**:
- Matches the Integration Request Identifier field format
- The `|` character helps narrow search results
- Confirmed working via manual testing

### 4. Search Execution Method

**Decision**: Manipulate DOM to set search value and simulate Enter key.

```javascript
searchBox.value = searchText;
searchBox.dispatchEvent(new Event('input', { bubbles: true }));
searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ... }));
```

**Rationale**:
- Works without API authentication
- Uses native Salesforce search
- More reliable than URL-based search

## File Structure

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration, permissions, URL patterns |
| `background.js` | Service worker: creates context menu, handles clicks |
| `content.js` | Content script: SR detection, search execution |
| `README.md` | User documentation |
| `PLAN.md` | This file - architecture documentation |
| `images/` | Extension icons (reusing Validator icons temporarily) |

## Permissions

| Permission | Purpose |
|------------|---------|
| `contextMenus` | Add "Search Integration Request" to right-click menu |
| `activeTab` | Access current tab to send messages |
| `scripting` | Inject content script into Salesforce pages |

## Future Enhancements

### Potential Improvements

1. **Custom Icons**: Design unique icons for this extension
2. **Direct Navigation**: If only one result, auto-open the Integration Request
3. **Keyboard Shortcut**: Add hotkey to search selected text
4. **History**: Remember recent searches
5. **Multiple SR Support**: Search for multiple SRs at once

### Known Limitations

1. **Manual Click Required**: User must click the search result to open IR
2. **Search Box Must Be Visible**: Global search must be on screen
3. **Single SR Only**: Cannot search multiple SRs simultaneously

## Testing Checklist

- [ ] Right-click on SR number shows context menu
- [ ] Clicking menu item triggers search
- [ ] Search box receives correct value (`Request|{SR_NUMBER}`)
- [ ] Enter key is triggered, search executes
- [ ] Works on production Salesforce
- [ ] Works on sandbox Salesforce
- [ ] Error message shown if search box not found
- [ ] Error message shown if no valid SR number

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2026 | Initial release |

## Related Projects

- **311 Integration Request Validator** (`c:\_Alex\2022-01-21 Chrome Extensions\2026-01-05 Chrome Ext Expand JSON Content`)
  - Auto-formats JSON in Integration Request records
  - Validates field values with regex and conditional rules
  - Same Salesforce environment, complementary functionality
