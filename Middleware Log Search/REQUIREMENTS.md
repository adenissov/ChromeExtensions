# Middleware Log Search - Requirements Specification

## Overview

A Chrome/Edge extension for City of Toronto 311 staff that enables quick access to middleware logs in Kibana directly from Service Request numbers displayed in Salesforce.

## Problem Statement

When troubleshooting Service Requests, staff need to examine middleware logs in Kibana. The current manual process requires:
1. Copying the SR number from Salesforce
2. Opening Kibana in a new tab
3. Navigating to the correct dashboard
4. Pasting the SR number into the search query
5. Executing the search

**Goal**: Reduce this multi-step process to 2 clicks: right-click on SR number → click menu item.

---

## Functional Requirements

### FR-1: Context Menu Integration
- The extension SHALL add a context menu item labeled **"Middleware Log"**
- The menu item SHALL appear in the browser's right-click context menu

### FR-2: Dynamic Menu Enable/Disable
- The menu item SHALL be **disabled** by default
- The menu item SHALL be **enabled** only when ALL of the following conditions are met:
  1. The right-clicked element is a hyperlink (`<a>` tag) or within a hyperlink
  2. The hyperlink text is exactly an 8-9 digit integer number
  3. The hyperlink is located in a table column with header "Request Number"

### FR-3: SR Number Validation
- Valid SR numbers: 8-9 digit integers (e.g., `08496105`, `084961051`)
- Invalid: 7 digits or fewer, 10 digits or more, contains letters or special characters

### FR-4: Column Header Validation
- The extension SHALL verify the clicked link is within a `<td>` cell
- The extension SHALL find the corresponding column header by matching column index
- The header text MUST contain "Request Number" (case-sensitive)
- Alternative: Header cell attributes (`title`, `aria-label`, `data-tooltip`) contain "Request Number"

### FR-5: Kibana URL Opening
- Upon clicking the enabled menu item, the extension SHALL open the following URL in a **new tab**:
```
http://portal.cc.toronto.ca:5601/app/dashboards#/view/c36f5e40-40fe-11ed-a166-53790178ef13?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-30d,to:now))&_a=(query:(language:kuery,query:'NNNNNNNN'),filters:!(),viewMode:view)
```
- `NNNNNNNN` SHALL be replaced with the validated SR number

### FR-6: Salesforce Domain Support
- The extension SHALL activate on the following URL patterns:
  - `https://*.salesforce.com/*`
  - `https://*.force.com/*`
  - `https://*.lightning.force.com/*`

### FR-7: iframe Support
- The extension SHALL work when SR tables are displayed within iframes
- Content script SHALL run with `all_frames: true`

---

## Non-Functional Requirements

### NFR-1: Performance
- Menu state update SHALL complete before the context menu renders (synchronous validation on right-click)
- Message passing between content script and background script SHALL be lightweight

### NFR-2: User Experience
- Disabled menu item provides clear feedback that the clicked element is not a valid SR
- No error dialogs or alerts for invalid clicks - menu simply stays disabled

### NFR-3: Reliability
- If validation timing fails (race condition), menu SHALL remain disabled (fail-safe default)
- Extension SHALL not interfere with normal Salesforce functionality

### NFR-4: Maintainability
- Code SHALL be well-commented with section headers
- Logging SHALL use `[Middleware Log]` prefix for easy filtering in console

---

## Design Decisions

### DD-1: Menu Disabled by Default
**Decision**: Create context menu with `enabled: false` initially.

**Rationale**: 
- Prevents users from clicking on invalid items
- Clear visual feedback (grayed out) when conditions aren't met
- Follows the pattern established in "SR to Integration Request Finder" extension

### DD-2: Validation on Right-Click (Not on Menu Click)
**Decision**: Validate the clicked element during the `contextmenu` event, before the menu appears.

**Rationale**:
- Menu state reflects validation result immediately
- Better UX than showing enabled menu that fails on click
- Allows background script to receive SR number before menu click

### DD-3: Store SR Number in Background Script
**Decision**: Content script sends SR number to background script during validation; background script stores it for use when menu is clicked.

**Rationale**:
- Background script handles the menu click event
- Avoids need for additional message round-trip on click
- Simpler than passing data through menu item properties

### DD-4: Column Header Required
**Decision**: Require the link to be in a "Request Number" column, unlike SR to Integration Request Finder which validates any 8-9 digit link.

**Rationale**:
- More precise targeting - reduces false positives
- Middleware logs are specifically tied to SR numbers, not other 8-digit IDs
- User explicitly requested this validation

### DD-5: Open in New Tab
**Decision**: Open Kibana URL in a new browser tab.

**Rationale**:
- Preserves user's current Salesforce context
- Allows comparison between Salesforce data and logs
- Standard behavior for opening external tools

### DD-6: HTTP (Not HTTPS) for Kibana
**Decision**: Use `http://` protocol for Kibana URL as provided.

**Rationale**:
- Internal portal URL as specified by user
- May be on internal network without SSL certificate

---

## Validation Rules Summary

| Condition | Check | Result if Fail |
|-----------|-------|----------------|
| Element is link | `element.closest('a')` | Menu disabled |
| Link text is 8-9 digits | `/^\d{8,9}$/` | Menu disabled |
| In table cell | `element.closest('td')` | Menu disabled |
| Column header = "Request Number" | Header text or attributes | Menu disabled |
| All conditions pass | - | Menu **enabled** |

---

## Out of Scope

- Authentication to Kibana (handled by browser/network)
- Customizable Kibana URL (hardcoded for now)
- Customizable column header name
- Search history or recent SR tracking
- Keyboard shortcuts
