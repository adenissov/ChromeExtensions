# Plan: Dynamic Context Menu Enable/Disable for SR Numbers

## Overview

Modify the "311 SR to Integration Request Finder" extension to dynamically enable/disable the "Search Integration Request" context menu item based on whether the right-clicked element is:
1. A link (`<a>` tag)
2. Contains an 8-9 digit integer number as its text

## Current Behavior

- Context menu item "Search Integration Request" is **always visible** on links and selections
- Validation of SR number happens **after** menu click
- If invalid, the search proceeds but may produce no results

## Desired Behavior

- Context menu item should be **enabled** only when:
  - Right-clicked element IS a link (`<a>` tag or child of `<a>`)
  - Link text IS exactly an 8-digit integer number
- Context menu item should be **disabled** (grayed out) otherwise

---

## Technical Approach

### Option A: Update Menu on Right-Click (Recommended)

**Flow:**
1. User right-clicks on an element
2. Content script's `contextmenu` event fires (before menu appears)
3. Content script validates the clicked element
4. Content script sends validation result to background script
5. Background script calls `chrome.contextMenus.update()` to enable/disable
6. Context menu appears with correct state

**Pros:**
- Clean user experience (menu shows correct state immediately)
- No wasted clicks on invalid items

**Cons:**
- Timing is critical - update must complete before menu renders
- May need to set menu as disabled by default

### Option B: Always Show, Validate on Click

**Flow:**
1. Menu item always visible/enabled
2. On click, validate and show error if invalid

**Pros:**
- Simpler implementation
- No timing issues

**Cons:**
- Poor UX (user clicks expecting action, gets error)
- Current behavior essentially

---

## Files to Modify

### 1. content.js

**Location:** `C:\repos_adenissov\ChromeExtensions\SR to Integration Request Finder\content.js`

**Changes:**

#### A. Update `contextmenu` event listener (~line 30)

Current:
```javascript
document.addEventListener('contextmenu', (event) => {
  lastRightClickedElement = event.target;
  lastSRNumber = null;
  lastRightClickTime = Date.now();
  
  const srNumber = extractSRNumber(event.target);
  if (srNumber) {
    lastSRNumber = srNumber;
    console.log('[IR Finder] Detected SR number:', srNumber);
  }
});
```

New (add after existing code):
```javascript
document.addEventListener('contextmenu', (event) => {
  lastRightClickedElement = event.target;
  lastSRNumber = null;
  lastRightClickTime = Date.now();
  
  // Check if clicked element is a link
  const link = event.target.closest('a');
  const isLink = link !== null;
  
  // Extract and validate SR number (8-9 digits)
  let isValidSR = false;
  if (isLink) {
    const linkText = link.textContent.trim();
    isValidSR = /^\d{8,9}$/.test(linkText);
    if (isValidSR) {
      lastSRNumber = linkText;
      console.log('[IR Finder] Valid SR number detected:', linkText);
    }
  }
  
  // Send validation result to background script to enable/disable menu
  chrome.runtime.sendMessage({
    action: 'updateMenuState',
    isValid: isLink && isValidSR,
    isLink: isLink,
    srNumber: isValidSR ? lastSRNumber : null
  });
});
```

#### B. Update `extractSRNumber` function (~line 45)

Change regex from `/^\d{7,10}$/` to `/^\d{8,9}$/` for 8-9 digits.

Current:
```javascript
if (!/^\d{7,10}$/.test(linkText)) {
  return null;
}
```

New:
```javascript
if (!/^\d{8,9}$/.test(linkText)) {
  return null;
}
```

---

### 2. background.js

**Location:** `C:\repos_adenissov\ChromeExtensions\SR to Integration Request Finder\background.js`

**Changes:**

#### A. Modify context menu creation (~line 9)

Add `enabled: false` as default state:

Current:
```javascript
chrome.contextMenus.create({
  id: 'searchIntegrationRequest',
  title: 'Search Integration Request',
  contexts: ['link', 'selection']
});
```

New:
```javascript
chrome.contextMenus.create({
  id: 'searchIntegrationRequest',
  title: 'Search Integration Request',
  contexts: ['all'],  // Show on all contexts, control via enabled state
  enabled: false      // Disabled by default
});
```

#### B. Add message listener for menu state updates

Add new listener after existing code:

```javascript
// Listen for validation results from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateMenuState') {
    // Update context menu enabled state
    chrome.contextMenus.update('searchIntegrationRequest', {
      enabled: message.isValid
    });
    console.log('[IR Finder] Menu state updated:', message.isValid ? 'enabled' : 'disabled');
  }
});
```

---

## Validation Logic Summary

| Condition | Menu State |
|-----------|------------|
| Not a link | **Disabled** |
| Link, but text is not 8-9 digits | **Disabled** |
| Link, text has letters | **Disabled** |
| Link, text is 7 digits (e.g., "1234567") | **Disabled** |
| Link, text is 10 digits (e.g., "1234567890") | **Disabled** |
| Link, text is 8 digits (e.g., "08496105") | **Enabled** |
| Link, text is 9 digits (e.g., "084961051") | **Enabled** |

---

## Questions to Confirm

1. **Digit count**: Should it be 8-9 digits, or a different range?
   - Plan assumes: **8-9 digits**

2. **Column validation**: Should we also check if the link is in a "Request Number" column?
   - Plan assumes: **No** (any link with 8-digit text qualifies)

3. **Selection context**: Should the menu appear for selected text (not in a link)?
   - Plan assumes: **No** (only for links)

4. **Error handling**: If menu update fails due to timing, should we fall back to current behavior?
   - Plan assumes: **Yes** (graceful degradation)

---

## Testing Checklist

- [ ] Right-click on 8-digit SR link → Menu **enabled**
- [ ] Right-click on 9-digit SR link → Menu **enabled**
- [ ] Right-click on 7-digit number link → Menu **disabled**
- [ ] Right-click on 10-digit number link → Menu **disabled**
- [ ] Right-click on text (not link) → Menu **disabled**
- [ ] Right-click on non-numeric link → Menu **disabled**
- [ ] Right-click on empty area → Menu **disabled**
- [ ] Menu works correctly after page navigation
- [ ] Menu works correctly in iframes

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Timing: Menu may show before update completes | Set default to disabled; if timing fails, user just can't click |
| Multiple iframes send conflicting messages | Last message wins; this matches user's actual right-click location |
| Performance: Message on every right-click | Messages are lightweight; negligible impact |

---

## Estimated Changes

| File | Lines Added | Lines Modified |
|------|-------------|----------------|
| content.js | ~15 | ~5 |
| background.js | ~12 | ~3 |
| **Total** | ~27 | ~8 |
