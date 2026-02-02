# Design: Search All in Middleware Log

## Feature Overview

Add a new context menu item "Search All in Middleware Log" that processes all SR numbers in the Request Number column sequentially, performing the same middleware log search for each one.

---

## CRITICAL: Existing Code Bug

**Issue:** The `isInRequestNumberColumn()` function exists in content.js but is **NEVER CALLED**. Currently, ANY 8-9 digit link on the page enables the context menu, not just links in the "Request Number" column.

**Fix Required:** The contextmenu handler must call `isInRequestNumberColumn()` as part of validation.

```javascript
// Current (buggy):
const srNumber = extractSRNumber(event.target);
const isValid = srNumber !== null;

// Fixed:
const srNumber = extractSRNumber(event.target);
const isInColumn = isInRequestNumberColumn(event.target);
const isValid = srNumber !== null && isInColumn;
```

---

## User Flow

1. User right-clicks any cell in the **Request Number** column
2. Context menu shows:
   - "Search in Middleware Log" (enabled if clicked on valid SR link)
   - "Search All in Middleware Log" (enabled if clicked anywhere in Request Number column)
3. User clicks "Search All"
4. For each SR in the column (bottom to top):
   - SR link updates to `{SR} - Searching in the Middleware log...`
   - Kibana tab opens in background
   - If error found (status >= 300): Jaeger tab opens, extracts response body
   - If no error: SR shows `{SR} - Waiting for a BackEnd ID...`
   - Kibana/Jaeger tabs close automatically
   - Next SR begins processing
5. Process continues until all SRs are processed

---

## Architecture Changes

### 1. content.js

**Fix: Use `isInRequestNumberColumn()` in validation**
```javascript
document.addEventListener('contextmenu', (event) => {
  // Check if in Request Number column FIRST
  const isInColumn = isInRequestNumberColumn(event.target);

  // Extract SR number (for single-SR menu)
  const srNumber = extractSRNumber(event.target);
  const isValidSingleSR = srNumber !== null && isInColumn;

  // Collect all SRs (for Search All menu)
  let allItems = [];
  if (isInColumn) {
    allItems = collectAllSRNumbers(event.target);
  }

  // ... rest of handler
});
```

**New Function: `collectAllSRNumbers(clickedElement)`**
```javascript
function collectAllSRNumbers(clickedElement) {
  const cell = clickedElement.closest('td');
  if (!cell) return [];

  const row = cell.closest('tr');
  const table = cell.closest('table');
  if (!row || !table) return [];

  // Get column index
  const cells = Array.from(row.querySelectorAll('td, th'));
  const columnIndex = cells.indexOf(cell);
  if (columnIndex === -1) return [];

  // Get all data rows (skip header)
  const allRows = Array.from(table.querySelectorAll('tbody tr, tr:not(:first-child)'));

  // Process bottom-to-top
  const items = [];
  for (let i = allRows.length - 1; i >= 0; i--) {
    const rowCells = allRows[i].querySelectorAll('td');
    const targetCell = rowCells[columnIndex];
    if (!targetCell) continue;

    const link = targetCell.querySelector('a');
    if (!link) continue;

    // Extract SR number using existing logic
    const linkText = link.textContent.trim();
    const spaceIndex = linkText.indexOf(' ');
    const valueToValidate = spaceIndex !== -1 ? linkText.substring(0, spaceIndex) : linkText;

    if (!SR_NUMBER_PATTERN.test(valueToValidate)) continue;

    // Mark element with unique ID
    const elementId = `mwlog-${Date.now()}-${elementIdCounter++}`;
    link.setAttribute(ELEMENT_ID_ATTR, elementId);

    items.push({ srNumber: valueToValidate, elementId: elementId });
  }

  return items;
}
```

**Modified Message: Extend `updateMenuState`**
```javascript
safeSendMessage({
  action: 'updateMenuState',
  isValid: isValidSingleSR,           // For single SR menu
  srNumber: lastSRNumber,
  elementId: elementId,
  isValidColumn: isInColumn,          // NEW: For "Search All" menu
  allItems: allItems                  // NEW: All SR items in column
});
```

### 2. background.js

**New State Variables**
```javascript
// Queue processing state
let searchQueue = [];           // Array of {srNumber, elementId}
let currentSearchIndex = -1;    // Index of currently processing item
let isProcessingQueue = false;  // Flag to prevent concurrent processing

// Tab tracking for cleanup
let currentKibanaTabId = null;
let currentJaegerTabId = null;

// Stored items from last right-click (for "Search All")
let pendingAllItems = [];
```

**New Context Menu Item (in onInstalled)**
```javascript
chrome.contextMenus.create({
  id: 'middlewareLogSearchAll',
  title: 'Search All in Middleware Log',
  contexts: ['all'],
  enabled: false
});
```

**Modified: `updateMenuState` handler**
```javascript
if (message.action === 'updateMenuState') {
  // Existing single-SR logic...

  // NEW: Handle "Search All" menu state
  if (message.isValidColumn && message.allItems && message.allItems.length > 0) {
    pendingAllItems = message.allItems;
    chrome.contextMenus.update('middlewareLogSearchAll', { enabled: true });
  } else {
    pendingAllItems = [];
    chrome.contextMenus.update('middlewareLogSearchAll', { enabled: false });
  }

  // Disable single-SR menu if queue is processing
  if (isProcessingQueue) {
    chrome.contextMenus.update('middlewareLogSearch', { enabled: false });
  }
}
```

**New: `middlewareLogSearchAll` click handler**
```javascript
if (info.menuItemId === 'middlewareLogSearchAll') {
  if (isProcessingQueue) {
    console.log('[Middleware Log] Already processing queue, ignoring click');
    return;
  }

  if (pendingAllItems.length === 0) {
    console.log('[Middleware Log] No items to process');
    return;
  }

  // Initialize queue
  searchQueue = [...pendingAllItems];
  currentSearchIndex = -1;
  isProcessingQueue = true;

  console.log('[Middleware Log] Starting Search All with', searchQueue.length, 'items');
  processNextInQueue();
}
```

**New Function: `processNextInQueue()`**
```javascript
function processNextInQueue() {
  currentSearchIndex++;

  if (currentSearchIndex >= searchQueue.length) {
    // All done
    console.log('[Middleware Log] Queue processing complete');
    isProcessingQueue = false;
    currentSearchIndex = -1;
    searchQueue = [];
    return;
  }

  const item = searchQueue[currentSearchIndex];
  console.log('[Middleware Log] Processing', currentSearchIndex + 1, '/', searchQueue.length, '- SR:', item.srNumber);

  // Update tracking variables for message routing
  elementId = item.elementId;
  lastValidSRNumber = item.srNumber;

  // Update SR to "Searching..."
  chrome.tabs.sendMessage(sourceTabId, {
    action: 'updateSRDisplay',
    elementId: item.elementId,
    srNumber: item.srNumber,
    responseBody: 'Searching in the Middleware log...'
  }).catch(error => {
    console.log('[Middleware Log] Failed to update SR display:', error.message);
  });

  // Open Kibana (with tab ID tracking)
  const kibanaUrl = KIBANA_URL_TEMPLATE.replace('NNNNNNNN', item.srNumber);
  chrome.tabs.create({ url: kibanaUrl, active: false }, (tab) => {
    currentKibanaTabId = tab.id;

    // Set timeout for this item (30 seconds)
    setTimeout(() => {
      if (isProcessingQueue && currentSearchIndex < searchQueue.length) {
        const currentItem = searchQueue[currentSearchIndex];
        if (currentItem.srNumber === item.srNumber) {
          console.log('[Middleware Log] Timeout for SR:', item.srNumber);
          cleanupCurrentTabs();
          processNextInQueue();
        }
      }
    }, 30000);
  });
}
```

**New Function: `cleanupCurrentTabs()`**
```javascript
function cleanupCurrentTabs() {
  if (currentJaegerTabId) {
    chrome.tabs.remove(currentJaegerTabId).catch(() => {});
    currentJaegerTabId = null;
  }
  if (currentKibanaTabId) {
    chrome.tabs.remove(currentKibanaTabId).catch(() => {});
    currentKibanaTabId = null;
  }
}
```

**Modified: `openInBackground` handler**
```javascript
if (message.action === 'openInBackground') {
  console.log('[Middleware Log] Opening in background tab:', message.url);
  chrome.tabs.create({ url: message.url, active: false }, (tab) => {
    if (isProcessingQueue) {
      currentJaegerTabId = tab.id;  // Track for cleanup in queue mode
    }
  });
}
```

**Modified: `responseBodyExtracted` handler**
```javascript
if (message.action === 'responseBodyExtracted') {
  // ... existing update logic ...

  // Close tabs and process next (only in queue mode)
  if (isProcessingQueue) {
    cleanupCurrentTabs();
    processNextInQueue();
  }
}
```

**Modified: `noErrorsFound` handler**
```javascript
if (message.action === 'noErrorsFound') {
  // ... existing update logic ...

  // Close Kibana and process next (only in queue mode)
  if (isProcessingQueue) {
    cleanupCurrentTabs();
    processNextInQueue();
  }
}
```

### 3. error-trace-click.js

No changes required.

### 4. jaeger-expand.js

No changes required.

---

## Message Flow Diagram (Queue Mode)

```
Salesforce                    background.js                    Kibana/Jaeger
    │                              │                              │
    │ 1. updateMenuState           │                              │
    │    {allItems: [...]}         │                              │
    │─────────────────────────────>│                              │
    │                              │ Store items, enable menu     │
    │                              │                              │
    │ 2. User clicks "Search All"  │                              │
    │─────────────────────────────>│                              │
    │                              │ isProcessingQueue = true     │
    │                              │ processNextInQueue()         │
    │                              │                              │
    │ 3. updateSRDisplay           │                              │
    │    "Searching..."            │                              │
    │<─────────────────────────────│                              │
    │                              │                              │
    │                              │ 4. Create Kibana tab         │
    │                              │    (store currentKibanaTabId)│
    │                              │─────────────────────────────>│
    │                              │                              │
    │                              │ 5. openInBackground (Jaeger) │
    │                              │    (store currentJaegerTabId)│
    │                              │<─────────────────────────────│
    │                              │─────────────────────────────>│
    │                              │                              │
    │                              │ 6. responseBodyExtracted     │
    │                              │<─────────────────────────────│
    │                              │                              │
    │ 7. updateSRDisplay           │                              │
    │    {actual error}            │                              │
    │<─────────────────────────────│                              │
    │                              │                              │
    │                              │ 8. cleanupCurrentTabs()      │
    │                              │    (close both tabs)         │
    │                              │─────────────────────────────>│
    │                              │                              │
    │                              │ 9. processNextInQueue()      │
    │                              │    (repeat from step 3)      │
```

---

## Tab Lifecycle

| Event | Kibana Tab | Jaeger Tab |
|-------|------------|------------|
| processNextInQueue() | Created, ID stored in `currentKibanaTabId` | - |
| openInBackground (queue mode) | - | Created, ID stored in `currentJaegerTabId` |
| responseBodyExtracted (queue mode) | Closed | Closed |
| noErrorsFound (queue mode) | Closed | (never opened) |
| Timeout (30s) | Closed | Closed |
| **Single SR mode** | **NOT closed** | **NOT closed** |

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| SR validation fails during collection | Skip that row, continue collecting |
| Kibana tab fails to load | Timeout after 30s, close tab, process next |
| Jaeger never sends response | Timeout after 30s, close tabs, process next |
| No response.body in Jaeger | Show "Waiting for BackEnd ID...", close tabs, process next |
| Salesforce tab closed | Updates fail silently, processing continues |
| Extension reloaded mid-process | Queue lost, user must restart |
| Tab already closed when trying to close | `.catch(() => {})` handles gracefully |

---

## Edge Cases

| Edge Case | Solution |
|-----------|----------|
| User clicks single SR while queue processing | Single-SR menu disabled during queue processing |
| User clicks "Search All" while already processing | Ignore click (`isProcessingQueue` check) |
| Empty column or no valid SRs | Menu disabled (`allItems.length === 0`) |
| Same SR appears multiple times | Process each separately (different elementIds) |
| User right-clicks elsewhere before clicking menu | `pendingAllItems` gets overwritten, menu state updates |
| Column has mix of valid/invalid entries | Only valid SRs collected and processed |

---

## Behavioral Differences: Single vs Queue Mode

| Aspect | Single SR Mode | Queue Mode (Search All) |
|--------|----------------|-------------------------|
| Tabs closed after? | No | Yes |
| Timeout? | No | Yes (30s per item) |
| Blocks other operations? | No | Yes (disables single-SR menu) |
| Shows "Searching..."? | Yes | Yes |

---

## Implementation Order

### Phase 1: Fix Existing Bug
- Add `isInRequestNumberColumn()` call to contextmenu handler
- Test that single-SR menu only enables for Request Number column

### Phase 2: content.js - Collection
- Add `collectAllSRNumbers()` function
- Extend `updateMenuState` message with `isValidColumn` and `allItems`
- Test that all SRs are collected correctly

### Phase 3: background.js - Menu & State
- Add new context menu item
- Add new state variables
- Add `updateMenuState` handler for "Search All"
- Test menu enables/disables correctly

### Phase 4: background.js - Queue Processing
- Add `processNextInQueue()` function
- Add `cleanupCurrentTabs()` function
- Add timeout mechanism
- Modify handlers for queue mode

### Phase 5: Testing
- Test single SR still works (tabs NOT closed)
- Test Search All processes all items
- Test tabs close after each item
- Test timeout handling
- Test error scenarios
- Test edge cases

---

## Summary of Changes

| File | Changes |
|------|---------|
| content.js | Fix: call `isInRequestNumberColumn()`. Add: `collectAllSRNumbers()`. Extend: `updateMenuState` message |
| background.js | Add: new menu item, queue state, `processNextInQueue()`, `cleanupCurrentTabs()`, timeout. Modify: all handlers for queue mode |
| error-trace-click.js | None |
| jaeger-expand.js | None |
