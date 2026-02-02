// Middleware Log Search - Content Script
// Detects right-clicks on SR numbers in Request Number columns and validates them

//=============================================================================
// CONSTANTS
//=============================================================================

const SR_COLUMN_HEADER = 'Request Number';
const SR_NUMBER_PATTERN = /^\d{8,9}$/;  // 8-9 digit numbers
const ELEMENT_ID_ATTR = 'data-mwlog-id';

//=============================================================================
// STATE MANAGEMENT
//=============================================================================

let lastRightClickedElement = null;
let lastSRNumber = null;
let elementIdCounter = 0;

//=============================================================================
// MESSAGE LISTENER FOR SR DISPLAY UPDATES
//=============================================================================

// Inject CSS styles for multi-line display (only once)
let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .mwlog-expanded-cell,
    .mwlog-expanded-cell * {
      white-space: pre-wrap !important;
      overflow: visible !important;
      height: auto !important;
      max-height: none !important;
      word-wrap: break-word !important;
      text-overflow: clip !important;
      line-clamp: unset !important;
      -webkit-line-clamp: unset !important;
    }
    tr:has(.mwlog-expanded-cell) {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }
  `;
  document.head.appendChild(style);
  console.log('[Middleware Log] Styles injected');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateSRDisplay') {
    const element = document.querySelector(`[${ELEMENT_ID_ATTR}="${message.elementId}"]`);
    if (element) {
      const link = element.closest('a') || element;
      link.textContent = `${message.srNumber} - ${message.responseBody}`;

      // Inject styles if not already done
      injectStyles();

      // Add class to the cell for CSS targeting
      const cell = link.closest('td');
      if (cell) {
        cell.classList.add('mwlog-expanded-cell');

        // Also add class to parent row
        const row = cell.closest('tr');
        if (row) {
          row.classList.add('mwlog-expanded-row');
        }
      }

      console.log('[Middleware Log] SR display updated:', link.textContent);
    } else {
      console.log('[Middleware Log] Could not find element to update:', message.elementId);
    }
  }
});

//=============================================================================
// COLUMN VALIDATION
//=============================================================================

/**
 * Check if an element is within a table column with header "Request Number"
 * @param {HTMLElement} element - The element to check
 * @returns {boolean} - True if in a Request Number column
 */
function isInRequestNumberColumn(element) {
  // Find the table cell containing this element
  const cell = element.closest('td');
  if (!cell) {
    console.log('[Middleware Log] Element not in a table cell');
    return false;
  }

  const row = cell.closest('tr');
  const table = cell.closest('table');
  if (!row || !table) {
    console.log('[Middleware Log] Could not find row or table');
    return false;
  }

  // Get the column index
  const cells = Array.from(row.querySelectorAll('td, th'));
  const cellIndex = cells.indexOf(cell);
  if (cellIndex === -1) {
    console.log('[Middleware Log] Could not determine column index');
    return false;
  }

  // Find the header row - check thead first, then first row
  const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
  if (!headerRow) {
    console.log('[Middleware Log] Could not find header row');
    return false;
  }

  const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
  const headerCell = headerCells[cellIndex];
  if (!headerCell) {
    console.log('[Middleware Log] Could not find header cell at index', cellIndex);
    return false;
  }

  // Check if header text contains "Request Number"
  const headerText = headerCell.textContent.trim();
  if (headerText.includes(SR_COLUMN_HEADER)) {
    console.log('[Middleware Log] Found matching column header:', headerText);
    return true;
  }

  // Also check for Salesforce-specific attributes (tooltip, title, aria-label)
  const tooltipElement = headerCell.querySelector(
    '[data-tooltip*="Request Number"], [title*="Request Number"], [aria-label*="Request Number"]'
  );
  if (tooltipElement) {
    console.log('[Middleware Log] Found Request Number in tooltip/title attribute');
    return true;
  }

  // Check the header cell itself for these attributes
  if (headerCell.getAttribute('title')?.includes(SR_COLUMN_HEADER) ||
      headerCell.getAttribute('aria-label')?.includes(SR_COLUMN_HEADER) ||
      headerCell.getAttribute('data-tooltip')?.includes(SR_COLUMN_HEADER)) {
    console.log('[Middleware Log] Found Request Number in header cell attributes');
    return true;
  }

  console.log('[Middleware Log] Column header does not match:', headerText);
  return false;
}

//=============================================================================
// SR NUMBER EXTRACTION
//=============================================================================

/**
 * Extract and validate SR number from a clicked element
 * @param {HTMLElement} element - The clicked element
 * @returns {string|null} - The SR number if valid, null otherwise
 */
function extractSRNumber(element) {
  // Must be a link or inside a link
  const link = element.closest('a');
  if (!link) {
    console.log('[Middleware Log] Element is not a link');
    return null;
  }

  // Get the link text
  const linkText = link.textContent.trim();

  // Extract value to validate: text before first space, or whole text if no space
  const spaceIndex = linkText.indexOf(' ');
  const valueToValidate = spaceIndex !== -1 ? linkText.substring(0, spaceIndex) : linkText;

  // Validate it's an 8-9 digit number
  if (!SR_NUMBER_PATTERN.test(valueToValidate)) {
    console.log('[Middleware Log] Value is not 8-9 digits:', valueToValidate);
    return null;
  }

  console.log('[Middleware Log] Valid SR number found:', valueToValidate);
  return valueToValidate;
}

//=============================================================================
// COLLECT ALL SR NUMBERS IN COLUMN
//=============================================================================

/**
 * Collect all valid SR numbers from the Request Number column
 * @param {HTMLElement} clickedElement - The element that was right-clicked
 * @returns {Array} - Array of {srNumber, elementId} objects, bottom-to-top order
 */
function collectAllSRNumbers(clickedElement) {
  console.log('[Middleware Log] collectAllSRNumbers called with:', clickedElement.tagName);

  const cell = clickedElement.closest('td');
  if (!cell) {
    console.log('[Middleware Log] No td cell found');
    return [];
  }

  const row = cell.closest('tr');
  const table = cell.closest('table');
  if (!row || !table) {
    console.log('[Middleware Log] No row or table found. row:', !!row, 'table:', !!table);
    return [];
  }

  // Get column index - only count td cells in current row
  const cells = Array.from(row.querySelectorAll('td'));
  const columnIndex = cells.indexOf(cell);
  console.log('[Middleware Log] Column index:', columnIndex, 'of', cells.length, 'cells');
  if (columnIndex === -1) {
    console.log('[Middleware Log] Could not find cell in row');
    return [];
  }

  // Get all data rows from tbody, or all rows except header
  let allRows;
  const tbody = table.querySelector('tbody');
  if (tbody) {
    allRows = Array.from(tbody.querySelectorAll('tr'));
  } else {
    // Skip header row
    allRows = Array.from(table.querySelectorAll('tr')).slice(1);
  }
  console.log('[Middleware Log] Found', allRows.length, 'data rows');

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
    let existingId = link.getAttribute(ELEMENT_ID_ATTR);
    if (!existingId) {
      existingId = `mwlog-${Date.now()}-${elementIdCounter++}`;
      link.setAttribute(ELEMENT_ID_ATTR, existingId);
    }

    items.push({ srNumber: valueToValidate, elementId: existingId });
  }

  console.log('[Middleware Log] Collected', items.length, 'SR numbers from column');
  return items;
}

//=============================================================================
// HELPER FUNCTIONS
//=============================================================================

/**
 * Safely send message to background script
 * Handles cases where extension context is invalidated (e.g., after extension reload)
 */
function safeSendMessage(message) {
  try {
    // Check if chrome.runtime is available
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      console.log('[Middleware Log] Extension context invalidated - please refresh the page');
      return;
    }
    
    chrome.runtime.sendMessage(message, (response) => {
      // Check for errors (extension context invalidated)
      if (chrome.runtime.lastError) {
        console.log('[Middleware Log] Message failed:', chrome.runtime.lastError.message);
        console.log('[Middleware Log] Please refresh the page to reconnect to the extension');
      }
    });
  } catch (error) {
    console.log('[Middleware Log] Extension context invalidated:', error.message);
    console.log('[Middleware Log] Please refresh the page to reconnect to the extension');
  }
}

//=============================================================================
// RIGHT-CLICK HANDLER
//=============================================================================

document.addEventListener('contextmenu', (event) => {
  lastRightClickedElement = event.target;
  lastSRNumber = null;

  // Extract and validate SR number (for single-SR menu)
  const srNumber = extractSRNumber(event.target);
  const isValidSingleSR = srNumber !== null;

  // Collect all SRs in column (for "Search All" menu)
  // If clicking on a valid SR, try to collect all from that column
  let allItems = [];
  if (isValidSingleSR) {
    allItems = collectAllSRNumbers(event.target);
  }

  let elementId = null;
  if (isValidSingleSR) {
    lastSRNumber = srNumber;

    // Mark the element with a unique ID for later update
    const link = event.target.closest('a');
    if (link) {
      // Check if already marked (by collectAllSRNumbers)
      elementId = link.getAttribute(ELEMENT_ID_ATTR);
      if (!elementId) {
        elementId = `mwlog-${Date.now()}-${elementIdCounter++}`;
        link.setAttribute(ELEMENT_ID_ATTR, elementId);
      }
    }
  }

  // Send validation result to background script to enable/disable menu
  safeSendMessage({
    action: 'updateMenuState',
    isValid: isValidSingleSR,
    srNumber: lastSRNumber,
    elementId: elementId,
    isValidColumn: allItems.length > 0,
    allItems: allItems
  });
});

//=============================================================================
// INITIALIZATION
//=============================================================================

console.log('[Middleware Log] Content script loaded');
