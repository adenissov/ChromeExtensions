// Middleware Log Search - Content Script
// Detects right-clicks on SR numbers in Request Number columns and validates them

//=============================================================================
// CONSTANTS
//=============================================================================

const SR_NUMBER_PATTERN = /^\d{8,9}$/;  // 8-9 digit numbers
const ELEMENT_ID_ATTR = 'data-mwlog-id';

// Mirrors the constant in background.js. Appended to a "No records" result when
// the SR's Created Date Time is at least an hour old, or to any result whose log
// line contains an Oracle "numeric or value error" (see updateSRDisplay).
const TIP_CHECK_INTEGRATION_REQUEST = ' ✅Tip:Check Integration Request for validation errors';
const NO_RECORDS_MESSAGE = 'No records in the Middleware log';
const ONE_HOUR_MS = 60 * 60 * 1000;

//=============================================================================
// STATE MANAGEMENT
//=============================================================================

let lastSRNumber = null;
let elementIdCounter = 0;

/** The SR token of a cell: the text before the first space (or the whole text). */
function srTokenOf(text) {
  const trimmed = (text || '').trim();
  const spaceIndex = trimmed.indexOf(' ');
  return spaceIndex !== -1 ? trimmed.substring(0, spaceIndex) : trimmed;
}

// Salesforce Lightning virtualizes list rows: a row scrolled out of view is
// recycled/re-rendered, wiping the text we injected (and its data-mwlog-id).
// Keep the last result per SR number and re-apply it whenever rows re-render.
// Grows by one entry per searched SR for the life of the page (cleared on
// reload); fine for a session — cap it here if very long sessions ever bloat it.
const resultsBySR = new Map();  // srNumber -> { srNumber, responseBody, isSearching }
let reapplyObserver = null;
let reapplyTimer = null;
const REAPPLY_QUIET_MS = 200;  // repaint only once the DOM/scroll has gone quiet (never mid-scroll)

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
    /* Unclamp the cell and every wrapper Salesforce puts around the link
       (it otherwise truncates the text to one line via an overflow-hidden,
       fixed-height span). */
    .mwlog-expanded-cell,
    .mwlog-expanded-cell * {
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      text-overflow: clip !important;
      line-clamp: unset !important;
      -webkit-line-clamp: unset !important;
      overflow: visible !important;
      height: auto !important;
      max-height: none !important;
    }
    /* Cap the message itself at ~10 lines and scroll longer ones inside the
       link. Higher specificity than the rule above, so it wins for the <a>.
       Bounding the height keeps Salesforce's virtual-scroller row heights in a
       stable band, which stops the relayout/blink fight and lets the re-apply
       observer settle (ARCH §10, §14). */
    .mwlog-expanded-cell a {
      display: inline-block !important;
      max-width: 100% !important;
      max-height: 14em !important;   /* ~10 lines at line-height 1.4 */
      overflow-y: auto !important;
      line-height: 1.4 !important;
      vertical-align: top !important;
    }
    tr:has(.mwlog-expanded-cell) {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }
    /* Top-align every cell in an expanded row so the left-column row number
       (and the other columns) line up with the first line of the appended
       message, instead of floating in the vertical middle of a now-tall row. */
    tr:has(.mwlog-expanded-cell) > td,
    tr:has(.mwlog-expanded-cell) > th {
      vertical-align: top !important;
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
    const link = element ? (element.closest('a') || element) : null;

    let responseBody = message.responseBody;

    // For a "No records" result, append the validation-error tip when this
    // table has a Created Date Time column and the SR is at least an hour old.
    if (responseBody === NO_RECORDS_MESSAGE && link) {
      const srCell = link.closest('td');
      const createdDate = srCell && parseCreatedDateTime(getCreatedDateTimeForRow(srCell));
      if (createdDate && (Date.now() - createdDate.getTime()) >= ONE_HOUR_MS) {
        responseBody += TIP_CHECK_INTEGRATION_REQUEST;
      }
    } else if (/numeric or value error/i.test(responseBody)) {
      // An Oracle "numeric or value error" (ORA-06502) in the log line points to
      // bad/oversized data from the request, so the same validation tip applies.
      responseBody += TIP_CHECK_INTEGRATION_REQUEST;
    }

    const isSearching = !!message.isSearching;

    // Remember the result so it survives Lightning recycling the row's DOM.
    resultsBySR.set(message.srNumber, { srNumber: message.srNumber, responseBody, isSearching });
    ensureReapplyObserver();

    if (link) {
      applyDisplay(link, message.srNumber, responseBody, isSearching, true);
      console.log('[Middleware Log] SR display updated:', link.textContent);
    } else {
      // Row is offscreen/recycled now; the observer will paint it when it returns.
      console.log('[Middleware Log] Element not visible, stored for re-apply:', message.srNumber);
    }
  }
});

/**
 * Write the result text into an SR link and grow its cell/row/table.
 * @param {HTMLElement} link - The <a> holding the SR number
 * @param {string} srNumber
 * @param {string} responseBody - Final display text (tip already appended)
 * @param {boolean} isSearching - Show the spinner while a search is in flight
 * @param {boolean} triggerReflow - Dispatch the resize reflow (only on first paint;
 *   skip on re-paints, since the resize event itself nudges Salesforce to re-render)
 */
function applyDisplay(link, srNumber, responseBody, isSearching, triggerReflow) {
  injectStyles();

  if (isSearching) {
    link.innerHTML = '';
    link.appendChild(document.createTextNode(`${srNumber} - `));

    const spinner = document.createElement('span');
    spinner.className = 'mwlog-spinner';
    spinner.textContent = '⟳ ';
    link.appendChild(spinner);

    link.appendChild(document.createTextNode(responseBody));
  } else {
    link.textContent = `${srNumber} - ${responseBody}`;
  }

  const cell = link.closest('td');
  if (cell) {
    cell.classList.add('mwlog-expanded-cell');
    const row = cell.closest('tr');
    if (row) row.classList.add('mwlog-expanded-row');
    const table = cell.closest('table');
    if (table && triggerReflow) triggerSalesforceTableReflow(table);
  }
}

/** Text applyDisplay produces, used to skip links that are already painted. */
function expectedDisplayText(srNumber, responseBody, isSearching) {
  return isSearching ? `${srNumber} - ⟳ ${responseBody}` : `${srNumber} - ${responseBody}`;
}

/**
 * Re-paint any on-screen SR link whose stored result was wiped by a re-render.
 * Cheap because it only runs when the DOM mutates (debounced to one scan/frame)
 * and writes only when a link's text differs from its stored result.
 */
function reapplyStoredResults() {
  if (resultsBySR.size === 0) return;

  // Pause observation while we write: our own text/class edits would otherwise
  // re-trigger the observer and schedule yet another reapply, feeding the churn.
  if (reapplyObserver) reapplyObserver.disconnect();

  const links = document.querySelectorAll('table a');
  for (const link of links) {
    const token = srTokenOf(link.textContent);

    const stored = resultsBySR.get(token);
    if (!stored) continue;

    if (link.textContent === expectedDisplayText(stored.srNumber, stored.responseBody, stored.isSearching)) {
      continue;  // already painted; skip to avoid a mutation loop
    }
    applyDisplay(link, stored.srNumber, stored.responseBody, stored.isSearching, false);
  }

  if (reapplyObserver) {
    reapplyObserver.takeRecords();  // drop the records our own writes just produced
    observeForReapply();
  }
}

// Trailing debounce: repaint only after the DOM and scrolling have been quiet
// for REAPPLY_QUIET_MS. Repainting *during* an active scroll fights Salesforce's
// virtual scroller (which is mid-recycle) and flickers — especially at the
// bottom of a list of tall cells. Waiting for quiet avoids that fight.
function scheduleReapply() {
  if (reapplyTimer) clearTimeout(reapplyTimer);
  reapplyTimer = setTimeout(() => {
    reapplyTimer = null;
    reapplyStoredResults();
  }, REAPPLY_QUIET_MS);
}

/** Start watching for re-renders once there's at least one result to preserve. */
function ensureReapplyObserver() {
  if (reapplyObserver) return;
  reapplyObserver = new MutationObserver(scheduleReapply);
  observeForReapply();
}

function observeForReapply() {
  // characterData: Salesforce often recycles a row by rewriting its existing
  // text node rather than replacing the element — a childList-only observer
  // misses that, leaving the row bare. We deliberately do NOT listen to
  // 'scroll': repainting mid-scroll re-grows cells at the very bottom (where the
  // browser keeps nudging the scroll to stay pinned) and that drives the blink.
  reapplyObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
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

  // Extract value to validate: text before first space, or whole text if no space
  const valueToValidate = srTokenOf(link.textContent);

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
 * Collect every valid SR number in the Request Number column, regardless of
 * which row was right-clicked.
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

  // Process every row in the column, bottom-to-top.
  const items = [];
  for (let i = allRows.length - 1; i >= 0; i--) {
    const rowCells = allRows[i].querySelectorAll('td');
    const targetCell = rowCells[columnIndex];
    if (!targetCell) continue;

    const link = targetCell.querySelector('a');
    if (!link) continue;

    // Extract SR number using existing logic
    const valueToValidate = srTokenOf(link.textContent);

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
let pendingResizeReflow = false;
function triggerSalesforceTableReflow(tableElement) {
  if (!tableElement) return;

  // Add class to parent containers to override their fixed heights
  // Go up several levels to catch Salesforce's wrapper divs
  let parent = tableElement.parentElement;
  for (let i = 0; i < 5 && parent; i++) {
    parent.classList.add('mwlog-expanded-table-container');
    parent = parent.parentElement;
  }

  // Nudge Salesforce to relayout. Coalesce to one dispatch per frame so a fast
  // batch of results doesn't fire N resizes (each of which thrashes the scroller).
  if (!pendingResizeReflow) {
    pendingResizeReflow = true;
    requestAnimationFrame(() => {
      pendingResizeReflow = false;
      window.dispatchEvent(new Event('resize'));
    });
  }
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
