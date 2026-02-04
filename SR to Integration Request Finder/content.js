// 311 SR to Integration Request Finder - Content Script
// Detects SR numbers and performs Integration Request search

// IMMEDIATE TEST - remove after debugging
console.log('[IR Finder] *** CONTENT SCRIPT STARTING ***', window.location.href);

//=============================================================================
// CONFIGURATION
//=============================================================================

const SEARCH_PREFIX = 'Request|';            // Prefix for search query

// Auto-click configuration
const AUTO_CLICK_ENABLED = true;              // Feature toggle
const AUTO_CLICK_MAX_WAIT_MS = 5000;          // Max time to wait for results
const AUTO_CLICK_POLL_INTERVAL_MS = 300;      // How often to check for results
const AUTO_CLICK_STABLE_COUNT = 2;            // # of consistent checks before acting
const INT_REQ_PATTERN = /^INT-REQ-\d{8,9}$/;  // Pattern for valid INT-REQ names
const SR_NUMBER_PATTERN = /^\d{8,9}$/;        // 8-9 digit numbers

// Only run search logic in the top frame (where the search box is)
const IS_TOP_FRAME = (window === window.top);

//=============================================================================
// STATE
//=============================================================================

let lastSRNumber = null;
let lastRightClickTime = 0;  // Track when the right-click happened

//=============================================================================
// SR NUMBER PARSING
//=============================================================================

/**
 * Parse and validate SR number from text.
 * Extracts value before first space and validates as 8-9 digit number.
 * @param {string} text - Raw text to parse
 * @returns {string|null} - Valid SR number or null
 */
function parseSRNumber(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Extract value before first space (consistent with Middleware Log Search)
  const spaceIndex = trimmed.indexOf(' ');
  const valueToValidate = spaceIndex !== -1 ? trimmed.substring(0, spaceIndex) : trimmed;

  const isValid = SR_NUMBER_PATTERN.test(valueToValidate);
  console.log('[IR Finder] parseSRNumber:', { input: text, trimmed, spaceIndex, valueToValidate, isValid });

  return isValid ? valueToValidate : null;
}

/**
 * Extract SR number from a DOM element.
 * Checks link text first, then selected text as fallback.
 * @param {HTMLElement} element - The element to extract from
 * @returns {string|null} - Valid SR number or null
 */
function extractSRNumber(element) {
  // Check link text first
  const link = element.closest('a');
  if (link) {
    return parseSRNumber(link.textContent);
  }

  // Fallback: check selected text
  return parseSRNumber(window.getSelection().toString());
}

//=============================================================================
// RIGHT-CLICK DETECTION
//=============================================================================

/**
 * Listen for right-clicks to capture the clicked element and detect SR numbers
 * Also sends validation result to background script to enable/disable menu
 */
document.addEventListener('contextmenu', (event) => {
  lastSRNumber = null;
  lastRightClickTime = Date.now();

  // Check if clicked element is a link
  const link = event.target.closest('a');
  const isLink = link !== null;

  // Extract and validate SR number
  const srNumber = isLink ? parseSRNumber(link.textContent) : null;
  const isValidSR = srNumber !== null;

  if (isValidSR) {
    lastSRNumber = srNumber;
    console.log('[IR Finder] Valid SR number detected:', srNumber);
  } else if (isLink) {
    console.log('[IR Finder] Link text is not a valid SR number:', link.textContent.trim());
  } else {
    console.log('[IR Finder] Clicked element is not a link');
  }

  // Send validation result to background script to enable/disable menu
  chrome.runtime.sendMessage({
    action: 'updateMenuState',
    isValid: isValidSR,
    isLink: isLink,
    srNumber: srNumber
  }).catch(err => {
    // Ignore errors (e.g., if background script not ready)
    console.log('[IR Finder] Could not send menu state update:', err.message);
  });
});

//=============================================================================
// SEARCH FUNCTIONALITY
//=============================================================================

// Prevent duplicate searches within a short time window
let lastSearchTime = 0;
let lastSearchSR = null;
const SEARCH_COOLDOWN = 2000; // 2 seconds cooldown between searches

/**
 * Perform the Integration Request search
 */
function searchIntegrationRequest(srNumber) {
  if (!srNumber) {
    console.warn('[IR Finder] No SR number provided');
    return;
  }

  // Only search from top frame
  if (!IS_TOP_FRAME) {
    console.log('[IR Finder] Not top frame, sending to top frame');
    window.top.postMessage({
      type: 'IR_FINDER_SEARCH',
      srNumber: srNumber
    }, '*');
    return;
  }

  const now = Date.now();

  // Allow search if:
  // 1. It's a different SR number, OR
  // 2. Enough time has passed since last search
  if (lastSearchSR === srNumber && (now - lastSearchTime) < SEARCH_COOLDOWN) {
    console.log('[IR Finder] Duplicate search blocked (same SR within cooldown)');
    return;
  }

  lastSearchTime = now;
  lastSearchSR = srNumber;

  const searchText = SEARCH_PREFIX + srNumber;
  console.log('[IR Finder] Searching for:', searchText);

  // First, close any existing search dialog to get a fresh state
  const existingDialog = document.querySelector('.forceSearchAssistantDialog, .DESKTOP.uiModal.forceSearchResultsGridView');
  if (existingDialog) {
    console.log('[IR Finder] Closing existing search dialog');
    // Try to find and click the close button
    const closeButton = existingDialog.querySelector('button.slds-modal__close, button[title="Close"], .closeIcon');
    if (closeButton) {
      closeButton.click();
    } else {
      // Press Escape to close the dialog
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        bubbles: true
      }));
    }
    // Wait for dialog to close before opening new search
    setTimeout(() => {
      openSearchAndEnterText(searchText);
    }, 300);
  } else {
    // No existing dialog, proceed directly
    openSearchAndEnterText(searchText);
  }
}

/**
 * Open the search dialog and enter search text
 */
function openSearchAndEnterText(searchText) {
  // Click the search button to open a fresh dialog
  const searchButton = findAndClickSearchButton();
  if (!searchButton) {
    console.error('[IR Finder] Search button not found');
    alert('Could not find Salesforce search button. Please make sure you are on a Salesforce page.');
    return;
  }

  console.log('[IR Finder] Clicking search button to open dialog');
  searchButton.click();

  // Wait for the search dialog to open, then find the input
  waitForSearchInput(searchText, 0);
}

/**
 * Wait for search input to appear after clicking the button
 */
function waitForSearchInput(searchText, attempts) {
  const maxAttempts = 20;  // Try for 2 seconds (20 * 100ms)

  setTimeout(() => {
    const searchBox = findGlobalSearchBox();
    if (searchBox) {
      console.log('[IR Finder] Search input appeared after', attempts + 1, 'attempts');
      enterSearchText(searchBox, searchText);
    } else if (attempts < maxAttempts) {
      // Keep trying
      waitForSearchInput(searchText, attempts + 1);
    } else {
      console.error('[IR Finder] Search input did not appear after clicking button');
      alert('Search dialog did not open. Please try clicking the search box manually first.');
    }
  }, 100);
}

/**
 * Enter search text into the search box and trigger search
 */
function enterSearchText(searchBox, searchText) {
  console.log('[IR Finder] Entering search text into:', searchBox.tagName, searchBox.className);

  // Click and focus the search box
  searchBox.click();
  searchBox.focus();

  // Small delay to let Salesforce activate the input
  setTimeout(() => {
    // Clear and set value using native setter (bypasses React)
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(searchBox, '');
    nativeInputValueSetter.call(searchBox, searchText);

    // Trigger input event
    searchBox.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    searchBox.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: searchText
    }));

    console.log('[IR Finder] Value set to:', searchBox.value);

    // Wait a bit, then trigger the search by pressing Enter
    // DO NOT click on autocomplete suggestions - we want a full search
    setTimeout(() => {
      // Method 1: Try form submission first
      const form = searchBox.closest('form');
      if (form) {
        console.log('[IR Finder] Found form, submitting via requestSubmit');
        try {
          // requestSubmit triggers validation and submit event
          form.requestSubmit();
          console.log('[IR Finder] Form submitted');
          return;
        } catch (e) {
          console.log('[IR Finder] requestSubmit failed, trying submit()');
          try {
            form.submit();
            return;
          } catch (e2) {
            console.log('[IR Finder] form.submit() also failed');
          }
        }
      }

      // Method 2: Dispatch Enter key events with all necessary properties
      console.log('[IR Finder] Dispatching Enter key events');

      // Focus the input first
      searchBox.focus();

      // Create and dispatch keydown
      const keydownEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        charCode: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      });
      const keydownResult = searchBox.dispatchEvent(keydownEvent);
      console.log('[IR Finder] keydown dispatched, default prevented:', !keydownResult);

      // Create and dispatch keypress
      const keypressEvent = new KeyboardEvent('keypress', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        charCode: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      });
      searchBox.dispatchEvent(keypressEvent);

      // Create and dispatch keyup
      const keyupEvent = new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        charCode: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      });
      searchBox.dispatchEvent(keyupEvent);

      console.log('[IR Finder] Search triggered for:', searchText);
      
      // Start watching for results to auto-click if single result
      waitForSearchResultsAndAutoClick();
    }, 300);
  }, 200);
}

/**
 * Find the Salesforce global search box
 */
function findGlobalSearchBox() {
  // First, check if the search dialog is already open
  let searchInput = document.querySelector('.forceSearchAssistantDialog input[type="search"]');
  if (searchInput) {
    console.log('[IR Finder] Found search input in open dialog');
    return searchInput;
  }

  searchInput = document.querySelector('lightning-input.saInput input[type="search"]');
  if (searchInput) {
    console.log('[IR Finder] Found search input via lightning-input.saInput');
    return searchInput;
  }

  // Try other selectors for the input
  const inputSelectors = [
    'input.slds-input[placeholder="Search..."][type="search"]',
    'input[placeholder="Search..."][type="search"][maxlength="100"]',
    '.slds-global-header input[type="search"][placeholder="Search..."]'
  ];

  for (const selector of inputSelectors) {
    const input = document.querySelector(selector);
    if (input && !input.className.includes('splashPage')) {
      console.log('[IR Finder] Found search input with selector:', selector);
      return input;
    }
  }

  return null;
}

/**
 * Find and click the search button to open the search dialog
 */
function findAndClickSearchButton() {
  // Look for the search button
  const buttonSelectors = [
    'button.search-button[aria-label="Search"]',
    'button.search-button',
    'button[aria-label="Search"]',
    '.slds-global-header button[aria-label="Search"]',
    '.forceSearchDesktopHeader button'
  ];

  for (const selector of buttonSelectors) {
    const button = document.querySelector(selector);
    if (button) {
      console.log('[IR Finder] Found search button with selector:', selector);
      return button;
    }
  }

  console.log('[IR Finder] Search button not found');
  return null;
}

//=============================================================================
// AUTO-CLICK SINGLE RESULT FUNCTIONALITY
//=============================================================================

/**
 * Find all Integration Request links in current search results
 * Looks for links with data-refid="recordId" and text matching INT-REQ-NNNNNNNN
 * @returns {HTMLElement[]} Array of matching <a> elements
 */
function findIntegrationRequestLinks() {
  // Query for all potential INT-REQ links
  const allLinks = document.querySelectorAll('a[data-refid="recordId"]');
  
  // Filter to only those matching INT-REQ pattern
  const validLinks = Array.from(allLinks).filter(link => {
    const text = link.textContent.trim();
    return INT_REQ_PATTERN.test(text);
  });
  
  return validLinks;
}

/**
 * Auto-click on a single Integration Request link
 * @param {HTMLElement} link - The <a> element to click
 */
function autoClickSingleResult(link) {
  const linkText = link.textContent.trim();
  const linkTitle = link.getAttribute('title') || linkText;
  
  console.log('[IR Finder] Auto-clicking single result:', linkTitle);
  
  try {
    // Use click() to navigate
    link.click();
    console.log('[IR Finder] Auto-click successful');
  } catch (err) {
    console.error('[IR Finder] Auto-click failed:', err);
  }
}

/**
 * Wait for search results to load, then auto-click if exactly one result
 * Uses polling with stability check to ensure results are fully loaded
 */
function waitForSearchResultsAndAutoClick() {
  if (!AUTO_CLICK_ENABLED) {
    console.log('[IR Finder] Auto-click is disabled');
    return;
  }
  
  console.log('[IR Finder] Starting auto-click watch for search results...');
  
  const startTime = Date.now();
  let lastCount = -1;
  let stableChecks = 0;
  
  function checkResults() {
    const elapsed = Date.now() - startTime;
    
    // Timeout check
    if (elapsed > AUTO_CLICK_MAX_WAIT_MS) {
      console.log('[IR Finder] Auto-click timeout reached, stopping watch');
      return;
    }
    
    // Find INT-REQ links
    const links = findIntegrationRequestLinks();
    const currentCount = links.length;
    
    console.log('[IR Finder] Found', currentCount, 'INT-REQ link(s) at', elapsed, 'ms');
    
    // Check for stability (same count as last check)
    if (currentCount === lastCount) {
      stableChecks++;
    } else {
      stableChecks = 0;
      lastCount = currentCount;
    }
    
    // If we have stable results
    if (stableChecks >= AUTO_CLICK_STABLE_COUNT) {
      if (currentCount === 1) {
        // Exactly one result - auto-click!
        console.log('[IR Finder] Single stable result found, auto-clicking');
        autoClickSingleResult(links[0]);
      } else if (currentCount === 0) {
        console.log('[IR Finder] No results found, stopping watch');
      } else {
        console.log('[IR Finder] Multiple results found (' + currentCount + '), user must choose');
      }
      return; // Stop polling
    }
    
    // Continue polling
    setTimeout(checkResults, AUTO_CLICK_POLL_INTERVAL_MS);
  }
  
  // Start polling after a short initial delay (let page start loading)
  setTimeout(checkResults, AUTO_CLICK_POLL_INTERVAL_MS);
}

//=============================================================================
// MESSAGE LISTENER
//=============================================================================

/**
 * Listen for messages from background script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'searchIntegrationRequest') {
    console.log('[IR Finder] Received search request from background, IS_TOP_FRAME:', IS_TOP_FRAME, 'lastSRNumber:', lastSRNumber, 'lastRightClickTime:', lastRightClickTime);

    const now = Date.now();
    const RIGHT_CLICK_FRESHNESS = 5000; // SR number is valid for 5 seconds after right-click (increased from 2)

    // Check if we have a FRESH SR number from this frame's right-click
    let srNumber = null;
    const timeSinceRightClick = now - lastRightClickTime;

    if (lastSRNumber && timeSinceRightClick < RIGHT_CLICK_FRESHNESS) {
      srNumber = lastSRNumber;
      console.log('[IR Finder] Using fresh SR from this frame:', srNumber, '(age:', timeSinceRightClick, 'ms)');
    } else if (lastSRNumber) {
      console.log('[IR Finder] SR number exists but is stale (age:', timeSinceRightClick, 'ms)');
    }

    // If we have selected text from the message, try that
    if (!srNumber && message.linkText) {
      srNumber = parseSRNumber(message.linkText);
      if (srNumber) {
        console.log('[IR Finder] Using SR from message linkText:', srNumber);
      }
    }

    // If this frame detected a fresh SR number, handle it
    if (srNumber) {
      if (!IS_TOP_FRAME) {
        // We're in an iframe - send the SR number to the top frame
        console.log('[IR Finder] In iframe, sending SR to top frame:', srNumber);
        window.top.postMessage({
          type: 'IR_FINDER_SEARCH',
          srNumber: srNumber
        }, '*');
      } else {
        // We're in top frame AND have fresh SR number - search directly
        searchIntegrationRequest(srNumber);
      }
      // Clear the SR number after using it
      lastSRNumber = null;
    } else if (IS_TOP_FRAME) {
      // Top frame but no fresh SR number - wait for iframe to send us one
      console.log('[IR Finder] Top frame has no fresh SR, waiting for iframe...');
      // Don't do anything - the iframe will send us the SR via postMessage
    }
    // If we're in an iframe without an SR number, do nothing
  }
});

//=============================================================================
// INITIALIZATION
//=============================================================================

// Listen for messages from iframes (SR number found in iframe, search in top frame)
if (IS_TOP_FRAME) {
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'IR_FINDER_SEARCH' && event.data.srNumber) {
      console.log('[IR Finder] Received SR from iframe:', event.data.srNumber);
      lastSRNumber = event.data.srNumber;
      // searchIntegrationRequest has its own duplicate prevention
      searchIntegrationRequest(event.data.srNumber);
    }
  });
}

// Expose global function for executeScript fallback
window.irFinderTriggerSearch = function() {
  console.log('[IR Finder] Trigger via executeScript, lastSRNumber:', lastSRNumber, 'IS_TOP_FRAME:', IS_TOP_FRAME);
  if (lastSRNumber) {
    if (!IS_TOP_FRAME) {
      // Send to top frame
      window.top.postMessage({
        type: 'IR_FINDER_SEARCH',
        srNumber: lastSRNumber
      }, '*');
    } else {
      searchIntegrationRequest(lastSRNumber);
    }
  }
};

console.log('[IR Finder] Content script loaded on:', window.location.href, 'IS_TOP_FRAME:', IS_TOP_FRAME);
