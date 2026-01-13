// Middleware Log Search - Content Script
// Detects right-clicks on SR numbers in Request Number columns and validates them

//=============================================================================
// CONSTANTS
//=============================================================================

const SR_COLUMN_HEADER = 'Request Number';
const SR_NUMBER_PATTERN = /^\d{8,9}$/;  // 8-9 digit numbers

//=============================================================================
// STATE MANAGEMENT
//=============================================================================

let lastRightClickedElement = null;
let lastSRNumber = null;

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
  
  // Validate it's an 8-9 digit number
  if (!SR_NUMBER_PATTERN.test(linkText)) {
    console.log('[Middleware Log] Link text is not 8-9 digits:', linkText);
    return null;
  }

  // Check if in Request Number column
  if (!isInRequestNumberColumn(link)) {
    console.log('[Middleware Log] Link is not in Request Number column');
    return null;
  }

  console.log('[Middleware Log] Valid SR number found:', linkText);
  return linkText;
}

//=============================================================================
// RIGHT-CLICK HANDLER
//=============================================================================

document.addEventListener('contextmenu', (event) => {
  lastRightClickedElement = event.target;
  lastSRNumber = null;

  // Extract and validate SR number
  const srNumber = extractSRNumber(event.target);
  const isValid = srNumber !== null;
  
  if (isValid) {
    lastSRNumber = srNumber;
  }

  // Send validation result to background script to enable/disable menu
  chrome.runtime.sendMessage({
    action: 'updateMenuState',
    isValid: isValid,
    srNumber: lastSRNumber
  });
});

//=============================================================================
// INITIALIZATION
//=============================================================================

console.log('[Middleware Log] Content script loaded');
