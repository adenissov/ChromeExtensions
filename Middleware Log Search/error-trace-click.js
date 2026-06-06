// Error Trace Click - Content Script
// Analyzes max status code in table; for errors (not 200/202), clicks Trace link on first error bottom-to-top
// Triggered by extension icon click

(function() {
  'use strict';

  const LOG_PREFIX = '[ErrorTraceClick]';

  // Only run on Kibana/OSD ports
  if (window.location.port !== '5601' && window.location.port !== '15601') {
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
    noResultsSelector: null,  // legacy empty-state DOM not verified; safety-net timeout still fires
    observerTimeout: 25000,  // keep below background queue timeout
    noResultsStabilityMs: 3000
  };

  const STAGING_CONFIG = {
    ...CONFIG,
    tableSelector: 'table[data-test-subj="docTable"]',
    dataRowSelector: 'tbody tr',
    cellValueSelector: '.osdDocTableCell__dataField',
    statusCodeHeaderAttr: 'docTableHeader-span.attributes.http@response@status_code',
    externalRequestIdHeaderAttr: 'docTableHeader-span.attributes.http@request@header@externalrequestid',
    noResultsSelector: '[data-test-subj="embeddedSavedSearchDocTable"] .visError'
  };

  const ACTIVE_CONFIG = window.location.port === '15601' ? STAGING_CONFIG : CONFIG;

  //===========================================================================
  // COLUMN INDEX DETECTION
  //===========================================================================

  /**
   * Find column indices for Status Code, Trace, Backend, and External Request ID columns
   * @param {HTMLTableElement} table - The data table
   * @returns {Object|null} - { statusCodeIndex, traceIndex, backendIndex, externalRequestIdIndex } or null if required columns not found
   */
  function findColumnIndices(table) {
    const headerRow = table.querySelector(ACTIVE_CONFIG.headerRowSelector);
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
        if (testSubj === ACTIVE_CONFIG.statusCodeHeaderAttr) {
          statusCodeIndex = index;
        } else if (testSubj === ACTIVE_CONFIG.traceHeaderAttr) {
          traceIndex = index;
        } else if (testSubj === ACTIVE_CONFIG.backendHeaderAttr) {
          backendIndex = index;
        } else if (testSubj === ACTIVE_CONFIG.externalRequestIdHeaderAttr) {
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
    const valueSpan = cell.querySelector(ACTIVE_CONFIG.cellValueSelector);
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
    const valueSpan = cell.querySelector(ACTIVE_CONFIG.cellValueSelector);
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
    const link = cell.querySelector(ACTIVE_CONFIG.traceLinkSelector);
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
   * Normalize a DOM data row into the shape classifyStatusRows expects.
   * Returns null for rows too short to hold the Status Code / Trace columns.
   * @param {HTMLTableRowElement} row
   * @param {Object} indices - Column indices from findColumnIndices
   * @returns {Object|null} - { statusCode, backend, extReqId, trace, ref }
   */
  function normalizeRow(row, indices) {
    const cells = row.querySelectorAll('td');
    if (cells.length <= Math.max(indices.statusCodeIndex, indices.traceIndex)) return null;
    const backend = (indices.backendIndex !== -1 && cells.length > indices.backendIndex)
      ? parseCellText(cells[indices.backendIndex]) : '';
    const extReqId = (indices.externalRequestIdIndex !== -1 && cells.length > indices.externalRequestIdIndex)
      ? parseCellText(cells[indices.externalRequestIdIndex]) : '';
    return {
      statusCode: parseStatusCode(cells[indices.statusCodeIndex]),
      backend,
      extReqId,
      trace: '',        // unused on the DOM side; we click the row's trace link via ref
      ref: row
    };
  }

  /**
   * Analyze max status code in table and take appropriate action. The
   * row-selection decision is shared with osd-api.js via classifyStatusRows.
   * @param {HTMLTableElement} table - The data table
   * @returns {boolean} - True if an error trace was clicked
   */
  function scanAndClickFirstError(table) {
    const indices = findColumnIndices(table);
    if (!indices) return false;

    const domRows = table.querySelectorAll(ACTIVE_CONFIG.dataRowSelector);
    if (domRows.length === 0) {
      console.log(LOG_PREFIX, 'Table is empty - no records');
      chrome.runtime.sendMessage({ action: 'noRecordsFound' });
      return false;
    }

    const rows = [];
    for (const domRow of domRows) {
      const norm = normalizeRow(domRow, indices);
      if (norm) rows.push(norm);
    }

    const cls = classifyStatusRows(rows);
    console.log(LOG_PREFIX, 'Classified', rows.length, 'rows ->', cls.kind, 'status:', cls.statusCode);

    if (cls.kind === 'noRecords') {
      chrome.runtime.sendMessage({ action: 'noRecordsFound' });
      return false;
    }

    if (cls.kind === 'success') {
      const backendValue = cls.row ? cls.row.backend : '';
      const externalRequestId = cls.row ? cls.row.extReqId : '';
      const prefix = '(Backend=' + backendValue + ', Status=' + cls.statusCode + ') ';
      const message = cls.statusCode === 200
        ? 'Sent request to back-end'
        : 'Back-end Id received: ' + externalRequestId;

      console.log(LOG_PREFIX, 'Success result. Backend:', backendValue, 'Code:', cls.statusCode, 'ExtReqId:', externalRequestId);
      chrome.runtime.sendMessage({
        action: 'statusResult',
        statusCode: cls.statusCode,
        displayText: prefix + message
      });
      return false;
    }

    // Error: click the chosen (oldest) non-success row's Trace link.
    const traceCell = cls.row.ref.querySelectorAll('td')[indices.traceIndex];
    console.log(LOG_PREFIX, 'Found non-success status:', cls.statusCode, 'backend:', cls.row.backend);
    if (traceCell && clickTraceLink(traceCell, cls.statusCode, cls.row.backend)) {
      return true;
    }

    console.log(LOG_PREFIX, 'No clickable trace link on the error row - reporting no records');
    chrome.runtime.sendMessage({ action: 'noRecordsFound' });
    return false;
  }

  //===========================================================================
  // TABLE DETECTION WITH MUTATION OBSERVER
  //===========================================================================

  /**
   * Detect the OSD "No results found" empty-state panel.
   * When the search returns nothing, the dashboard renders a .visError block
   * inside the Discover panel container and never creates the data table.
   */
  function hasNoResultsState() {
    if (!ACTIVE_CONFIG.noResultsSelector) return false;
    return !!document.querySelector(ACTIVE_CONFIG.noResultsSelector);
  }

  function getLoadedTable() {
    const table = document.querySelector(ACTIVE_CONFIG.tableSelector);
    if (!table) return null;

    const rows = table.querySelectorAll(ACTIVE_CONFIG.dataRowSelector);
    return rows.length > 0 ? table : null;
  }

  /**
   * Wait for table to appear and have data rows, then scan
   */
  function waitForTableAndScan() {
    // Check if table already exists with rows.
    const existingTable = getLoadedTable();
    if (existingTable) {
      const rows = existingTable.querySelectorAll(ACTIVE_CONFIG.dataRowSelector);
      console.log(LOG_PREFIX, 'Table already present with', rows.length, 'rows');
      scanAndClickFirstError(existingTable);
      return;
    }

    console.log(LOG_PREFIX, 'Waiting for table to load...');

    let observer = null;
    let timeoutId = null;
    let noResultsTimerId = null;
    let noResultsReason = null;

    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (noResultsTimerId) {
        clearTimeout(noResultsTimerId);
        noResultsTimerId = null;
      }
    };

    const scheduleNoResultsReport = (reason) => {
      if (!ACTIVE_CONFIG.noResultsSelector || noResultsTimerId) return;

      noResultsReason = reason;
      console.log(LOG_PREFIX, 'Empty-state panel seen; waiting to confirm no records. Reason:', reason);

      noResultsTimerId = setTimeout(() => {
        noResultsTimerId = null;

        const table = getLoadedTable();
        if (table) {
          const rows = table.querySelectorAll(ACTIVE_CONFIG.dataRowSelector);
          console.log(LOG_PREFIX, 'Empty-state was transient; table now has', rows.length, 'rows');
          cleanup();
          scanAndClickFirstError(table);
          return;
        }

        if (hasNoResultsState()) {
          console.log(LOG_PREFIX, 'Empty-state remained stable - reporting no records. Reason:', noResultsReason);
          cleanup();
          chrome.runtime.sendMessage({ action: 'noRecordsFound' });
        } else {
          console.log(LOG_PREFIX, 'Empty-state disappeared before confirmation; continuing to wait');
        }
      }, ACTIVE_CONFIG.noResultsStabilityMs);
    };

    if (hasNoResultsState()) {
      scheduleNoResultsReport('initial');
    }

    observer = new MutationObserver((mutations) => {
      const table = getLoadedTable();
      if (table) {
        const rows = table.querySelectorAll(ACTIVE_CONFIG.dataRowSelector);
        console.log(LOG_PREFIX, 'Table loaded with', rows.length, 'rows');
        cleanup();
        scanAndClickFirstError(table);
        return;
      }

      if (hasNoResultsState()) {
        scheduleNoResultsReport('mutation');
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Safety-net timeout: if neither the table nor the empty-state panel ever
    // appears on a dashboard, report no records so the Salesforce cell doesn't
    // stay stuck on the searching spinner. Gated by a dashboard-only DOM marker
    // because OSD trace pages share host:port with the dashboard — without this
    // guard, the safety-net would falsely fire from the trace tab ~10 s after a
    // successful single-SR search and overwrite the correct error text.
    timeoutId = setTimeout(() => {
      cleanup();
      const onDashboard = !!document.querySelector('[data-test-subj="dashboardViewport"]') ||
                          !!document.querySelector('.dshAppContainer');
      if (onDashboard) {
        if (hasNoResultsState()) {
          console.log(LOG_PREFIX, 'Timeout waiting for table with empty-state visible; confirming before reporting');
          scheduleNoResultsReport('timeout');
        } else {
          console.log(LOG_PREFIX, 'Timeout waiting for table and no empty-state is visible - reporting no records');
          cleanup();
          chrome.runtime.sendMessage({ action: 'noRecordsFound' });
        }
      } else {
        console.log(LOG_PREFIX, 'Timeout waiting for table - not a dashboard, suppressing');
        cleanup();
      }
    }, ACTIVE_CONFIG.observerTimeout);
  }

  //===========================================================================
  // MESSAGE LISTENER
  //===========================================================================

  // Auto-run when page loads
  console.log(LOG_PREFIX, 'Content script loaded, starting automatic scan');
  waitForTableAndScan();

})();
