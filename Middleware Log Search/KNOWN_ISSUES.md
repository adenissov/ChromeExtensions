# Known Issues and Solutions

## Salesforce Table Reflow Issue

### Problem
After the extension adds error text to SR cells in Salesforce, the table rows expand to fit the content but the table container's bottom boundary stays fixed. This causes bottom rows to be "eaten up" or clipped by the fixed container height.

**Symptoms:**
- Error text is added and the cell expands vertically
- Only the Request Number column cells expand
- The table's bottom boundary doesn't move down
- Bottom rows become hidden/clipped
- Manually dragging a row header boundary triggers proper reflow

### Root Cause
Salesforce wraps tables in multiple nested `<div>` containers with fixed or constrained heights. When cell content expands, these parent containers don't automatically recalculate their height to accommodate the new content.

### Solution
The fix involves two parts:

**1. CSS overrides for table containers**

Added CSS rules that target the table, tbody, and parent containers to remove height constraints:

```css
/* Allow table and its containers to grow */
table:has(.mwlog-expanded-cell),
table:has(.mwlog-expanded-cell) tbody {
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
}
.mwlog-expanded-table-container {
  height: auto !important;
  max-height: none !important;
  min-height: unset !important;
  overflow: visible !important;
}
```

**2. Programmatically add class to parent containers**

The `triggerSalesforceTableReflow()` function adds the `.mwlog-expanded-table-container` class to 5 levels of parent elements above the table:

```javascript
function triggerSalesforceTableReflow(tableElement) {
  if (!tableElement) return;

  let parent = tableElement.parentElement;
  for (let i = 0; i < 5 && parent; i++) {
    parent.classList.add('mwlog-expanded-table-container');
    parent = parent.parentElement;
  }

  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
  });
}
```

### Alternative Approaches Tried (Did Not Work)
- **Width manipulation**: Temporarily changing container width by 1px did not trigger reflow
- **Window resize event alone**: Dispatching `resize` event without CSS overrides was insufficient

### Files Modified
- `content.js`: Added CSS rules and `triggerSalesforceTableReflow()` function

### Date Resolved
2026-02-03
