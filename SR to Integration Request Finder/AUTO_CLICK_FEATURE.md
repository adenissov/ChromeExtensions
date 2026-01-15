# Auto-Click Single Search Result Feature

## Overview

This document describes a new feature that extends the "311 SR to Integration Request Finder" extension to automatically open an Integration Request when exactly one search result is found.

---

## Current Behavior

1. User right-clicks on SR number (e.g., `08475332`)
2. User selects "Search Integration Request" from context menu
3. Extension opens Salesforce global search
4. Extension enters `Request|08475332` in search box
5. Extension simulates pressing Enter
6. **Search results page appears** ← Extension stops here
7. User manually clicks on the Integration Request link

---

## New Behavior

After step 6 (search results appear), the extension will:

| # of Results | Action |
|--------------|--------|
| **0 results** | Do nothing (no matches found) |
| **1 result** | **Auto-click** the Integration Request link |
| **2+ results** | Do nothing (user must choose) |

This saves one additional click when there's an unambiguous match.

---

## Technical Specification

### Integration Request Link Pattern

Based on the provided HTML sample, Integration Request links have these characteristics:

```html
<a data-refid="recordId" 
   data-special-link="true" 
   title="INT-REQ-17213189" 
   data-navigable="true" 
   target="_blank" 
   data-recordid="a0EVt00000rCMnpMAG" 
   href="/lightning/r/a0EVt00000rCMnpMAG/view" 
   class="slds-truncate outputLookupLink forceOutputLookup">
   INT-REQ-17213189
</a>
```

**Identification criteria:**
- Element: `<a>` tag
- Attribute: `data-refid="recordId"`
- Text content matches: `/^INT-REQ-\d{8,9}$/` (e.g., `INT-REQ-17213189`)

### Search Results Container

Results appear in a table with these selectors:
```css
table.slds-table.forceRecordLayout
/* or within */
.forceSearchResultsGridView
```

### Timing Considerations

The search results page loads asynchronously. We need to:
1. Wait for results to appear after pressing Enter
2. Handle the case where results take time to load
3. Avoid acting prematurely on partial results
4. Set a reasonable timeout to stop waiting

**Approach: Polling with timeout**
- Start checking for results after Enter is pressed
- Poll every 300ms for up to 5 seconds
- Look for a stable result count (same count on consecutive checks)
- Auto-click if exactly 1 valid INT-REQ link is found

---

## Implementation Plan

### File to Modify
- `content.js` - Add result detection and auto-click logic

### New Functions to Add

#### 1. `waitForSearchResultsAndAutoClick()`
Main orchestrator function called after Enter is pressed.

```javascript
/**
 * Wait for search results to load, then auto-click if exactly one result
 * @param {number} maxWaitMs - Maximum time to wait for results (default: 5000ms)
 */
function waitForSearchResultsAndAutoClick(maxWaitMs = 5000) {
  // Start polling for results
  // Call checkSearchResults() repeatedly
}
```

#### 2. `findIntegrationRequestLinks()`
Finds all valid INT-REQ links in the search results.

```javascript
/**
 * Find all Integration Request links in current search results
 * @returns {HTMLElement[]} Array of matching <a> elements
 */
function findIntegrationRequestLinks() {
  // Query for links with data-refid="recordId"
  // Filter by INT-REQ-NNNNNNNN pattern
  // Return array of matching elements
}
```

#### 3. `autoClickSingleResult(link)`
Performs the click on a single result.

```javascript
/**
 * Auto-click on a single Integration Request link
 * @param {HTMLElement} link - The <a> element to click
 */
function autoClickSingleResult(link) {
  // Log the action
  // Simulate click
}
```

### Integration Point

In `enterSearchText()` function, after dispatching Enter key events, call the new wait function:

```javascript
// Current code ends with:
console.log('[IR Finder] Search triggered for:', searchText);

// Add after:
waitForSearchResultsAndAutoClick();
```

---

## Detailed Code Changes

### Section 1: Add New Configuration Constants

Location: After existing `SEARCH_PREFIX` constant (~line 14)

```javascript
// Auto-click configuration
const AUTO_CLICK_ENABLED = true;           // Feature toggle
const AUTO_CLICK_MAX_WAIT_MS = 5000;       // Max time to wait for results
const AUTO_CLICK_POLL_INTERVAL_MS = 300;   // How often to check for results
const AUTO_CLICK_STABLE_COUNT = 2;         // # of consistent checks before acting
const INT_REQ_PATTERN = /^INT-REQ-\d{8,9}$/;  // Pattern for valid INT-REQ names
```

### Section 2: Add New Functions

Location: After `findAndClickSearchButton()` function (~line 430)

Add three new functions:
1. `findIntegrationRequestLinks()`
2. `autoClickSingleResult(link)`
3. `waitForSearchResultsAndAutoClick()`

### Section 3: Modify `enterSearchText()` to Trigger Auto-Click

Location: Inside `enterSearchText()`, after the Enter key dispatch (~line 363)

Add call to `waitForSearchResultsAndAutoClick()` after search is triggered.

---

## Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| Results never load | Timeout after 5 seconds, log warning |
| Page navigation during wait | MutationObserver cleanup, abort polling |
| Multiple searches in quick succession | Use search cooldown (already exists) |
| Results container not found | Continue polling until timeout |
| Link click fails | Log error, user can click manually |

---

## Testing Scenarios

1. **Single result** - Search for SR with one Integration Request → Should auto-click
2. **No results** - Search for non-existent SR → Should do nothing
3. **Multiple results** - Search for SR with multiple Integration Requests → Should do nothing
4. **Slow load** - Results take 2-3 seconds to appear → Should still work
5. **Timeout** - Results never appear → Should stop after 5 seconds
6. **Rapid searches** - Search multiple SRs quickly → Should handle via existing cooldown

---

## Rollback Plan

If issues arise, the feature can be disabled by setting:
```javascript
const AUTO_CLICK_ENABLED = false;
```

This constant will be checked before initiating the auto-click logic.

---

## Future Enhancements (Out of Scope)

- User preference to enable/disable auto-click (popup settings)
- Visual indicator showing "Auto-clicking..." before navigation
- Handle different result page layouts (list view vs. instant results)
