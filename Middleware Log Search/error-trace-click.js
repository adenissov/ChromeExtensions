// Error Trace Click - Content Script
// Scans Status Code column bottom-to-top and clicks Trace link on first HTTP error (>= 300)
// Triggered by extension icon click

(function() {
  'use strict';

  const LOG_PREFIX = '[ErrorTraceClick]';

  // Only run on port 5601 (Kibana/OSD)
  if (window.location.port !== '5601') {
    return;
  }

  //===========================================================================
  // CONFIGURATION
  //===========================================================================

  const CONFIG = {
    tableSelector: 'table.osdDocTable',
    headerRowSelector: 'thead tr.osdDocTableHeader',
    dataRowSelector: 'tbody tr.osdDocTable__row',
    statusCodeHeaderAttr: 'docTableHeader-Status Code',
    traceHeaderAttr: 'docTableHeader-Trace',
    cellValueSelector: 'span[ng-non-bindable]',
    traceLinkSelector: 'a[href]',
    observerTimeout: 10000,  // 10 seconds max wait for table
    errorStatusThreshold: 300
  };

  //===========================================================================
  // COLUMN INDEX DETECTION
  //===========================================================================

  /**
   * Find column indices for Status Code and Trace columns
   * @param {HTMLTableElement} table - The data table
   * @returns {Object|null} - { statusCodeIndex, traceIndex } or null if not found
   */
  function findColumnIndices(table) {
    const headerRow = table.querySelector(CONFIG.headerRowSelector);
    if (!headerRow) {
      console.log(LOG_PREFIX, 'Header row not found');
      return null;
    }

    const headers = headerRow.querySelectorAll('th');
    let statusCodeIndex = -1;
    let traceIndex = -1;

    headers.forEach((th, index) => {
      const span = th.querySelector('span[data-test-subj]');
      if (span) {
        const testSubj = span.getAttribute('data-test-subj');
        if (testSubj === CONFIG.statusCodeHeaderAttr) {
          statusCodeIndex = index;
        } else if (testSubj === CONFIG.traceHeaderAttr) {
          traceIndex = index;
        }
      }
    });

    if (statusCodeIndex === -1 || traceIndex === -1) {
      console.log(LOG_PREFIX, 'Required columns not found. StatusCode:', statusCodeIndex, 'Trace:', traceIndex);
      return null;
    }

    console.log(LOG_PREFIX, 'Column indices found. StatusCode:', statusCodeIndex, 'Trace:', traceIndex);
    return { statusCodeIndex, traceIndex };
  }

  //===========================================================================
  // STATUS CODE PARSING
  //===========================================================================

  /**
   * Extract numeric status code from a table cell
   * @param {HTMLTableCellElement} cell - The Status Code cell
   * @returns {number|null} - Parsed status code or null
   */
  function parseStatusCode(cell) {
    const valueSpan = cell.querySelector(CONFIG.cellValueSelector);
    if (!valueSpan) return null;

    const text = valueSpan.textContent.trim();
    const code = parseInt(text, 10);
    return isNaN(code) ? null : code;
  }

  //===========================================================================
  // TRACE LINK CLICK
  //===========================================================================

  /**
   * Open the trace link in a background tab
   * @param {HTMLTableCellElement} cell - The Trace cell
   * @returns {boolean} - True if link was found and opened
   */
  function clickTraceLink(cell) {
    const link = cell.querySelector(CONFIG.traceLinkSelector);
    if (link && link.href) {
      console.log(LOG_PREFIX, 'Opening trace link in background:', link.href);
      // Send to background script to open in background tab
      chrome.runtime.sendMessage({
        action: 'openInBackground',
        url: link.href
      });
      return true;
    }
    console.log(LOG_PREFIX, 'No trace link found in cell');
    return false;
  }

  //===========================================================================
  // MAIN SCAN LOGIC
  //===========================================================================

  /**
   * Scan table for HTTP errors and click first trace link (bottom-to-top)
   * @param {HTMLTableElement} table - The data table
   * @returns {boolean} - True if an error trace was clicked
   */
  function scanAndClickFirstError(table) {
    const indices = findColumnIndices(table);
    if (!indices) return false;

    const rows = table.querySelectorAll(CONFIG.dataRowSelector);
    if (rows.length === 0) {
      console.log(LOG_PREFIX, 'No data rows found');
      return false;
    }

    console.log(LOG_PREFIX, 'Scanning', rows.length, 'rows bottom-to-top');

    // Convert to array and reverse for bottom-to-top iteration
    const rowsArray = Array.from(rows).reverse();

    for (const row of rowsArray) {
      const cells = row.querySelectorAll('td');
      
      if (cells.length <= Math.max(indices.statusCodeIndex, indices.traceIndex)) {
        continue;  // Row doesn't have enough cells
      }

      const statusCodeCell = cells[indices.statusCodeIndex];
      const traceCell = cells[indices.traceIndex];

      const statusCode = parseStatusCode(statusCodeCell);
      
      if (statusCode !== null && statusCode >= CONFIG.errorStatusThreshold) {
        console.log(LOG_PREFIX, 'Found HTTP error:', statusCode);
        if (clickTraceLink(traceCell)) {
          return true;  // Stop after first successful click
        }
      }
    }

    // Check if table has any rows at all
    if (rows.length === 0) {
      console.log(LOG_PREFIX, 'Table is empty - no records');
      chrome.runtime.sendMessage({
        action: 'noRecordsFound'
      });
    } else {
      console.log(LOG_PREFIX, 'No HTTP errors found in', rows.length, 'records');
      chrome.runtime.sendMessage({
        action: 'noErrorsFound'
      });
    }
    return false;
  }

  //===========================================================================
  // TABLE DETECTION WITH MUTATION OBSERVER
  //===========================================================================

  /**
   * Wait for table to appear and have data rows, then scan
   */
  function waitForTableAndScan() {
    // Check if table already exists with rows
    const existingTable = document.querySelector(CONFIG.tableSelector);
    if (existingTable) {
      const rows = existingTable.querySelectorAll(CONFIG.dataRowSelector);
      if (rows.length > 0) {
        console.log(LOG_PREFIX, 'Table already present with', rows.length, 'rows');
        scanAndClickFirstError(existingTable);
        return;
      }
    }

    console.log(LOG_PREFIX, 'Waiting for table to load...');

    let observer = null;
    let timeoutId = null;

    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    observer = new MutationObserver((mutations) => {
      const table = document.querySelector(CONFIG.tableSelector);
      if (table) {
        const rows = table.querySelectorAll(CONFIG.dataRowSelector);
        if (rows.length > 0) {
          console.log(LOG_PREFIX, 'Table loaded with', rows.length, 'rows');
          cleanup();
          scanAndClickFirstError(table);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Timeout after configured duration
    timeoutId = setTimeout(() => {
      console.log(LOG_PREFIX, 'Timeout waiting for table');
      cleanup();
    }, CONFIG.observerTimeout);
  }

  //===========================================================================
  // MESSAGE LISTENER
  //===========================================================================

  // Auto-run when page loads
  console.log(LOG_PREFIX, 'Content script loaded, starting automatic scan');
  waitForTableAndScan();

})();
