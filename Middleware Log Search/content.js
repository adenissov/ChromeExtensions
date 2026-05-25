// Middleware Log Search - Content Script
// Detects right-clicks on SR numbers in Request Number columns and validates them

//=============================================================================
// CONSTANTS
//=============================================================================

const SR_NUMBER_PATTERN = /^\d{8,9}$/;  // 8-9 digit numbers
const ELEMENT_ID_ATTR = 'data-mwlog-id';

// Mirrors the constant in background.js. Appended to a "No records" result when
// the SR's Created Date Time is at least an hour old (see updateSRDisplay).
const TIP_CHECK_INTEGRATION_REQUEST = ' ✅Tip:Check Integration Request for validation errors';
const NO_RECORDS_MESSAGE = 'No records in the Middleware log';
const ONE_HOUR_MS = 60 * 60 * 1000;

//=============================================================================
// STATE MANAGEMENT
//=============================================================================

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
    /* Searching animation - spinning icon */
    .mwlog-spinner {
      display: inline-block;
      animation: mwlog-spin 1s linear infinite;
    }
    @keyframes mwlog-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
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

      // Inject styles if not already done
      injectStyles();

      let responseBody = message.responseBody;

      // For a "No records" result, append the validation-error tip when this
      // table has a Created Date Time column and the SR is at least an hour old.
      if (responseBody === NO_RECORDS_MESSAGE) {
        const srCell = link.closest('td');
        const createdDate = srCell && parseCreatedDateTime(getCreatedDateTimeForRow(srCell));
        if (createdDate && (Date.now() - createdDate.getTime()) >= ONE_HOUR_MS) {
          responseBody += TIP_CHECK_INTEGRATION_REQUEST;
        }
      }

      // Check if this is a searching message (spinner only for "Searching", not "Waiting")
      const isSearching = responseBody.includes('Searching');

      if (isSearching) {
        // Build content with spinner before "Searching" or "Waiting"
        link.innerHTML = '';
        link.appendChild(document.createTextNode(`${message.srNumber} - `));

        const spinner = document.createElement('span');
        spinner.className = 'mwlog-spinner';
        spinner.textContent = '⟳ ';
        link.appendChild(spinner);

        link.appendChild(document.createTextNode(responseBody));
      } else {
        link.textContent = `${message.srNumber} - ${responseBody}`;
      }

      // Add class to the cell for CSS targeting
      const cell = link.closest('td');
      if (cell) {
        cell.classList.add('mwlog-expanded-cell');

        // Also add class to parent row
        const row = cell.closest('tr');
        if (row) {
          row.classList.add('mwlog-expanded-row');
        }

        // Trigger table reflow to fix Salesforce layout issues
        const table = cell.closest('table');
        if (table) {
          triggerSalesforceTableReflow(table);
        }
      }

      console.log('[Middleware Log] SR display updated:', link.textContent);
    } else {
      console.log('[Middleware Log] Could not find element to update:', message.elementId);
    }
  }
});

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
 * Collect valid SR numbers from the Request Number column, starting at the
 * clicked row and going up to the top — SRs below the clicked row are skipped.
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

  // Start at the clicked row and go up; rows below it are skipped.
  // Fall back to the last row if the clicked row isn't a data row.
  const clickedRowIndex = allRows.indexOf(row);
  const startIndex = clickedRowIndex === -1 ? allRows.length - 1 : clickedRowIndex;

  // Process from the clicked row up to the top of the column
  const items = [];
  for (let i = startIndex; i >= 0; i--) {
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
 * Find the "Created Date Time" cell text for the row containing srCell.
 * Returns null if the table has no such column (or it can't be located),
 * so callers can treat absence as "don't apply the tip".
 * @param {HTMLElement} srCell - The <td> holding the SR link
 * @returns {string|null}
 */
function getCreatedDateTimeForRow(srCell) {
  const row = srCell.closest('tr');
  const table = srCell.closest('table');
  if (!row || !table) return null;

  const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
  if (!headerRow) return null;

  const norm = (s) => (s || '').replace(/[\s ]+/g, ' ').trim().toLowerCase();
  const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
  const createdHeaderIdx = headerCells.findIndex(c => norm(c.textContent).startsWith('created date time'));
  if (createdHeaderIdx === -1) return null;  // no Created Date Time column in this table

  const bodyCells = Array.from(row.querySelectorAll('td'));
  const srBodyIdx = bodyCells.indexOf(srCell);
  if (srBodyIdx === -1) return null;

  // Header rows can carry leading cells (e.g. a selection column) that the body
  // renders differently, so anchor on the Request Number column we already know
  // to translate the header index into a body <td> index.
  const requestHeaderIdx = headerCells.findIndex(c => norm(c.textContent).startsWith('request number'));
  const createdBodyIdx = requestHeaderIdx !== -1
    ? srBodyIdx + (createdHeaderIdx - requestHeaderIdx)
    : createdHeaderIdx;

  const cell = bodyCells[createdBodyIdx];
  return cell ? cell.textContent : null;
}

/**
 * Parse a Salesforce en-CA Created Date Time value, e.g. "2026-05-24, 2:30 p.m.".
 * @param {string} text
 * @returns {Date|null} - null if the text doesn't match the expected shape
 */
function parseCreatedDateTime(text) {
  if (!text) return null;
  const norm = text.replace(/[\s ]+/g, ' ').trim();
  const m = norm.match(/(\d{4})-(\d{1,2})-(\d{1,2}),?\s+(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i);
  if (!m) return null;

  let hour = parseInt(m[4], 10);
  const isPM = /p/i.test(m[6]);
  if (isPM && hour !== 12) hour += 12;
  if (!isPM && hour === 12) hour = 0;

  const dt = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), hour, parseInt(m[5], 10));
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * Trigger Salesforce table reflow after content update.
 * Adds classes to parent containers to allow them to grow with expanded content.
 */
function triggerSalesforceTableReflow(tableElement) {
  if (!tableElement) return;

  // Add class to parent containers to override their fixed heights
  // Go up several levels to catch Salesforce's wrapper divs
  let parent = tableElement.parentElement;
  for (let i = 0; i < 5 && parent; i++) {
    parent.classList.add('mwlog-expanded-table-container');
    parent = parent.parentElement;
  }

  // Dispatch window resize event as well
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

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
