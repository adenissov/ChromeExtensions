# Discussion Notes: Auto-Click Trace on HTTP Error Feature

## Feature Summary

After opening the Middleware dashboard page, the extension should:
1. Detect the `table.osdDocTable` element
2. Walk the **Status Code** column from **bottom to top**
3. When an HTTP error code (`>= 300`) is found, click the **Trace** link in the same row
4. Stop after clicking the first error trace (most recent error)

## Confirmed Decisions

| Question | Decision |
|----------|----------|
| When to trigger? | **B + C**: User clicks extension icon, then wait for table to load |
| If no errors found? | Do nothing silently |
| Multiple errors? | Click only the **first one** when moving bottom-to-top |

## Unanswered Questions

### 1. Middleware Dashboard URL Pattern (REQUIRED)
Need the domain/path to configure content script injection in `manifest.json`.

**Example formats:**
- `https://middleware.toronto.ca/*`
- `https://*.corp.toronto.ca/app/discover*`
- `https://osd.toronto.ca/_dashboards/*`

**Action:** Provide the URL from browser address bar when on the Middleware dashboard.

### 2. Non-Middleware Page Behavior
When user clicks extension icon on a page that is NOT the Middleware dashboard:
- **Option A:** Ignore silently (do nothing)
- **Option B:** Show brief message "Navigate to Middleware dashboard first"

### 3. Delay/Detection Strategy
After page load, how to detect when table is ready:
- **Option A:** Fixed delay 1-2 seconds
- **Option B:** Fixed delay 3-5 seconds  
- **Option C:** Use MutationObserver to wait until table rows appear (recommended - more reliable)

## Implementation Plan

1. Create `error-trace-click.js` content script with IIFE pattern
2. Update `manifest.json` with new content script entry for Middleware URL
3. Implement column index detection via `data-test-subj` attributes
4. Implement bottom-to-top row iteration
5. Parse Status Code, detect `>= 300` errors
6. Click Trace link `<a>` element on first error found
7. Add MutationObserver for dynamic table loading
8. Add extension icon click handler in `background.js`

## Target Table Structure Reference

```html
<table class="osdDocTable table ng-scope">
  <thead>
    <tr class="osdDocTableHeader">
      <th><!-- expand toggle --></th>
      <th><span data-test-subj="docTableHeader-startTimeMillis">Time</span></th>
      <th><span data-test-subj="docTableHeader-Direction">Direction</span></th>
      <th><span data-test-subj="docTableHeader-HTTP URL">HTTP URL</span></th>
      <th><span data-test-subj="docTableHeader-HTTP Method">HTTP Method</span></th>
      <th><span data-test-subj="docTableHeader-Status Code">Status Code</span></th>
      <th><span data-test-subj="docTableHeader-Trace">Trace</span></th>
      <!-- ... more columns ... -->
    </tr>
  </thead>
  <tbody>
    <tr class="osdDocTable__row">
      <td><!-- toggle --></td>
      <td><!-- Time --></td>
      <td><!-- Direction --></td>
      <td><!-- HTTP URL --></td>
      <td><!-- HTTP Method --></td>
      <td><span ng-non-bindable="">400</span></td>  <!-- Status Code -->
      <td><a href="http://...trace/...">traceId</a></td>  <!-- Trace link to click -->
    </tr>
  </tbody>
</table>
```

## Key Selectors

| Element | Selector |
|---------|----------|
| Table | `table.osdDocTable` |
| Header cells | `thead th[data-test-subj="docTableHeaderField"]` |
| Column name | `span[data-test-subj^="docTableHeader-"]` |
| Data rows | `tbody tr.osdDocTable__row` |
| Cell value | `td span[ng-non-bindable]` |
| Trace link | `td a[href*="trace"]` |

---
*Last updated: January 17, 2026*
