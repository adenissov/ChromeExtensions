# Plan: Fix Multi-Section Processing and Add Multi-Tab Support

## Current Bugs Identified

### Bug 1: Shared State Pollution (CRITICAL)
**Problem**: Variables are shared across all section iterations, causing corruption after the first section.

**Affected Variables**:
- `indentStack` - Not reset between sections → wrong indentation
- `indent` - Not reset between sections → wrong formatting
- `validationErrMessages` - Correctly reset ✅
- `validationResultsMap` - Correctly reset ✅
- `jsonRootHtmlElement` - Correctly reset ✅

**Impact**: Only the first "HTTP Request Content" section on the current page is formatted correctly. Subsequent sections are corrupted.

**Location**: Lines 27-31, processing loop at lines 403-467

---

## Phase 1: Fix Current Multi-Section Processing (MUST FIX FIRST)

### Changes Required:

#### Change 1.1: Reset State Variables
**Location**: Inside the loop at line 403, before processing each section

**Add this code**:
```javascript
// For each INT-REQ-*** subTab, prettify JSON blocks on it
for (let i=0; i<httpsRequestSections.length; i++) {
    // RESET STATE for each section to prevent pollution
    indentStack = [];
    indent = "";
    validationErrMessages = [];
    validationResultsMap = new Map();
    
    var httpsRequestSection = httpsRequestSections[i];
    // ... rest of processing
}
```

**Why**: Ensures each section starts with clean state.

---

## Phase 2: Add Multi-Tab Processing (OPTION B)

### Current Limitation:

Salesforce pages have multiple sub-tabs (e.g., INT-REQ-001, INT-REQ-002, INT-REQ-003). Each tab is a separate view with its own "HTTP Request Content" section. The browser only renders the **currently active tab** in the DOM.

**Example Structure**:
```
Salesforce Page
├── Tab: INT-REQ-001 (ACTIVE - visible in DOM)
│   └── HTTP Request Content section ✅ Currently processed
├── Tab: INT-REQ-002 (INACTIVE - not in DOM)
│   └── HTTP Request Content section ❌ Not processed
└── Tab: INT-REQ-003 (INACTIVE - not in DOM)
    └── HTTP Request Content section ❌ Not processed
```

### Approaches to Process Inactive Tabs:

#### Approach A: Sequential Tab Activation (RECOMMENDED)
**Concept**: Programmatically click each tab, wait for it to load, process its content, then move to the next.

**Pros**:
- ✅ Works with Salesforce's lazy-loading architecture
- ✅ Content guaranteed to be in DOM when processed
- ✅ User can see progress (tabs switching)
- ✅ Reliable and predictable

**Cons**:
- ⚠️ Slower (sequential processing)
- ⚠️ Visually disruptive (tabs switching)
- ⚠️ Requires timing/waiting for tab loads

**Implementation Complexity**: Medium

---

#### Approach B: Hidden Processing (DIFFICULT)
**Concept**: Try to force-load inactive tab content without visual switching.

**Pros**:
- ✅ No visual disruption
- ✅ Could be faster

**Cons**:
- ❌ Salesforce may not render content without actual tab activation
- ❌ May violate Salesforce's rendering expectations
- ❌ High risk of failure
- ❌ Hard to debug

**Implementation Complexity**: High (may not work at all)

---

#### Approach C: Process Only Active Tab (CURRENT BEHAVIOR)
**Concept**: Fix the bug but keep single-tab processing.

**Pros**:
- ✅ Simple and reliable
- ✅ Fast
- ✅ No visual disruption
- ✅ User can manually switch tabs and re-run

**Cons**:
- ⚠️ User must manually switch to each tab and click extension button

**Implementation Complexity**: Low (just fix the bug)

---

## Recommended Solution: Approach A (Sequential Tab Activation)

### Implementation Plan:

### Step 1: Identify Tab Elements
**Goal**: Find all Salesforce sub-tab buttons/links on the page.

**Code Location**: Add before line 385 (before searching for sections)

**Pseudo-code**:
```javascript
// Find all Integration Request tabs
var integrationTabs = [];
var tabElements = document.querySelectorAll('[data-tab-value]'); // Or appropriate selector
for (each tabElement) {
    if (tabElement matches INT-REQ pattern) {
        integrationTabs.push(tabElement);
    }
}
```

**Challenge**: Need to identify the correct CSS selector for Salesforce tabs. This requires:
- Inspecting the actual Salesforce page HTML
- Finding the tab button/link elements
- Determining their unique identifiers

**Risk**: Salesforce's HTML structure may change, breaking the selector.

---

### Step 2: Sequential Tab Processing
**Goal**: Click each tab, wait for content, process, repeat.

**Code Structure**:
```javascript
async function processAllTabs() {
    var integrationTabs = findAllIntegrationTabs();
    
    for (let tabIndex = 0; tabIndex < integrationTabs.length; tabIndex++) {
        var tab = integrationTabs[tabIndex];
        
        // Activate the tab
        tab.click();
        
        // Wait for tab content to load
        await waitForTabToLoad(500); // 500ms delay, may need tuning
        
        // Process all "HTTP Request Content" sections in this tab
        processCurrentTabSections();
    }
}

function waitForTabToLoad(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
```

**Challenges**:
- **Timing**: How long to wait after clicking? Too short = content not loaded, too long = slow
- **Detection**: How to detect when tab is fully loaded? (no reliable event)
- **Errors**: What if a tab fails to load or has no content?

---

### Step 3: Process Each Tab's Sections
**Goal**: After each tab is activated, find and process its sections.

**Code** (existing logic, just needs to run multiple times):
```javascript
function processCurrentTabSections() {
    // Find all "HTTP Request Content" sections in currently active tab
    var httpsRequestSections = [];
    var pageSections = document.getElementsByClassName("test-id__section");
    
    for (each pageSection) {
        if (section title is "HTTP Request Content") {
            httpsRequestSections.push(section);
        }
    }
    
    // Process each section (with state reset - Bug fix from Phase 1)
    for (each section in httpsRequestSections) {
        // RESET STATE
        indentStack = [];
        indent = "";
        validationErrMessages = [];
        validationResultsMap = new Map();
        
        // Format and validate JSON
        processSection(section);
    }
}
```

---

### Step 4: User Feedback
**Goal**: Show progress to the user during multi-tab processing.

**Options**:
1. **Console logging**: Simple, minimal
   ```javascript
   console.log('Processing tab ' + (tabIndex + 1) + ' of ' + integrationTabs.length);
   ```

2. **Visual indicator**: Add a temporary overlay/banner
   ```javascript
   showProgressBanner('Processing tab ' + (tabIndex + 1) + ' of ' + totalTabs);
   ```

3. **Browser notification**: Use Chrome notifications API
   ```javascript
   chrome.notifications.create({
       type: 'basic',
       title: 'JSON Processor',
       message: 'Processing ' + totalTabs + ' tabs...'
   });
   ```

**Recommendation**: Start with console logging, add visual indicator later if needed.

---

## Implementation Phases

### Phase 1: Fix Bug (CRITICAL - Do First)
**Time Estimate**: 15 minutes  
**Risk**: Low  
**Impact**: High (makes current functionality work correctly)

**Changes**:
- Add state reset inside the processing loop
- Test with multiple sections on same tab

**Testing**:
1. Open Salesforce page with multiple INT-REQ tabs
2. Navigate to one tab that has multiple "HTTP Request Content" sections (if possible)
3. Click extension button
4. Verify all sections on current tab are formatted correctly

---

### Phase 2: Multi-Tab Discovery (Research)
**Time Estimate**: 1-2 hours  
**Risk**: Medium (depends on Salesforce HTML structure)

**Tasks**:
1. Inspect Salesforce page HTML in browser DevTools
2. Identify tab button elements and their selectors
3. Document the HTML structure
4. Create a test function to find all tabs
5. Verify it works across different Integration Request pages

**Deliverable**: Function that reliably finds all INT-REQ tab elements

---

### Phase 3: Sequential Processing Implementation
**Time Estimate**: 2-3 hours  
**Risk**: Medium

**Changes**:
- Refactor main logic into `processCurrentTabSections()`
- Create `findAllIntegrationTabs()` function
- Implement async tab switching with delays
- Add error handling for missing/failed tabs
- Add console logging for progress

**Testing**:
1. Page with 2 tabs
2. Page with 5+ tabs
3. Page with tabs containing errors
4. Verify each tab's content is processed correctly

---

### Phase 4: Optimization (Optional)
**Time Estimate**: 1-2 hours  
**Risk**: Low

**Possible improvements**:
- Dynamic wait time based on content detection
- Parallel processing (if feasible)
- Better error recovery
- Visual progress indicator
- Option to skip already-processed tabs

---

## Risks and Mitigations

### Risk 1: Salesforce HTML Changes
**Impact**: Extension breaks if Salesforce updates their HTML structure  
**Mitigation**: 
- Use flexible selectors where possible
- Add version detection
- Document the expected structure
- Add fallback to current single-tab behavior

### Risk 2: Timing Issues
**Impact**: Content not loaded when we try to process it  
**Mitigation**:
- Use generous wait times initially
- Add content detection logic
- Implement retry mechanism
- Allow user to configure delay

### Risk 3: Performance
**Impact**: Slow processing with many tabs  
**Mitigation**:
- Show progress indicator
- Allow user to cancel
- Process only visible/expanded sections
- Cache results to avoid reprocessing

### Risk 4: User Experience
**Impact**: Jarring visual tab switching  
**Mitigation**:
- Clear communication about what's happening
- Progress indicator
- Option to process only current tab
- Sound/notification when complete

---

## Alternative: Hybrid Approach

**Concept**: Provide both options via UI

**User Interface**:
```
Chrome Extension Popup:
┌─────────────────────────────────┐
│ JSON Formatter & Validator      │
├─────────────────────────────────┤
│ [Process Current Tab]           │ ← Fast, current behavior (fixed)
│ [Process All Tabs]              │ ← New, sequential processing
└─────────────────────────────────┘
```

**Benefits**:
- ✅ User choice
- ✅ Fast option for single tab
- ✅ Comprehensive option for all tabs
- ✅ No breaking changes

**Implementation**: Requires popup.html and popup.js modifications to add button handling.

---

## Recommendation

### Immediate Action (Phase 1):
**FIX THE BUG** - This is critical and affects current functionality.

### Next Decision Point:
After fixing the bug, test with real Salesforce pages to determine:
1. How common are multi-section pages (same tab, multiple sections)?
2. How common are multi-tab scenarios?
3. Is manual tab switching acceptable?

### If Multi-Tab Processing is Needed:
1. Implement Approach A (Sequential Tab Activation) with progress indicators
2. Keep current single-tab as an option
3. Add user choice in popup UI

---

## Questions to Answer Before Implementation

1. **Tab Structure**: What does the HTML look like for Salesforce tabs?
   - CSS selectors for tab buttons?
   - How to identify INT-REQ tabs vs other tabs?
   - Are tab IDs consistent?

2. **User Workflow**: How do you typically use the extension?
   - Do you want to process all tabs every time?
   - Or only occasionally?
   - Is tab switching disruption acceptable?

3. **Performance**: How many tabs are typical?
   - 2-3 tabs? (Fast sequential processing)
   - 10+ tabs? (Need progress indicator and optimization)

4. **Priority**: What's more important?
   - Fix the bug quickly (Phase 1 only)
   - Full multi-tab support (Phase 1 + 2 + 3)

---

## Summary

**Current Status**: 
- ✅ Code structure is correct (loops through sections)
- ❌ Bug: Shared state causes corruption after first section
- ❌ Inactive tabs not processed (DOM limitation)

**Recommended Path**:
1. **Phase 1** (15 min): Fix the shared state bug
2. **Test**: Verify multi-section processing works
3. **Phase 2** (1-2 hrs): Research tab structure
4. **Phase 3** (2-3 hrs): Implement sequential tab processing
5. **Phase 4** (optional): Optimize and polish

**Total Time Estimate**: 4-7 hours for complete multi-tab support

**Decision Needed**: 
- Fix bug only? (Phase 1 - fast, reliable)
- Add multi-tab? (Phase 1-3 - more time, more value)
