// Error Trace Click - Content Script
// Analyzes max status code in table; for errors (not 200/202), clicks Trace link on first error bottom-to-top
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
    backendHeaderAttr: 'docTableHeader-Backend',
    externalRequestIdHeaderAttr: 'docTableHeader-External Request ID',
    cellValueSelector: 'span[ng-non-bindable]',
    traceLinkSelector: 'a[href]',
    observerTimeout: 10000,  // 10 seconds max wait for table
    successStatusCodes: new Set([200, 202])
  };

  //===========================================================================
  // COLUMN INDEX DETECTION
  //===========================================================================

  /**
   * Find column indices for Status Code, Trace, Backend, and External Request ID columns
   * @param {HTMLTableElement} table - The data table
   * @returns {Object|null} - { statusCodeIndex, traceIndex, backendIndex, externalRequestIdIndex } or null if required columns not found
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
    let backendIndex = -1;
    let externalRequestIdIndex = -1;

    headers.forEach((th, index) => {
      const span = th.querySelector('span[data-test-subj]');
      if (span) {
        const testSubj = span.getAttribute('data-test-subj');
        if (testSubj === CONFIG.statusCodeHeaderAttr) {
          statusCodeIndex = index;
        } else if (testSubj === CONFIG.traceHeaderAttr) {
          traceIndex = index;
        } else if (testSubj === CONFIG.backendHeaderAttr) {
          backendIndex = index;
        } else if (testSubj === CONFIG.externalRequestIdHeaderAttr) {
          externalRequestIdIndex = index;
        }
      }
    });

    if (statusCodeIndex === -1 || traceIndex === -1) {
      console.log(LOG_PREFIX, 'Required columns not found. StatusCode:', statusCodeIndex, 'Trace:', traceIndex);
      return null;
    }

    if (backendIndex === -1) {
      console.log(LOG_PREFIX, 'Backend column not found - will use empty value');
    }
    if (externalRequestIdIndex === -1) {
      console.log(LOG_PREFIX, 'External Request ID column not found - will use empty value');
    }

    console.log(LOG_PREFIX, 'Column indices found. StatusCode:', statusCodeIndex, 'Trace:', traceIndex, 'Backend:', backendIndex, 'ExtReqId:', externalRequestIdIndex);
    return { statusCodeIndex, traceIndex, backendIndex, externalRequestIdIndex };
  }

  //===========================================================================
  // CELL VALUE PARSING
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

  /**
   * Extract text value from a table cell
   * @param {HTMLTableCellElement} cell - The table cell
   * @returns {string} - Trimmed text value or empty string
   */
  function parseCellText(cell) {
    if (!cell) return '';
    // Try the standard value span first
    const valueSpan = cell.querySelector(CONFIG.cellValueSelector);
    const text = valueSpan ? valueSpan.textContent.trim() : cell.textContent.trim();
    // Kibana shows "-" for empty/null values — treat as empty
    return text === '-' ? '' : text;
  }

  //===========================================================================
  // TRACE LINK CLICK
  //===========================================================================

  /**
   * Open the trace link in a background tab
   * @param {HTMLTableCellElement} cell - The Trace cell
   * @param {number} statusCode - The HTTP status code for this row
   * @param {string} backendValue - The Backend column value for this row
   * @returns {boolean} - True if link was found and opened
   */
  function clickTraceLink(cell, statusCode, backendValue) {
    const link = cell.querySelector(CONFIG.traceLinkSelector);
    if (link && link.href) {
      console.log(LOG_PREFIX, 'Opening trace link in background:', link.href, 'status:', statusCode, 'backend:', backendValue);
      // Send to background script to open in background tab
      chrome.runtime.sendMessage({
        action: 'openInBackground',
        url: link.href,
        statusCode: statusCode,
        backendValue: backendValue
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
   * Analyze max status code in table and take appropriate action
   * @param {HTMLTableElement} table - The data table
   * @returns {boolean} - True if an error trace was clicked
   */
  function scanAndClickFirstError(table) {
    const indices = findColumnIndices(table);
    if (!indices) return false;

    const rows = table.querySelectorAll(CONFIG.dataRowSelector);

    // Case 1: Empty table
    if (rows.length === 0) {
      console.log(LOG_PREFIX, 'Table is empty - no records');
      chrome.runtime.sendMessage({ action: 'noRecordsFound' });
      return false;
    }

    console.log(LOG_PREFIX, 'Scanning', rows.length, 'rows for max status code');

    // Phase 1: Find max status code across ALL rows
    let maxStatusCode = -1;

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length <= Math.max(indices.statusCodeIndex, indices.traceIndex)) {
        continue;
      }
      const statusCode = parseStatusCode(cells[indices.statusCodeIndex]);
      if (statusCode !== null && statusCode > maxStatusCode) {
        maxStatusCode = statusCode;
      }
    }

    // No parseable status codes
    if (maxStatusCode === -1) {
      console.log(LOG_PREFIX, 'No parseable status codes found');
      chrome.runtime.sendMessage({ action: 'noRecordsFound' });
      return false;
    }

    console.log(LOG_PREFIX, 'Max status code:', maxStatusCode);

    // Reverse rows once for bottom-to-top scanning (reused by both success and error cases)
    const rowsReversed = Array.from(rows).reverse();

    // Case 2 & 3: Max is 200 or 202 (success)
    if (maxStatusCode === 200 || maxStatusCode === 202) {
      let backendValue = '';
      let externalRequestId = '';

      for (const row of rowsReversed) {
        const cells = row.querySelectorAll('td');
        if (cells.length <= indices.statusCodeIndex) continue;

        const rowCode = parseStatusCode(cells[indices.statusCodeIndex]);

        if (maxStatusCode === 202) {
          // For 202: only use a row with status code 202
          if (rowCode !== 202) continue;
        } else {
          // For 200: use first row with non-empty Backend
          if (indices.backendIndex === -1 || cells.length <= indices.backendIndex) continue;
          if (!parseCellText(cells[indices.backendIndex])) continue;
        }

        // Extract Backend and External Request ID from this row
        if (indices.backendIndex !== -1 && cells.length > indices.backendIndex) {
          backendValue = parseCellText(cells[indices.backendIndex]);
        }
        if (indices.externalRequestIdIndex !== -1 && cells.length > indices.externalRequestIdIndex) {
          externalRequestId = parseCellText(cells[indices.externalRequestIdIndex]);
        }
        break;
      }

      const prefix = '(Backend=' + backendValue + ', Status=' + maxStatusCode + ') ';
      const message = maxStatusCode === 200
        ? 'Sent request for back-end Id'
        : 'Back-end Id received: ' + externalRequestId;

      console.log(LOG_PREFIX, 'Success result. Backend:', backendValue, 'Code:', maxStatusCode, 'ExtReqId:', externalRequestId);
      chrome.runtime.sendMessage({
        action: 'statusResult',
        statusCode: maxStatusCode,
        displayText: prefix + message
      });
      return false;
    }

    // Case 4: Max is anything else - find first non-success row bottom-to-top
    console.log(LOG_PREFIX, 'Error detected. Scanning bottom-to-top for first non-success row');

    for (const row of rowsReversed) {
      const cells = row.querySelectorAll('td');
      if (cells.length <= Math.max(indices.statusCodeIndex, indices.traceIndex)) {
        continue;
      }

      const statusCode = parseStatusCode(cells[indices.statusCodeIndex]);

      if (statusCode !== null && !CONFIG.successStatusCodes.has(statusCode)) {
        const backendValue = (indices.backendIndex !== -1 && cells.length > indices.backendIndex)
          ? parseCellText(cells[indices.backendIndex])
          : '';
        console.log(LOG_PREFIX, 'Found non-success status:', statusCode, 'backend:', backendValue);
        if (clickTraceLink(cells[indices.traceIndex], statusCode, backendValue)) {
          return true;
        }
      }
    }

    // Fallback: shouldn't reach here if max is not in success set
    console.log(LOG_PREFIX, 'No non-success rows found (unexpected)');
    chrome.runtime.sendMessage({ action: 'noRecordsFound' });
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
