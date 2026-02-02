# Response Body Extraction & Cross-Tab Update

## Overview

This document describes the new functionality being added to the "311 Middleware Log Search" Chrome extension to automatically extract error information from Jaeger and display it alongside the SR number in Salesforce.

## Current Behavior

1. User right-clicks an SR number link in Salesforce
2. Extension validates it's an 8-9 digit number in a "Request Number" column
3. User clicks "Search in Middleware Log" context menu
4. Kibana dashboard opens with the SR number pre-filled
5. User manually clicks through to Jaeger trace
6. Extension auto-expands accordions to reveal log details

## New Functionality

After the accordions expand in Jaeger, the extension will:
1. Extract the `response.body` value from the Jaeger trace logs
2. Send this value back to the original Salesforce tab
3. Replace the SR number link with: `{SR number} - {response body value}`

### Example Result

**Before:** `123456789` (clickable link)
**After:** `123456789 - Error 400: BMXAA4121E - The value for a CLOB data type could not be read.` (plain text)

## Message Flow

```
Salesforce Tab              background.js                 Jaeger Tab
     |                           |                            |
     | 1. updateMenuState        |                            |
     |    {srNumber, elementId}  |                            |
     |-------------------------->|                            |
     |                           | Store sourceTabId          |
     |                           | Store elementId            |
     |                           |                            |
     | 2. User clicks menu       |                            |
     |-------------------------->|                            |
     |                           | Open Kibana (-> Jaeger)    |
     |                           |                            |
     |                           | 3. responseBodyExtracted   |
     |                           |    {responseBody}          |
     |                           |<---------------------------|
     |                           |                            |
     | 4. updateSRDisplay        |                            |
     |    {srNumber, responseBody, elementId}                 |
     |<--------------------------|                            |
     |                           |                            |
     | Replace link with text    |                            |
```

## Jaeger DOM Structure

The target data is in a KeyValueTable row:

```html
<tr class="KeyValueTable--row">
  <td class="KeyValueTable--keyColumn">response.body</td>
  <td>
    <div class="ub-inline-block">
      <div class="json-markup">
        <span class="json-markup-string">Error 400: BMXAA4121E - ...</span>
      </div>
    </div>
  </td>
  <td class="KeyValueTable--copyColumn">...</td>
</tr>
```

**Extraction target:** Text content of `span.json-markup-string` in the second `<td>` when first `<td>` contains "response.body"

---

## File Changes

### 1. content.js (Salesforce)

**New constants:**
- `ELEMENT_ID_ATTR = 'data-mwlog-id'` - attribute name for marking elements

**New state:**
- `elementIdCounter` - counter for generating unique element IDs

**Changes to contextmenu handler:**
- Generate unique ID: `mwlog-{timestamp}-{counter}`
- Mark the clicked link with `data-mwlog-id` attribute
- Include `elementId` in the `updateMenuState` message

**New message listener:**
- Listen for `updateSRDisplay` action
- Find element by `data-mwlog-id` attribute
- Replace the link with a span containing `{SR} - {responseBody}`

### 2. background.js

**New state:**
- `sourceTabId` - ID of the Salesforce tab that initiated the search
- `elementId` - ID of the marked element to update

**Changes to updateMenuState handler:**
- Store `sender.tab.id` as `sourceTabId`
- Store `message.elementId` as `elementId`

**New message handler for `responseBodyExtracted`:**
- Receive `responseBody` from Jaeger tab
- Forward to Salesforce tab via `updateSRDisplay` message
- Include `elementId`, `srNumber`, and `responseBody`

### 3. jaeger-expand.js

**New functions:**
- `extractResponseBody()` - finds and extracts value from KeyValueTable
- `sendResponseBodyToBackground()` - sends extracted value to background script
- `attemptExtraction()` - wrapper with duplicate-prevention flag

**New state:**
- `responseBodyExtracted` - flag to prevent duplicate sends

**Changes to expandLogsAccordions:**
- Call `attemptExtraction()` after expanding accordions (with 300ms delay)

**Changes to MutationObserver:**
- Also trigger extraction when KeyValueTable content appears

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `response.body` not found in Jaeger | Log warning, do not update Salesforce |
| Salesforce tab closed | `chrome.tabs.sendMessage` fails gracefully |
| Marked element not found in Salesforce | Log warning, skip update |
| Extension context invalidated | Existing error handling applies |

## Retry Logic

- Extraction attempts: up to 5 retries with 500ms delays
- Gives time for Jaeger UI to fully render KeyValueTable content

---

## Testing Checklist

1. [ ] Load extension in Chrome/Edge developer mode
2. [ ] Open Salesforce with an SR number link (8-9 digits)
3. [ ] Right-click SR link - verify element gets `data-mwlog-id` attribute (DevTools)
4. [ ] Select "Search in Middleware Log" - Kibana opens
5. [ ] Wait for auto-click - Jaeger opens
6. [ ] Wait for accordions to expand - verify response.body is visible
7. [ ] Check Salesforce tab - SR link should be replaced with `{SR} - {response body}`
8. [ ] Check console logs for `[Middleware Log]` messages at each step

---

## Console Log Messages

New log messages to expect:

**Jaeger tab:**
- `[Middleware Log] Extracting response.body...`
- `[Middleware Log] Response body found: {value}`
- `[Middleware Log] Response body sent to background`
- `[Middleware Log] Response body not found (attempt X/5)`

**Background:**
- `[Middleware Log] Stored source tab ID: {id}, element ID: {id}`
- `[Middleware Log] Received response body, forwarding to tab {id}`

**Salesforce tab:**
- `[Middleware Log] SR display updated: {SR} - {value}`
- `[Middleware Log] Could not find element to update: {elementId}`
