# Implementation Plan - Auto-Trigger JSON Formatting v2.2

## Overview
Modify the Chrome extension to automatically trigger JSON formatting and validation when:
1. User switches between Salesforce INT-REQ-*** sub-tabs
2. Page loads/refreshes with an "HTTP Request Content" section visible

The manual popup button remains as a fallback option.

---

## Phase 1: Prepare content.js Structure

**Goal**: Set up the content script file structure to receive the formatting logic.

### Step 1.1: Clear Old Code
- Remove the old basic `reformatEmbeddedJson()` function from `content.js`
- Remove the auto-execute calls at the top
- Keep file ready for new code

### Step 1.2: Define New Structure
Create this skeleton in `content.js`:
```
// Configuration
const PROCESSING_DELAY_MS = 300;
let processingTimeout = null;

// Validation rules (moved from popup.js)
const validationRules = [...];  // All 7 rules

// Validation functions (moved from popup.js)
function performValidation() {...}
function executeValidationRule() {...}
function executeRegexRule() {...}
function executeConditionalRule() {...}
function executeCustomRule() {...}
function traverseAndValidate() {...}

// Formatting functions (moved from popup.js)
function insertJsonObjectIntoText() {...}
function appendFormattedJsonItem() {...}
function span() {...}

// Main processing function  
function processVisibleSections() {...}

// Event detection
function setupTabClickListeners() {...}
function setupMutationObserver() {...}

// Initialization
function init() {...}

// Entry point
init();
```

---

## Phase 2: Move Core Logic from popup.js to content.js

**Goal**: Transfer all formatting and validation code to content script.

### Step 2.1: Move Configuration
Move from `popup.js` to `content.js`:
- `indentIncrement` constant (value: 4)
- `validationRules` array (all 7 rules: 5 regex + 2 conditional for Toronto Water)

### Step 2.2: Move Validation Functions
Move these functions:
- `performValidation(jsonObject)` - Main orchestrator
- `executeValidationRule(rule, jsonObject)` - Rule dispatcher
- `executeRegexRule(rule, fieldValue, fieldPath)` - Regex validation
- `executeConditionalRule(rule, jsonObject)` - Cross-field validation
- `executeCustomRule(rule, fieldValue, fieldPath)` - Custom logic
- `traverseAndValidate(obj, rules, currentPath)` - JSON tree walker

### Step 2.3: Move Formatting Functions
Move these functions:
- `insertJsonObjectIntoText(key, value, parentElement, currentPath)` - Recursive JSON formatter
- `appendFormattedJsonItem(key, value, parentElement, isLastItemInBlock, currentPath)` - Field renderer
- `span(text, color, bold)` - HTML span helper

### Step 2.4: Move Section Processing Logic
Wrap the section-finding and processing loop in `processVisibleSections()`:
- Finding "HTTP Request Content" sections
- Expanding collapsed sections (click button if aria-expanded="false")
- Parsing JSON from header and body
- Running validation pass
- Rendering formatted output with color coding
- Displaying error messages
- "Already processed" check (look for `<pre>` tags)
- State reset between sections (indentStack, indent, validationErrMessages, validationResultsMap)

---

## Phase 3: Add Event Listeners

**Goal**: Detect tab switches and page load to trigger processing.

### Step 3.1: Tab Click Listener
```javascript
function setupTabClickListeners() {
    // Strategy: Use event delegation on document body
    // Listen for clicks on elements that look like tabs
    document.body.addEventListener('click', (event) => {
        // Check if clicked element is a tab (class contains 'tab' or role='tab')
        const target = event.target.closest('[role="tab"], .slds-tabs_default__link, .tabHeader');
        if (target) {
            console.log('Tab click detected');
            scheduleProcessing();
        }
    });
}
```

### Step 3.2: MutationObserver
```javascript
function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Check if any added node contains "HTTP Request Content"
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const sections = node.querySelectorAll ? 
                            node.querySelectorAll('.test-id__section-header-title') : [];
                        for (const section of sections) {
                            if (section.textContent === 'HTTP Request Content') {
                                console.log('New HTTP Request Content detected via MutationObserver');
                                scheduleProcessing();
                                return;
                            }
                        }
                    }
                }
            }
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}
```

### Step 3.3: Debouncing
```javascript
let processingTimeout = null;

function scheduleProcessing() {
    if (processingTimeout) {
        clearTimeout(processingTimeout);
    }
    processingTimeout = setTimeout(() => {
        processVisibleSections();
    }, PROCESSING_DELAY_MS);
}
```

---

## Phase 4: Initialize on Page Load

**Goal**: Run formatting automatically when page loads.

### Step 4.1: Init Function
```javascript
function init() {
    console.log('JSON Formatter v2.2 - Initializing');
    
    // Wait for Salesforce to finish initial render
    setTimeout(() => {
        // Process any visible sections
        processVisibleSections();
        
        // Set up listeners for future tab switches
        setupTabClickListeners();
        setupMutationObserver();
        
        console.log('JSON Formatter v2.2 - Ready');
    }, 500);  // 500ms initial delay for page load
}
```

### Step 4.2: Entry Point
At end of `content.js`:
```javascript
// Run when content script loads
init();
```

---

## Phase 5: Simplify popup.js

**Goal**: Keep popup button as manual trigger, simplified code.

### Option A: Direct Function Call (try first)
```javascript
let changeColor = document.getElementById("changeColor");

changeColor.addEventListener("click", async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            if (typeof processVisibleSections === 'function') {
                processVisibleSections();
            } else {
                console.error('Content script not loaded - processVisibleSections not found');
            }
        }
    });
});
```

### Option B: Message Passing (fallback if Option A fails)
```javascript
// In popup.js:
changeColor.addEventListener("click", async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'processNow' });
});

// In content.js (add at end):
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'processNow') {
        processVisibleSections();
    }
});
```

---

## Phase 6: Update manifest.json

**Goal**: Update version and description.

```json
{
  "name": "Expand JSON in Integration Request v2.2 (Auto-Trigger)",
  "description": "Auto-formats JSON and validates fields when switching Salesforce tabs",
  "version": "2.2",
  ...
}
```

Verify content script settings (should already be correct):
```json
"content_scripts": [{
    "matches": ["https://staff-cms.lightning.force.com/lightning/r/*"],
    "js": ["content.js"],
    "run_at": "document_idle",
    "all_frames": true
}]
```

---

## Phase 7: Testing

**Goal**: Verify all triggering scenarios work correctly.

### Test Cases

| # | Scenario | Expected Result |
|---|----------|-----------------|  
| 1 | Fresh page load with HTTP Request Content visible | Auto-formatted within 1 second |
| 2 | Click different INT-REQ tab | New tab auto-formatted after ~300ms |
| 3 | Click same tab again | No change (already processed) |
| 4 | Click popup button on unprocessed tab | Formatted immediately |
| 5 | Click popup button on already processed tab | No change |
| 6 | Refresh page (F5) | Re-formatted fresh |
| 7 | Page with validation errors | Errors highlighted in red, error list shown |
| 8 | Page without HTTP Request Content | No errors, silent |

### Debug Logging
During testing, keep these console.log statements:
- "JSON Formatter v2.2 - Initializing"
- "JSON Formatter v2.2 - Ready"
- "Tab click detected"
- "New HTTP Request Content detected via MutationObserver"
- "Processing X HTTP Request Content sections"
- "Section X already processed, skipping"

---

## File Change Summary

| File | Change Type | Lines (approx) |
|------|-------------|----------------|
| content.js | **Major Rewrite** | ~400 lines (was ~100) |
| popup.js | **Simplify** | ~15 lines (was ~490) |
| manifest.json | **Minor** | 3 lines changed |
| popup.html | **No Change** | - |
| button.css | **No Change** | - |
| background.js | **No Change** | - |

---

## Implementation Order

1. ✅ Create COMMIT_MESSAGE_v2.2.md
2. ✅ Create PLAN_AUTO_TRIGGER.md (this document)
3. ⬜ Phase 1: Prepare content.js structure
4. ⬜ Phase 2: Move core logic (validation + formatting)
5. ⬜ Phase 3: Add event listeners (click + MutationObserver)
6. ⬜ Phase 4: Add init function and entry point
7. ⬜ Phase 5: Simplify popup.js
8. ⬜ Phase 6: Update manifest.json
9. ⬜ Phase 7: Testing all scenarios

---

## Open Questions

1. **Tab selector**: What CSS selector identifies Salesforce INT-REQ tab buttons?
   - Will try: `[role="tab"]`, `.slds-tabs_default__link`, `.tabHeader`
   - May need inspection of actual page HTML

2. **Timing**: Is 300ms delay sufficient for Salesforce content loading?
   - Start with 300ms for tab switch, 500ms for initial load
   - Adjust based on testing

3. **Popup button**: Keep or remove after testing auto-trigger?
   - Keep for v2.2 as fallback
   - Consider removing in v2.3 if auto-trigger is reliable

---

## Rollback Plan

If auto-trigger causes issues:
1. Revert `content.js` to basic version (from v2.1)
2. Restore full `popup.js` with injected script
3. Revert `manifest.json` version to 2.1

All v2.1 code should be in git history for easy rollback.
