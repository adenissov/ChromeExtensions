# 311 SR to Integration Request Finder

A Chrome/Edge extension for City of Toronto 311 staff that allows quick navigation from a Service Request to its corresponding Integration Request in Salesforce.

## Purpose

When working with Service Requests in Salesforce, staff often need to view the Integration Request associated with a specific SR. The manual process involves:
1. Going to App Launcher
2. Clicking "View All"
3. Scrolling to "Integration Requests"
4. Opening a list view
5. Configuring filters to search by Identifier

**This extension reduces that to 2 clicks**: right-click on SR number → click search result.

## How It Works

1. **Right-click** on a Service Request number (e.g., `08475332`) in any "Request Number" column
2. Select **"Search Integration Request"** from the context menu
3. The extension automatically:
   - Captures the SR number from the link text
   - Opens the Salesforce global search dialog
   - Enters the search query: `Request|{SR_NUMBER}`
   - Triggers the search
4. **Click** on the Integration Request in the search results

## Features

- **Context Menu Integration**: Adds "Search Integration Request" option to right-click menu
- **Smart SR Detection**: Recognizes 7-10 digit numbers as Service Request numbers
- **Column Validation**: Optionally validates the link is in a "Request Number" column
- **Global Search**: Uses Salesforce's built-in global search
- **Works Everywhere**: Functions on all Salesforce domains (production, sandbox)
- **Multi-Search Support**: Can search multiple different SRs consecutively

---

## Architecture & Design Decisions

This section documents key technical decisions for future reference when building similar Salesforce extensions.

### 1. Salesforce iframe Architecture

**Challenge**: Salesforce Lightning uses a complex multi-iframe structure. The SR data is often displayed in an iframe, while the search box is in the top-level frame.

**Solution**: 
- Content script runs with `"all_frames": true` in manifest
- Use `window === window.top` to detect if running in top frame or iframe
- Cross-frame communication via `window.postMessage()` API

```javascript
// Detect frame type
const IS_TOP_FRAME = (window === window.top);

// From iframe, send data to top frame
if (!IS_TOP_FRAME) {
  window.top.postMessage({ 
    type: 'IR_FINDER_SEARCH', 
    srNumber: srNumber 
  }, '*');
}

// In top frame, listen for messages
if (IS_TOP_FRAME) {
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'IR_FINDER_SEARCH') {
      // Handle the search
    }
  });
}
```

### 2. Salesforce Search Box is a BUTTON, Not an Input

**Challenge**: The Salesforce global search appears to be an input field but is actually a **button** that opens a search dialog when clicked.

**Solution**:
1. First, look for the search **button** (not input)
2. Click the button to open the search dialog
3. Wait for the dialog to appear
4. Find the input inside the opened dialog
5. Enter text and trigger search

```javascript
// Search button selectors (NOT input!)
const buttonSelectors = [
  'button.search-button[aria-label="Search"]',
  'button.search-button',
  'button[aria-label="Search"]'
];

// After clicking button, find input in dialog
const searchInput = document.querySelector('.forceSearchAssistantDialog input[type="search"]');
```

### 3. Setting Input Values in React/Lightning Components

**Challenge**: Salesforce uses Lightning Web Components (built on React-like framework). Simply setting `input.value = "text"` doesn't work because the framework manages state internally.

**Solution**: Use native property setter to bypass React's synthetic events:

```javascript
// Get the native setter (bypasses React)
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;

// Set value using native setter
nativeInputValueSetter.call(searchBox, searchText);

// Dispatch input events so framework recognizes the change
searchBox.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
searchBox.dispatchEvent(new InputEvent('input', {
  bubbles: true,
  cancelable: true,
  inputType: 'insertText',
  data: searchText
}));
```

### 4. Triggering Enter Key in Lightning Components

**Challenge**: Keyboard events need specific properties for Lightning to recognize them.

**Solution**: Include all possible key-related properties:

```javascript
const keydownEvent = new KeyboardEvent('keydown', {
  key: 'Enter',
  code: 'Enter',
  keyCode: 13,      // Legacy but still needed
  which: 13,        // Legacy but still needed
  charCode: 13,     // Legacy but still needed
  bubbles: true,
  cancelable: true,
  composed: true,   // Important for Shadow DOM
  view: window
});
searchBox.dispatchEvent(keydownEvent);
```

### 5. Handling Multiple Searches (State Management)

**Challenge**: When searching for a second SR, the previous search state interferes. The search dialog may already be open, or old SR numbers persist.

**Solutions implemented**:

1. **Close existing dialog before new search**:
```javascript
const existingDialog = document.querySelector('.forceSearchAssistantDialog');
if (existingDialog) {
  // Press Escape to close
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true
  }));
  // Wait for close, then proceed
  setTimeout(() => openSearchAndEnterText(searchText), 300);
}
```

2. **Freshness-based SR validation**:
```javascript
let lastRightClickTime = 0;
const RIGHT_CLICK_FRESHNESS = 5000; // 5 seconds

// Only use SR if recently captured
if (lastSRNumber && (Date.now() - lastRightClickTime) < RIGHT_CLICK_FRESHNESS) {
  srNumber = lastSRNumber;
}
```

3. **Duplicate search prevention**:
```javascript
let lastSearchTime = 0;
let lastSearchSR = null;
const SEARCH_COOLDOWN = 2000;

// Prevent duplicate searches for same SR within cooldown
if (lastSearchSR === srNumber && (now - lastSearchTime) < SEARCH_COOLDOWN) {
  return; // Skip duplicate
}
```

### 6. Avoiding Autocomplete Suggestions

**Challenge**: When typing in search, Salesforce shows autocomplete suggestions. Clicking on these may lead to wrong results.

**Solution**: Do NOT click on suggestions. Instead, trigger Enter key to perform a full search:

```javascript
// DON'T do this - leads to wrong results:
// suggestion.click();

// DO this - triggers full search:
searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ... }));
```

### 7. Right-Click Detection Across Frames

**Challenge**: Right-click happens in iframe, but context menu click event is received by all frames. Each frame needs to know if IT was the one that detected the SR.

**Solution**: Track right-click timestamp per frame:

```javascript
document.addEventListener('contextmenu', (event) => {
  lastRightClickTime = Date.now();  // Track when THIS frame got right-click
  lastSRNumber = extractSRNumber(event.target);
});

// Later, only use SR if this frame recently received a right-click
const timeSinceRightClick = Date.now() - lastRightClickTime;
if (lastSRNumber && timeSinceRightClick < 5000) {
  // This frame has fresh data
}
```

### 8. Timing and Delays

**Lesson learned**: Salesforce Lightning is asynchronous. Always use appropriate delays:

| Operation | Recommended Delay |
|-----------|-------------------|
| After clicking search button | 100ms polling, up to 2 seconds |
| After dialog closes | 300ms before opening new |
| After setting input value | 200ms before dispatching Enter |
| After Enter key | 300ms for search to start |

### 9. URL Pattern Matching

**Best practice** for Salesforce extensions:
```json
"matches": [
  "https://*.salesforce.com/*",
  "https://*.force.com/*",
  "https://*.lightning.force.com/*"
]
```

This covers production, sandbox, scratch orgs, and Lightning domains.

---

## Search Query Format

The extension searches for Integration Requests where the **Identifier** field contains:
```
Request|{SR_NUMBER}
```

For example, for SR `08475332`, it searches: `Request|08475332`

## Supported Salesforce Domains

The extension activates on:
- `https://*.salesforce.com/*`
- `https://*.force.com/*`
- `https://*.lightning.force.com/*`

## SR Number Detection

The extension recognizes SR numbers by:
1. Finding the closest `<a>` link element to the right-click
2. Extracting the link text
3. Validating it matches the pattern: 7-10 digits (`/^\d{7,10}$/`)
4. Optionally checking if it's in a "Request Number" column

---

## Installation

1. Open Chrome/Edge and navigate to `chrome://extensions/` or `edge://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this extension folder
5. The extension icon appears in the toolbar

## Usage

1. Navigate to any Salesforce page with Service Requests (e.g., a report, list view, or related list)
2. Locate a Service Request number in the "Request Number" column
3. **Right-click** on the SR number link
4. Select **"Search Integration Request"**
5. In the search results, click the Integration Request to open it

## Project Structure

```
SR to Integration Request Finder/
├── manifest.json      # Extension configuration
├── background.js      # Service worker (context menu)
├── content.js         # Content script (SR detection, search)
├── README.md          # This file
├── PLAN.md            # Development plan and architecture
└── images/            # Extension icons
    ├── sr_to_ir_finder_icon16.png
    ├── sr_to_ir_finder_icon32.png
    ├── sr_to_ir_finder_icon48.png
    └── sr_to_ir_finder_icon128.png
```

---

## Troubleshooting

### "Could not find Salesforce search box"
- Ensure you are on a Salesforce Lightning page
- The global search button must be visible at the top of the page
- Try refreshing the page

### Search doesn't work on second attempt
- Wait at least 2 seconds between searches
- If search dialog is stuck, press Escape and try again

### SR number not detected
- Make sure you're right-clicking directly on the SR number link
- SR numbers must be 7-10 digits
- Check the console (F12) for `[IR Finder]` messages

### Extension not loading
- Verify the URL matches `*.salesforce.com` or `*.force.com`
- Check `chrome://extensions/` for errors
- Try removing and re-adding the extension

---

## Development Notes

### Debugging
Enable verbose logging by checking the browser console for `[IR Finder]` prefixed messages:
- `[IR Finder] Detected SR number:` - SR extraction working
- `[IR Finder] Received search request from background` - Message passing working
- `[IR Finder] In iframe, sending SR to top frame:` - Cross-frame communication working
- `[IR Finder] Clicking search button to open dialog` - Search initiation

### Testing Checklist
1. ✅ First search works
2. ✅ Second search works (different SR)
3. ✅ Same SR twice works (after cooldown)
4. ✅ Works in iframes
5. ✅ Works on different Salesforce pages

---

## Version History

- **v1.0** - Initial release with context menu search functionality
