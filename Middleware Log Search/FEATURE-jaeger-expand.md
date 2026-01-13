# Feature: Jaeger Logs Accordion Auto-Expand

## Overview

Add functionality to automatically expand the "Logs" accordion section in Jaeger trace views when it contains a "response.body" entry.

## Problem Statement

When viewing traces in Jaeger, the "Logs" accordion is often collapsed by default. Users frequently need to manually click to expand it to see the response body content. This is repetitive when reviewing multiple traces.

**Goal**: Automatically expand the Logs accordion when the page contains a "response.body" log entry.

---

## Functional Requirements

### FR-1: Auto-Expand on Page Load
- The extension SHALL check for "response.body" text in table cells when a page loads
- If found, the extension SHALL expand the parent "Logs" accordion

### FR-2: Run on Any Page
- The feature SHALL run on all URLs (no URL pattern filtering)
- If no "response.body" element exists, the feature does nothing silently

### FR-3: Accordion State Detection
- If the accordion is already expanded (`is-open` class), do nothing
- Only click to expand if currently collapsed

---

## Technical Approach

### Target HTML Structure

The Jaeger UI uses this structure:
```html
<div class="AccordianLogs">
  <a class="AccordianLogs--header is-open" aria-checked="true" role="switch">
    <strong>Logs</strong> (1)
  </a>
  <div class="AccordianLogs--content">
    <table>
      <tbody class="KeyValueTable--body">
        <tr class="KeyValueTable--row">
          <td class="KeyValueTable--keyColumn">response.body</td>
          <td>...</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

### Detection Logic

1. Find all `<td>` elements on the page
2. Check if any cell's text content equals "response.body"
3. If found, traverse up to find `.AccordianLogs` container
4. Find `.AccordianLogs--header` within that container
5. Check if header has `is-open` class
6. If not expanded, click the header to expand

### Execution Timing

- Run once when DOM is ready (`document_idle` or `DOMContentLoaded`)
- No MutationObserver or retry logic in first version
- Can enhance later if dynamic loading causes issues

---

## Files to Modify

### 1. manifest.json

Add new content script entry for all URLs:
```json
"content_scripts": [
  {
    // Existing Salesforce content script
  },
  {
    "matches": ["<all_urls>"],
    "js": ["jaeger-expand.js"],
    "run_at": "document_idle",
    "all_frames": true
  }
]
```

Add host permissions:
```json
"host_permissions": ["<all_urls>"]
```

### 2. New file: jaeger-expand.js

Standalone content script that:
- Runs on any page
- Searches for "response.body" in table cells
- Expands the Logs accordion if found
- Logs actions to console with `[Middleware Log]` prefix

---

## Design Decisions

### DD-1: Separate Content Script
**Decision**: Create a new `jaeger-expand.js` file rather than adding to `content.js`.

**Rationale**:
- Keeps Salesforce-specific code separate from Jaeger-specific code
- Easier to maintain and debug
- Can be enabled/disabled independently in future

### DD-2: Run on All URLs
**Decision**: Use `<all_urls>` pattern instead of specific Jaeger URL.

**Rationale**:
- User preference to avoid URL patterns
- Avoids exposing internal server names in source code
- Feature does nothing harmful on non-Jaeger pages

### DD-3: No Highlighting
**Decision**: Only expand accordion, no visual highlighting of the row.

**Rationale**:
- User preference for minimal intervention
- Keep it simple for first version

### DD-4: Single Execution (No Retry)
**Decision**: Run once on page load without retry logic.

**Rationale**:
- Simpler implementation
- Can add retry/MutationObserver later if needed

---

## Testing Checklist

- [ ] Page with "response.body" in collapsed Logs → accordion expands automatically
- [ ] Page with "response.body" in already-expanded Logs → no action taken
- [ ] Page without "response.body" → no errors, no action
- [ ] Non-Jaeger page → no errors, no action
- [ ] Salesforce pages → existing SR context menu still works
- [ ] Console shows `[Middleware Log]` debug messages

---

## Future Enhancements (Out of Scope for v1)

- Scroll the response.body row into view
- Highlight the row with background color
- Add retry logic for dynamically loaded content
- Add options page to enable/disable this feature
- URL pattern configuration to limit where it runs
